import { createHash } from 'node:crypto';
import { MemoryStore, ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { env } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { getRedis, redisReady } from '../cache/redis.js';
import { logger } from '../utils/logger.js';
import { loginRateKey } from '../modules/auth/login-id.js';

/**
 * Rate limits. With REDIS_URL the counters are shared by every replica (Redis store);
 * if Redis is down, each replica falls back to its own memory counters, so limits
 * degrade to "per replica" instead of switching off. Without REDIS_URL: memory only
 * (correct for a single replica).
 *
 * IPs come from req.ip, which is only the real client IP because app.js sets
 * `trust proxy` to the number of proxies in front of us (Railway = 1). IPv6 clients
 * are grouped per /56, so one attacker can't rotate through a whole prefix.
 */

class FallbackStore {
  constructor(prefix) {
    this.prefix = prefix;
    this.localKeys = false;
    this.fallback = new MemoryStore();
    const redis = getRedis();
    this.primary = redis
      ? new RedisStore({ prefix: `smerp:rl:${prefix}:`, sendCommand: (...args) => redis.sendCommand(args) })
      : null;
    // (Re)load the Lua scripts whenever Redis (re)connects, before the next request needs them.
    redis?.on('ready', () => this.primary.windowMs && this.rearm());
  }

  init(options) {
    this.fallback.init(options);
    if (this.primary) {
      // Redis may not be connected yet at boot: a failed script load must not crash the process.
      Promise.resolve(this.primary.init(options)).catch(() => {});
      this.quiet();
    }
  }

  // Script loading can fail while Redis is down; keep those rejections from going unhandled.
  quiet() {
    this.primary.incrementScriptSha?.catch?.(() => {});
    this.primary.getScriptSha?.catch?.(() => {});
  }

  rearm() {
    this.primary.incrementScriptSha = this.primary.loadIncrementScript();
    this.primary.getScriptSha = this.primary.loadGetScript();
    this.quiet();
  }

  async increment(key) {
    if (this.primary && redisReady()) {
      try {
        return await this.primary.increment(key);
      } catch {
        // Usually a script that failed to load while Redis was down: reload once and retry,
        // so no hit is lost between the two stores.
        this.rearm();
        try {
          return await this.primary.increment(key);
        } catch (err) {
          logStoreError(err);
        }
      }
    }
    return this.fallback.increment(key);
  }

  async decrement(key) {
    if (this.primary && redisReady()) await this.primary.decrement(key).catch(logStoreError);
    await this.fallback.decrement(key);
  }

  async resetKey(key) {
    if (this.primary && redisReady()) await this.primary.resetKey(key).catch(logStoreError);
    await this.fallback.resetKey(key);
  }

  shutdown() {
    this.fallback.shutdown?.();
  }
}

let lastStoreError = 0;
function logStoreError(err) {
  if (Date.now() - lastStoreError > 60_000) {
    lastStoreError = Date.now();
    logger.warn('Rate-limit store unavailable; using per-replica memory counters', { error: err.message });
  }
}

const ipKey = (req) => ipKeyGenerator(req.ip ?? '0.0.0.0', 56);

/** Builds a limiter with our JSON 429, Retry-After, and one warning log per blocked key per window. */
function limiter({ name, windowMs, limit, keyGenerator = ipKey, skipSuccessfulRequests = false, skip }) {
  return rateLimit({
    windowMs,
    limit,
    keyGenerator,
    skipSuccessfulRequests,
    skip,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: new FallbackStore(name),
    passOnStoreError: true,
    handler(req, res, next) {
      const retryAfter = Math.max(1, Math.ceil(((req.rateLimit?.resetTime?.getTime?.() ?? Date.now() + windowMs) - Date.now()) / 1000));
      res.set('Retry-After', String(retryAfter));
      if (req.rateLimit && req.rateLimit.used === req.rateLimit.limit + 1) {
        logger.warn('Rate limit hit', { limiter: name, ip: req.ip, path: req.originalUrl, requestId: req.id, userId: req.auth?.userId });
      }
      next(new AppError(429, 'RATE_LIMITED', `Too many requests. Try again in ${retryAfter} seconds.`));
    },
  });
}

const MINUTE = 60 * 1000;

// ---------------------------------------------------------------- auth (public)

/** Failed logins per IP. Successful logins don't count, so a school's shared Wi-Fi isn't blocked. */
export const loginIpLimiter = limiter({ name: 'login-ip', windowMs: 15 * MINUTE, limit: env.RATE_LIMIT_LOGIN_PER_IP, skipSuccessfulRequests: true });

/**
 * Failed logins per account (tenant + identifier), from any number of IPs: stops a
 * botnet spreading guesses for one account. Complements the DB lockout (MAX_FAILED_LOGINS),
 * which this limit sits above, so it also protects accounts from being locked repeatedly.
 */
export const loginAccountLimiter = limiter({
  name: 'login-account',
  windowMs: 15 * MINUTE,
  limit: env.RATE_LIMIT_LOGIN_PER_ACCOUNT,
  skipSuccessfulRequests: true,
  // Every spelling of one phone number ("+91 98100 55555", "9810055555") is one account.
  keyGenerator: (req) => createHash('sha256').update(loginRateKey(req.body?.tenantCode, req.body?.identifier)).digest('base64url'),
  skip: (req) => !req.body?.identifier,
});

export const refreshLimiter = limiter({ name: 'refresh', windowMs: 15 * MINUTE, limit: 60 });
export const logoutLimiter = limiter({ name: 'logout', windowMs: 15 * MINUTE, limit: 30 });

// ---------------------------------------------------------------- other public endpoints

/** Public document verification (QR codes): generous for people, tight for enumeration. */
export const verifyLimiter = limiter({ name: 'verify', windowMs: 15 * MINUTE, limit: 60 });

/**
 * Coarse brake for the whole API, per IP. Generous because many users of one school
 * share a NAT IP. The payment webhook and health checks are exempt.
 */
export const apiLimiter = limiter({
  name: 'api',
  windowMs: MINUTE,
  limit: env.RATE_LIMIT_API_PER_MIN,
  skip: (req) => req.path.startsWith('/finance/webhook'),
});

// ---------------------------------------------------------------- expensive endpoints

/** PDF rendering (report cards, certificates, receipts) is CPU-heavy: per signed-in user. */
export const pdfLimiter = limiter({
  name: 'pdf',
  windowMs: MINUTE,
  limit: env.RATE_LIMIT_PDF_PER_MIN,
  keyGenerator: (req) => (req.auth ? `user:${req.auth.userId}` : ipKey(req)),
});
