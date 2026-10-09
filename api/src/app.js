import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { requestId } from './middleware/requestId.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { AppError } from './errors/AppError.js';
import { pool } from './db/pool.js';
import { accessLog } from './middleware/accessLog.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { redisReady } from './cache/redis.js';
import apiRoutes from './routes.js';
import { admsRouter } from './modules/devices/devices.routes.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Needed for correct req.ip (rate limiting, audit logs) behind Railway's proxy.
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestId);
  if (env.ACCESS_LOG) app.use(accessLog);
  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        // Allow non-browser clients (mobile app, server-to-server) which send no Origin.
        if (!origin || env.CORS_ORIGINS.includes(origin)) return callback(null, true);
        return callback(AppError.forbidden('Origin not allowed', 'CORS_REJECTED'));
      },
      credentials: true,
      exposedHeaders: ['X-Request-Id', 'Idempotent-Replayed', 'Location'],
    }),
  );
  // Razorpay signs the exact request bytes: keep the webhook body raw (express.json then skips it).
  app.use('/api/v1/finance/webhook', express.raw({ type: '*/*', limit: '1mb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // Liveness: the process is up (no dependencies).
  app.get('/health/live', (_req, res) => res.json({ status: 'ok' }));

  // Readiness (Railway healthcheck): the database answers. Redis is optional: reported, not required.
  const ready = async (_req, res) => {
    const redis = env.REDIS_URL ? (redisReady() ? 'ok' : 'degraded') : 'disabled';
    try {
      await pool.query('SELECT 1');
      res.set('Cache-Control', 'no-store').json({ status: 'ok', db: 'ok', redis });
    } catch {
      res.status(503).set('Cache-Control', 'no-store').json({ status: 'unavailable', db: 'down', redis });
    }
  };
  app.get('/health/ready', ready);
  app.get('/health', ready);

  app.use('/api/v1', apiLimiter, apiRoutes);
  // ZKTeco / eSSL biometric and face terminals push punches here (ADMS protocol, fixed path).
  app.use('/iclock', apiLimiter, admsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
