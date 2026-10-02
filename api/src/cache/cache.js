import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { getRedis, redisReady } from './redis.js';

/**
 * Small key/value cache with two backends:
 *   Redis   when REDIS_URL is set and connected (shared by every replica)
 *   Memory  otherwise: LRU + TTL inside this process
 *
 * Every call fails open: a cache error is a miss, never a failed request.
 *
 * Invalidation uses namespace versions instead of deleting keys:
 *   key = <prefix>:<namespace>:v<version>:<rest>
 * bump(namespace, tenantId) increments the version, so every older key for that
 * tenant is simply never read again and expires on its TTL. One INCR, no SCAN.
 */
const PREFIX = 'smerp';
const REDIS_TIMEOUT_MS = 150;

class MemoryStore {
  constructor({ maxEntries }) {
    this.maxEntries = maxEntries;
    this.map = new Map();
  }

  get(key) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    // LRU: move to the back.
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key, value, ttlSeconds) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    while (this.map.size > this.maxEntries) this.map.delete(this.map.keys().next().value);
  }

  incr(key) {
    const next = (Number(this.get(key)) || 0) + 1;
    this.set(key, next, 7 * 24 * 3600);
    return next;
  }

  clear() {
    this.map.clear();
  }
}

const memory = new MemoryStore({ maxEntries: env.CACHE_MAX_ENTRIES });

const withTimeout = (promise) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('redis timeout')), REDIS_TIMEOUT_MS).unref())]);

function backend() {
  const redis = getRedis();
  return redis && redisReady() ? redis : null;
}

let lastWarn = 0;
function warn(op, err) {
  if (Date.now() - lastWarn > 60_000) {
    lastWarn = Date.now();
    logger.warn('Cache operation failed; treated as a miss', { op, error: err.message });
  }
}

export const cache = {
  get kind() {
    return backend() ? 'redis' : 'memory';
  },

  async get(key) {
    const redis = backend();
    if (!redis) return memory.get(key);
    try {
      const raw = await withTimeout(redis.get(key));
      return raw == null ? undefined : JSON.parse(raw);
    } catch (err) {
      warn('get', err);
      return undefined;
    }
  },

  async set(key, value, ttlSeconds) {
    const redis = backend();
    if (!redis) return memory.set(key, value, ttlSeconds);
    try {
      await withTimeout(redis.set(key, JSON.stringify(value), { EX: ttlSeconds }));
    } catch (err) {
      warn('set', err);
    }
  },

  /** Current version of a namespace for a tenant (null tenant = platform-wide view). */
  async version(namespace, tenantId) {
    const key = `${PREFIX}:ver:${namespace}:${tenantId ?? 'global'}`;
    const redis = backend();
    if (!redis) return Number(memory.get(key) ?? 0);
    try {
      return Number((await withTimeout(redis.get(key))) ?? 0);
    } catch (err) {
      warn('version', err);
      return null; // unknown version -> caller skips the cache
    }
  },

  /**
   * Invalidate a namespace for one tenant. Also bumps the platform-wide version, because
   * a platform super admin's cached view spans every tenant.
   */
  async bump(namespace, tenantId) {
    const keys = [`${PREFIX}:ver:${namespace}:global`, ...(tenantId ? [`${PREFIX}:ver:${namespace}:${tenantId}`] : [])];
    // Always bump memory too: if Redis is down right now, this replica still stops serving stale data.
    keys.forEach((k) => memory.incr(k));
    const redis = backend();
    if (!redis) return;
    try {
      await withTimeout(Promise.all(keys.map((k) => redis.incr(k))));
    } catch (err) {
      warn('bump', err);
    }
  },

  key(...parts) {
    return [PREFIX, ...parts.map((p) => (p == null ? '-' : String(p)))].join(':');
  },

  /** Tests only. */
  _clearMemory() {
    memory.clear();
  },
};

/** Namespaces and what invalidates them. */
export const NS = Object.freeze({
  FEES: 'fees',             // invoices, payments (counter + online), allocations
  ATTENDANCE: 'attendance', // attendance submissions
});

/**
 * Invalidate after a successful write. Await it before responding, so the client's next
 * read can't hit the old entry. Never throws; bounded by the Redis timeout.
 */
export function invalidate(namespace, tenantId) {
  return cache.bump(namespace, tenantId).catch((err) => warn('bump', err));
}
