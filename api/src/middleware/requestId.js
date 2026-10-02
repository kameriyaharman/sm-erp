import { randomUUID } from 'node:crypto';

const SAFE_ID = /^[A-Za-z0-9-]{8,64}$/;

// Correlates logs and error responses. Accepts an upstream id only if it looks safe.
export function requestId(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.set('X-Request-Id', req.id);
  next();
}
