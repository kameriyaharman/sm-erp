import { logger } from '../utils/logger.js';

/**
 * One structured line per request, written when the response finishes:
 *   @status:500  @path:/api/v1/fees/students  @userId:...  @requestId:...
 * Health checks are skipped (Railway polls them). 5xx -> error, 429 -> warn, rest -> info.
 * Query strings are not logged: they can carry search terms about students.
 */
export function accessLog(req, res, next) {
  if (req.path.startsWith('/health')) return next();
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const status = res.statusCode;
    const level = status >= 500 ? 'error' : status === 429 ? 'warn' : 'info';
    logger[level]('request', {
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status,
      durationMs: Math.round(durationMs * 10) / 10,
      requestId: req.id,
      userId: req.auth?.userId,
      role: req.auth?.role,
      ip: req.ip,
      bytes: Number(res.get('content-length')) || undefined,
      cache: res.get('x-cache'),
    });
  });
  next();
}
