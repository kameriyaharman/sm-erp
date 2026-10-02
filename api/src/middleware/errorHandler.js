import { ZodError } from 'zod';
import { AppError } from '../errors/AppError.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export function notFoundHandler(req, _res, next) {
  next(AppError.notFound(`Route ${req.method} ${req.path} not found`, 'ROUTE_NOT_FOUND'));
}

/**
 * Database constraint violations that can legitimately reach a request (races,
 * stale data) become client errors instead of 500s. Constraint names are safe to
 * expose; row data in pg's `detail` is not.
 */
function fromPostgresError(err) {
  switch (err?.code) {
    case '23505':
      return new AppError(409, 'CONFLICT', 'This record already exists or was just changed. Refresh and try again.', {
        constraint: err.constraint,
      });
    case '23503':
      return new AppError(422, 'INVALID_REFERENCE', 'A referenced record does not exist or cannot be used here.', {
        constraint: err.constraint,
      });
    case '23514':
      return new AppError(422, 'CONSTRAINT_VIOLATION', 'The request breaks a data rule.', { constraint: err.constraint });
    case '40001':
    case '40P01':
    case '55P03': // lock_timeout
      return new AppError(409, 'RETRY', 'The record was busy. Please try again.');
    case '57014': // statement_timeout
      return new AppError(503, 'QUERY_TIMEOUT', 'This request took too long. Narrow the filters or try again.');
    default:
      return null;
  }
}

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
export function errorHandler(err, req, res, _next) {
  let error = err;

  if (err instanceof ZodError) {
    error = AppError.badRequest('Validation failed', err.flatten().fieldErrors, 'VALIDATION_ERROR');
  } else if (err?.type === 'entity.parse.failed') {
    error = AppError.badRequest('Malformed JSON body', undefined, 'INVALID_JSON');
  } else if (err?.type === 'entity.too.large') {
    error = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large');
  } else if (/timeout exceeded when trying to connect|Connection terminated due to connection timeout/i.test(err?.message ?? '')) {
    // Pool exhausted or database unreachable: tell clients to back off instead of a generic 500.
    error = new AppError(503, 'SERVICE_BUSY', 'The server is busy. Please try again in a moment.');
    logger.error('Database pool unavailable', { requestId: req.id, error: err.message });
  } else if (fromPostgresError(err)) {
    error = fromPostgresError(err);
    logger.warn('Database constraint rejected request', { requestId: req.id, code: err.code, constraint: err.constraint });
  }

  if (!(error instanceof AppError)) {
    // Unexpected: log everything server-side, reveal nothing to the client.
    logger.error('Unhandled error', {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl,
      error: err?.message,
      stack: err?.stack,
    });
    error = new AppError(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
  } else if (error.statusCode >= 500) {
    logger.error('Server error', { requestId: req.id, code: error.code, error: error.message });
  }

  const body = {
    error: {
      code: error.code,
      message: error.message,
      requestId: req.id,
    },
  };
  if (error.details) body.error.details = error.details;
  if (!env.isProduction && error.statusCode >= 500 && err?.stack) body.error.stack = err.stack;

  res.status(error.statusCode).json(body);
}
