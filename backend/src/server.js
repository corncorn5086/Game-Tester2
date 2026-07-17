import express from 'express';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { optionalAuth } from './auth.js';
import {
  forgotPasswordRateLimit,
  loginRateLimit,
  operatorBootstrapRateLimit,
  resendEmailRateLimit,
  signupRateLimit
} from './auth-security.js';
import { createCorsMiddleware } from './cors.js';
import { closeDatabase } from './db.js';
import { cloudHealth, cloudStatus } from './supabase.js';
import { loadRuntimeConfig } from './runtime-config.js';
import { authRouter } from './routes/auth.js';
import { coreRouter } from './routes/core.js';
import { agentRouter } from './routes/agent.js';
import { platformRouter } from './routes/platform.js';
import { aiRouter } from './routes/ai.js';
import { aiReadinessSnapshot, startAIReadinessCheck } from './ai-readiness.js';

const VERSION = '0.2.0';

export function createApp({ runtimeConfig = loadRuntimeConfig(), aiConnectionCheck } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', runtimeConfig.trustProxy);
  app.locals.isShuttingDown = false;
  app.locals.runtimeConfig = runtimeConfig;
  app.locals.aiReadinessPromise = startAIReadinessCheck({
    provider: runtimeConfig.aiProvider,
    production: runtimeConfig.production,
    checkConnection: aiConnectionCheck
  });

  app.use(createCorsMiddleware(runtimeConfig.corsOrigins));
  app.use(optionalAuth);
  // Managed-AI requests are deliberately much smaller than report ingestion.
  // Mount this parser before the legacy 25 MB parser so the stricter limit wins.
  app.use('/ai', express.json({ limit: '512kb' }), aiRouter);
  // Auth payloads are profile-sized at most (the avatar endpoint allows ~1 MB).
  // Signup/login throttles run before JSON parsing to reject abusive clients
  // without accepting a large body first.
  app.use('/auth/signup', signupRateLimit);
  app.use('/auth/login', loginRateLimit);
  app.use('/auth/forgot-password', forgotPasswordRateLimit);
  app.use('/auth/resend-email-code', resendEmailRateLimit);
  app.use('/auth/bootstrap-operator', operatorBootstrapRateLimit);
  app.use('/auth', express.json({ limit: '2mb' }));
  if (runtimeConfig.apiMode === 'full') app.use(express.json({ limit: '25mb' }));

  app.get('/health', (_req, res) => {
    const shuttingDown = app.locals.isShuttingDown === true;
    const ai = aiReadinessSnapshot();
    const requiresReadyAI = runtimeConfig.production === true && runtimeConfig.apiMode === 'managed-ai';
    const unavailable = requiresReadyAI && !ai.ready;
    res.setHeader('Cache-Control', 'no-store');
    res.status(shuttingDown || unavailable ? 503 : 200).json({
      status: shuttingDown ? 'shutting-down' : (unavailable ? 'not-ready' : 'ok'),
      service: 'ember-backend',
      version: VERSION,
      time: new Date().toISOString(),
      ai,
      ...(runtimeConfig.apiMode === 'full' ? { cloud: cloudStatus() } : {})
    });
  });

  app.use(authRouter);
  if (runtimeConfig.apiMode === 'full') {
    app.get('/cloud/health', async (_req, res) => {
      res.json(await cloudHealth());
    });
    app.use(coreRouter);
    app.use(agentRouter);
    app.use(platformRouter);
  }

  app.use((req, res) => res.status(404).json({ error: `No route ${req.method} ${req.path}` }));
  app.use((err, _req, res, _next) => {
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Request body is too large.', code: 'REQUEST_TOO_LARGE' });
    }
    if (err instanceof SyntaxError && err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid JSON body.', code: 'INVALID_JSON' });
    }
    console.error('[ember-backend]', err);
    res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL_ERROR' });
  });

  return app;
}

export function startServer({ runtimeConfig = loadRuntimeConfig(), app = createApp({ runtimeConfig }) } = {}) {
  const server = app.listen(runtimeConfig.port, runtimeConfig.host);
  return { app, server, runtimeConfig };
}

export async function shutdownServer(server, { timeoutMs = 15_000, closeResources = closeDatabase } = {}) {
  if (!server) {
    await closeResources?.();
    return { forced: false };
  }
  let forced = false;
  try {
    await new Promise((resolveClose, rejectClose) => {
      let settled = false;
      let timer;
      const finish = (error = null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') rejectClose(error);
        else resolveClose();
      };
      timer = setTimeout(() => {
        forced = true;
        server.closeAllConnections?.();
        setImmediate(() => finish());
      }, Math.max(1_000, timeoutMs));
      try {
        server.close(finish);
        server.closeIdleConnections?.();
      } catch (error) {
        finish(error);
      }
    });
  } finally {
    await closeResources?.();
  }
  return { forced };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  try {
    const { app, server, runtimeConfig } = startServer();
    let shutdownPromise = null;
    const shutdown = (signal, exitCode = 0) => {
      if (shutdownPromise) return shutdownPromise;
      app.locals.isShuttingDown = true;
      console.log(`[ember-backend] ${signal}; stopping new connections and draining requests.`);
      shutdownPromise = shutdownServer(server, { timeoutMs: runtimeConfig.shutdownTimeoutMs })
        .then(({ forced }) => {
          if (forced) console.warn('[ember-backend] shutdown deadline reached; remaining connections were closed.');
          process.exitCode = exitCode;
        })
        .catch((error) => {
          console.error('[ember-backend] graceful shutdown failed:', error?.message || 'unknown error');
          process.exitCode = 1;
        });
      return shutdownPromise;
    };

    server.once('listening', () => {
      const address = runtimeConfig.apiUrl || `http://${runtimeConfig.host}:${runtimeConfig.port}`;
      console.log(`◆ ember-backend v${VERSION} listening at ${address}`);
      console.log(`  Health: ${address}/health`);
    });
    server.once('error', (error) => {
      console.error('[ember-backend] server error:', error?.message || 'unknown error');
      void shutdown('server-error', 1);
    });
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    process.once('SIGINT', () => void shutdown('SIGINT'));
  } catch (error) {
    console.error(`[ember-backend] startup rejected (${error?.code || 'STARTUP_ERROR'}): ${error?.message || 'invalid configuration'}`);
    try { closeDatabase(); } catch { /* startup already failed */ }
    process.exitCode = 1;
  }
}
