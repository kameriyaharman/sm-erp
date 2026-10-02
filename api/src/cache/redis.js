import { createClient } from 'redis';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * One shared Redis connection for the cache and the rate limiters.
 *
 * - Optional: without REDIS_URL everything falls back to in-process memory.
 * - Never blocks a request on a dead Redis: the offline queue is disabled, so
 *   commands fail fast while disconnected and callers fall back.
 * - Reconnects forever with capped backoff; errors are logged at most once a minute.
 */
let client = null;
let lastErrorLog = 0;

export function getRedis() {
  if (!env.REDIS_URL) return null;
  if (client) return client;

  client = createClient({
    url: env.REDIS_URL,
    disableOfflineQueue: true,
    socket: {
      family: 0,                         // Railway private network: IPv4 or IPv6
      connectTimeout: 5_000,
      reconnectStrategy: (retries) => Math.min(250 * 2 ** retries, 10_000),
    },
  });
  client.on('error', (err) => {
    if (Date.now() - lastErrorLog > 60_000) {
      lastErrorLog = Date.now();
      logger.warn('Redis unavailable; using in-memory fallback', { error: err.message });
    }
  });
  client.on('ready', () => logger.info('Redis connected'));
  return client;
}

export const redisReady = () => Boolean(client?.isReady);

/** Connect at boot. Does not throw: the API runs (degraded) without Redis. */
export async function connectRedis({ timeoutMs = 5_000 } = {}) {
  const c = getRedis();
  if (!c) return false;
  try {
    await Promise.race([
      c.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Redis connect timed out')), timeoutMs).unref()),
    ]);
    return true;
  } catch (err) {
    logger.warn('Redis not reachable at boot; continuing with in-memory cache and rate limits', { error: err.message });
    return false;
  }
}

export async function closeRedis() {
  if (!client) return;
  try {
    await client.close();
  } catch {
    client.destroy();
  }
  client = null;
}
