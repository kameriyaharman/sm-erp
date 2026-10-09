import { CORE_MODULES, LIMIT_FOR_CHANNEL, MODULES, effectiveLimits, effectiveModules } from '../../config/modules.js';
import { query } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';

/**
 * What a school is entitled to: its plan, subscription status, effective modules and limits.
 *
 * Read on every gated request, so it is cached in-process for 30 s per school. Changes made
 * on this replica (plan change, module switched off) invalidate the entry at once; other
 * replicas pick them up within the TTL.
 *
 * A school without a subscription row (created before plans existed, or by a script) gets
 * every module and no limits, so nothing breaks; the platform console shows it as "No plan".
 */

const TTL_MS = 30_000;
const cache = new Map();

export function invalidateEntitlements(tenantId) {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

const ALL_OPTIONAL = MODULES.filter((m) => !m.core).map((m) => m.key);

export async function loadEntitlements(db, tenantId) {
  const { rows } = await db.query(
    `SELECT t.id AS tenant_id, t.status AS tenant_status,
            s.status, s.trial_ends_at, s.current_period_end, s.module_overrides, s.limit_overrides,
            p.id AS plan_id, p.code AS plan_code, p.name AS plan_name, p.modules AS plan_modules, p.limits AS plan_limits,
            (SELECT ts.value FROM tenant_settings ts
              WHERE ts.tenant_id = t.id AND ts.branch_id IS NULL AND ts.section = 'modules') AS module_settings,
            (now() AT TIME ZONE t.timezone)::date AS today
       FROM tenants t
       LEFT JOIN tenant_subscriptions s ON s.tenant_id = t.id
       LEFT JOIN plans p                ON p.id = s.plan_id
      WHERE t.id = $1`,
    [tenantId],
  );
  const r = rows[0];
  if (!r) return null;
  const managed = Boolean(r.plan_id);
  const schoolDisabled = Array.isArray(r.module_settings?.disabled) ? r.module_settings.disabled : [];
  const modules = effectiveModules({
    planModules: managed ? r.plan_modules : ALL_OPTIONAL,
    overrides: managed ? r.module_overrides : {},
    schoolDisabled,
  });
  const today = r.today instanceof Date ? r.today.toISOString().slice(0, 10) : String(r.today);
  const trialEnds = r.trial_ends_at ? (r.trial_ends_at instanceof Date ? r.trial_ends_at.toISOString().slice(0, 10) : String(r.trial_ends_at)) : null;
  return {
    tenantId: r.tenant_id,
    managed,
    plan: managed ? { id: r.plan_id, code: r.plan_code, name: r.plan_name } : null,
    status: managed ? r.status : 'active',
    tenantStatus: r.tenant_status,
    trialEndsAt: trialEnds,
    trialDaysLeft: r.status === 'trial' && trialEnds ? Math.round((Date.parse(trialEnds) - Date.parse(today)) / 86_400_000) : null,
    currentPeriodEnd: r.current_period_end,
    modules: modules.enabled,
    availableModules: modules.available,
    schoolDisabled: schoolDisabled.filter((k) => !CORE_MODULES.includes(k)),
    limits: managed ? effectiveLimits(r.plan_limits, r.limit_overrides) : effectiveLimits({}, {}),
  };
}

export async function getEntitlements(tenantId) {
  if (!tenantId) return null;
  const hit = cache.get(tenantId);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await loadEntitlements({ query }, tenantId);
  cache.set(tenantId, { value, expires: Date.now() + TTL_MS });
  return value;
}

export async function isModuleEnabled(tenantId, key) {
  if (!tenantId) return true;
  const ent = await getEntitlements(tenantId);
  return !ent || ent.modules.includes(key);
}

const label = (key) => MODULES.find((m) => m.key === key)?.label ?? key;

/** 403 MODULE_DISABLED unless at least one of `keys` is on for the school (platform admins pass). */
export async function assertModule(tenantId, ...keys) {
  if (!tenantId) return;
  const ent = await getEntitlements(tenantId);
  if (!ent || keys.some((k) => ent.modules.includes(k))) return;
  const inPlan = keys.some((k) => ent.availableModules.includes(k));
  throw AppError.forbidden(
    inPlan
      ? `${label(keys[0])} is switched off for your school. An administrator can switch it on under Settings -> Modules.`
      : `${label(keys[0])} is not included in your plan${ent.plan ? ` (${ent.plan.name})` : ''}. Contact SM ERP to upgrade.`,
    'MODULE_DISABLED',
  );
}

// ------------------------------------------------------------------ limits + usage

/** Messages sent this calendar month (school's time zone), by channel and by whose account. */
export async function usageThisMonth(db, tenantId) {
  const { rows } = await db.query(
    `SELECT l.channel, COALESCE(l.account, 'platform') AS account, count(*)::int AS sent
       FROM notification_logs l
       JOIN tenants t ON t.id = l.tenant_id
      WHERE l.tenant_id = $1 AND l.status = 'sent'
        AND l.created_at >= (date_trunc('month', now() AT TIME ZONE t.timezone) AT TIME ZONE t.timezone)
      GROUP BY l.channel, COALESCE(l.account, 'platform')`,
    [tenantId],
  );
  const out = { whatsapp: { school: 0, platform: 0 }, sms: { school: 0, platform: 0 }, email: { school: 0, platform: 0 } };
  for (const r of rows) if (out[r.channel]) out[r.channel][r.account] = r.sent;
  return out;
}

const quotaCache = new Map();

/**
 * Platform-account messages left this month for a channel (null = unlimited). Cached 60 s:
 * a quota can be overshot by a minute's worth of messages, never by more.
 */
export async function platformQuotaLeft(tenantId, channel) {
  const ent = await getEntitlements(tenantId);
  const limit = ent?.limits?.[LIMIT_FOR_CHANNEL[channel]];
  if (limit === null || limit === undefined) return null;
  const key = `${tenantId}:${channel}`;
  const hit = quotaCache.get(key);
  let used;
  if (hit && hit.expires > Date.now()) used = hit.used;
  else {
    used = (await usageThisMonth({ query }, tenantId))[channel]?.platform ?? 0;
    quotaCache.set(key, { used, expires: Date.now() + 60_000 });
  }
  return Math.max(0, limit - used);
}

export async function countActiveStudents(db, tenantId) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM student_profiles WHERE tenant_id = $1 AND deleted_at IS NULL AND status IN ('enrolled', 'suspended')`,
    [tenantId],
  );
  return rows[0].n;
}

/** 403 PLAN_LIMIT_REACHED when admitting one more student would exceed the plan. */
export async function assertStudentCapacity(db, tenantId, adding = 1) {
  const ent = await getEntitlements(tenantId);
  const max = ent?.limits?.maxStudents;
  if (max === null || max === undefined) return;
  const current = await countActiveStudents(db, tenantId);
  if (current + adding > max) {
    throw AppError.forbidden(
      `Your plan allows ${max} students and the school has ${current}. Contact SM ERP to raise the limit.`,
      'PLAN_LIMIT_REACHED',
    );
  }
}
