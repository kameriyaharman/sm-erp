import { createHash } from 'node:crypto';
import { env } from '../config/env.js';
import { ROLES } from '../config/roles.js';
import { cache } from '../cache/cache.js';

/**
 * Response cache for heavy, read-only GET endpoints (fee ledger, analytics, defaulters, ...).
 *
 *   router.get('/students', cached({ namespace: NS.FEES, ttlSeconds: 60 }), handler)
 *
 * Safety rules:
 *  - Must run AFTER authenticate + authorize: the key includes who is asking.
 *    Admin results depend only on role + tenant + branch (see resolveBranchScope), so
 *    admins of the same branch share entries; every other role is keyed per user.
 *  - Only 200 JSON responses are stored. Errors and non-JSON (PDF) are never cached.
 *  - Writes call invalidate(namespace, tenantId); the namespace version is part of the key.
 *  - `Cache-Control: no-cache` from the client skips the read (still refreshes the entry).
 *  - Responses stay `private, no-store` for browsers and proxies: the cache is server-side only.
 */
export function cached({ namespace, ttlSeconds }) {
  return async function cacheMiddleware(req, res, next) {
    if (!env.CACHE_ENABLED || req.method !== 'GET' || !req.auth) return next();

    const auth = req.auth;
    const isAdmin = auth.role === ROLES.SUPER_ADMIN || auth.role === ROLES.BRANCH_ADMIN;
    const version = await cache.version(namespace, auth.tenantId);
    if (version === null) return next(); // can't tell what's fresh: skip the cache

    const who = isAdmin ? `${auth.role}:${auth.tenantId ?? 'platform'}:${auth.branchId ?? 'all'}` : `user:${auth.userId}`;
    const url = req.baseUrl + req.path + canonicalQuery(req.query);
    const key = cache.key('http', namespace, auth.tenantId ?? 'global', `v${version}`, hash(`${who}|${url}`));

    if (!/no-cache/i.test(req.get('cache-control') ?? '')) {
      const hit = await cache.get(key);
      if (hit !== undefined) {
        res.set({ 'X-Cache': 'HIT', 'Cache-Control': 'private, no-store' });
        return res.status(200).json(hit);
      }
    }

    res.set({ 'X-Cache': 'MISS', 'Cache-Control': 'private, no-store' });
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode === 200) cache.set(key, body, ttlSeconds).catch(() => {});
      return originalJson(body);
    };
    return next();
  };
}

function canonicalQuery(query) {
  const entries = Object.entries(query ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return entries.length ? `?${new URLSearchParams(entries.flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]]))).toString()}` : '';
}

const hash = (s) => createHash('sha256').update(s).digest('base64url').slice(0, 32);
