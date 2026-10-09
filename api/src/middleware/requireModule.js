import { MODULE_KEYS } from '../config/modules.js';
import { assertModule } from '../modules/saas/entitlements.js';

/**
 * Plan / module gate. Must run after `authenticate`.
 *
 *   router.use(authenticate, requireModule('transport'))
 *
 * Passes when ANY of the keys is enabled for the caller's school (plan + overrides, minus what
 * the school switched off). Platform super admins (no school) always pass. Otherwise
 * 403 MODULE_DISABLED with a sentence saying whether to upgrade or to switch it on.
 */
export function requireModule(...keys) {
  const list = keys.flat();
  const unknown = list.filter((k) => !MODULE_KEYS.includes(k));
  if (list.length === 0 || unknown.length > 0) {
    throw new Error(`requireModule() needs known module keys; got: ${unknown.join(', ') || '(none)'}`);
  }
  return async function requireModuleMiddleware(req, _res, next) {
    await assertModule(req.auth?.tenantId ?? null, ...list);
    next();
  };
}
