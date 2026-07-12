import express from 'express';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_BACKEND_URL } from '@ember/shared/constants';
import { optionalAuth } from './auth.js';
import { corsAllowlist, securityHeaders } from './middleware.js';
import { cloudHealth, cloudStatus } from './supabase.js';
import { authRouter } from './routes/auth.js';
import { coreRouter } from './routes/core.js';
import { agentRouter } from './routes/agent.js';
import { platformRouter } from './routes/platform.js';

const VERSION = '0.2.0';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '25mb' }));

  // CORS allowlist: loopback origins (web site, desktop renderer, Electron
  // static server) plus CORS_ORIGINS from .env — never `*`.
  app.use(corsAllowlist);
  app.use(securityHeaders);

  app.use(optionalAuth);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'ember-backend', version: VERSION, time: new Date().toISOString(), cloud: cloudStatus() });
  });

  app.get('/cloud/health', async (_req, res) => {
    res.json(await cloudHealth());
  });

  app.use(authRouter);
  app.use(coreRouter);
  app.use(agentRouter);
  app.use(platformRouter);

  app.use((req, res) => res.status(404).json({ error: `No route ${req.method} ${req.path}` }));
  app.use((err, _req, res, _next) => {
    console.error('[ember-backend]', err);
    res.status(500).json({ error: err.message ?? 'internal error' });
  });

  return app;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const port = Number(process.env.PORT ?? new URL(process.env.API_URL ?? DEFAULT_BACKEND_URL).port ?? 4310);
  createApp().listen(port, () => {
    console.log(`◆ ember-backend v${VERSION} listening on http://localhost:${port}`);
    console.log('  Try: curl http://localhost:' + port + '/health');
  });
}
