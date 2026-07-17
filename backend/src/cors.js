const ALLOWED_METHODS = ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'];
const ALLOWED_HEADERS = new Set(['authorization', 'content-type']);

export function createCorsMiddleware(origins) {
  const configured = Array.isArray(origins) ? origins : [];
  const wildcard = configured.length === 1 && configured[0] === '*';
  const allowedOrigins = new Set(configured.filter((origin) => origin !== '*'));

  return (req, res, next) => {
    const requestOrigin = normalizedRequestOrigin(req.headers.origin);
    const allowed = wildcard || (!!requestOrigin && allowedOrigins.has(requestOrigin));

    if (req.headers.origin && !wildcard) res.vary('Origin');
    if (allowed) {
      res.setHeader('Access-Control-Allow-Origin', wildcard ? '*' : requestOrigin);
      res.setHeader('Access-Control-Expose-Headers', 'RateLimit-Limit, RateLimit-Remaining, Retry-After');
    }

    if (req.method !== 'OPTIONS') return next();
    if (req.headers.origin && !allowed) {
      return res.status(403).json({ error: 'This browser origin is not allowed.', code: 'CORS_ORIGIN_DENIED' });
    }

    const requestedMethod = String(req.headers['access-control-request-method'] || '').toUpperCase();
    if (requestedMethod && !ALLOWED_METHODS.includes(requestedMethod)) {
      return res.status(403).json({ error: 'This CORS method is not allowed.', code: 'CORS_METHOD_DENIED' });
    }
    const requestedHeaders = String(req.headers['access-control-request-headers'] || '')
      .split(',')
      .map((header) => header.trim().toLowerCase())
      .filter(Boolean);
    if (requestedHeaders.some((header) => !ALLOWED_HEADERS.has(header))) {
      return res.status(403).json({ error: 'A requested CORS header is not allowed.', code: 'CORS_HEADER_DENIED' });
    }

    res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS.join(','));
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '600');
    return res.sendStatus(204);
  };
}

function normalizedRequestOrigin(value) {
  if (typeof value !== 'string' || !value || value.length > 2_048) return null;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin === 'null') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}
