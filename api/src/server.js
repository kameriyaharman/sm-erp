import { env } from './config/env.js';
import { createApp } from './app.js';
import { pool, poolStats } from './db/pool.js';
import { closeRedis, connectRedis } from './cache/redis.js';
import { logger } from './utils/logger.js';
import { simulatedProvider, startNotificationDispatcher, stopNotificationDispatcher } from './modules/notifications/dispatcher.js';
import { getNotifier } from './modules/notifications/index.js';
import { startRetryWorker } from './modules/notifications/retry.worker.js';
import { startScheduler } from './modules/notifications/scheduler.js';

// Redis is optional; connect before taking traffic so the first requests use the shared cache.
const redisConnected = await connectRedis();
if (env.isProduction && !env.REDIS_URL) {
  logger.warn('REDIS_URL not set: cache and rate limits are per replica. Fine for one replica; add Redis before scaling out.');
}

const app = createApp();
const notifier = getNotifier({ env, logger });
let retryWorker;
let scheduler;
let shuttingDown = false;

const server = app.listen(env.PORT, () => {
  logger.info('API listening', {
    port: env.PORT,
    env: env.NODE_ENV,
    node: process.version,
    dbPoolMax: env.DB_POOL_MAX,
    cache: env.CACHE_ENABLED ? (redisConnected ? 'redis' : 'memory') : 'off',
  });
  // Attendance alerts in the outbox go out through the configured SMS/WhatsApp gateway.
  // Email rows still use the logging stub until an email provider is added.
  startNotificationDispatcher({ customProvider: notifier.asOutboxProvider({ emailProvider: simulatedProvider }) }).catch((err) =>
    logger.error('Dispatcher failed to start', { error: err.message }),
  );
  // Failed WhatsApp/SMS dispatches in notification_logs are retried on a schedule.
  retryWorker = startRetryWorker({ notifier, logger, intervalMs: env.NOTIFY_RETRY_INTERVAL_MS });
  // Per-school daily jobs: automatic fee reminders, birthday wishes, device-attendance cut-off.
  if (env.SCHEDULER_ENABLED) scheduler = startScheduler({ notifier, env, logger, intervalMs: env.SCHEDULER_INTERVAL_MS });
});

// Behind Railway's proxy: keep-alive longer than the proxy's, headers a bit longer still.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 60_000;

/**
 * Graceful shutdown on redeploy: stop accepting connections, let in-flight requests
 * finish, then close the DB pool and Redis. Hard exit after 10 s.
 */
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Shutting down', { signal, pool: poolStats() });
  stopNotificationDispatcher();
  retryWorker?.stop();
  scheduler?.stop();
  server.close(async () => {
    await Promise.allSettled([pool.end(), closeRedis()]);
    logger.info('Shutdown complete');
    process.exit(0);
  });
  server.closeIdleConnections();
  setTimeout(() => {
    logger.error('Forced exit: connections did not drain in time');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { error: reason instanceof Error ? reason : String(reason) });
});
process.on('uncaughtException', (err) => {
  // State is unknown after this; log it and let Railway restart the container.
  logger.error('Uncaught exception', { error: err });
  process.exit(1);
});
