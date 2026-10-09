import { CHANNEL_MODULE } from '../../config/modules.js';
import { env as appEnv } from '../../config/env.js';
import { pool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { decryptSecret, encryptSecret, parseKey, SecretBoxError } from '../payments/secret-box.js';
import { getEntitlements, platformQuotaLeft } from '../saas/entitlements.js';
import { defaultRule, EVENTS } from './catalog.js';
import { buildProvider } from './channel-registry.js';
import { NotificationError } from './errors.js';

/**
 * Per-school delivery setup for the NotificationService:
 *
 *   resolve({ tenantId, branchId }) -> {
 *     providers: { whatsapp, sms, email },     ready-to-use providers (school's own or the platform's), or absent
 *     accounts:  { whatsapp: 'school'|'platform', ... },
 *     rule(eventType)      -> { enabled, channels, audience, timing }
 *     templates(eventType) -> { sms?, whatsapp?, email? }   the school's saved templates
 *     displayName          name to use in messages, or null
 *   }
 *
 * Channel resolution (per channel): the branch's own row, else the school's row, else the platform
 * account. A row that is switched off means "don't use this channel". A channel whose module is
 * off for the school (plan / Settings -> Modules) is never used. Platform-account sends are
 * counted against the plan's monthly quota.
 *
 * Cached 30 s per (school, branch); the settings screens call invalidate() after a change.
 */

const TTL_MS = 30_000;

// ------------------------------------------------------------------ secrets

function key() {
  if (!appEnv.SETTINGS_ENCRYPTION_KEY) {
    throw new AppError(503, 'ENCRYPTION_KEY_MISSING', 'The server is missing SETTINGS_ENCRYPTION_KEY, so account passwords and tokens cannot be stored. Ask your SM ERP administrator to set it.');
  }
  return parseKey(appEnv.SETTINGS_ENCRYPTION_KEY);
}

/** Seals a channel's secrets object, bound to the school and channel. */
export function sealChannelSecrets(tenantId, channel, secrets) {
  return encryptSecret(JSON.stringify(secrets), { key: key(), context: `${tenantId}:channel:${channel}` });
}

export function openChannelSecrets(tenantId, channel, sealed) {
  if (!sealed) return {};
  return JSON.parse(decryptSecret(sealed, { key: key(), context: `${tenantId}:channel:${channel}` }));
}

// ------------------------------------------------------------------ quota guard

/** Wraps a platform provider: refuses (and lets the next channel try) once the month's quota is used. */
function withQuota(provider, tenantId, channel) {
  return {
    name: provider.name,
    supports: (c) => provider.supports(c),
    async send(message) {
      const left = await platformQuotaLeft(tenantId, channel);
      if (left !== null && left <= 0) {
        throw new NotificationError('QUOTA_EXCEEDED', `This month's ${channel} allowance on your plan is used up`, { provider: provider.name, tryNextChannel: true });
      }
      return provider.send(message);
    },
  };
}

// ------------------------------------------------------------------ resolver

export function createTenantResolver({ platformProviders = {}, logger, env = appEnv, db = pool }) {
  const cache = new Map();

  async function load(tenantId, branchId) {
    const [ent, channelRows, templateRows, ruleRows, messaging] = await Promise.all([
      getEntitlements(tenantId),
      db.query(
        `SELECT id, branch_id, channel, provider, config, secrets_enc, enabled
           FROM communication_channels
          WHERE tenant_id = $1 AND (branch_id IS NULL OR branch_id = $2::uuid)`,
        [tenantId, branchId ?? null],
      ),
      // A WhatsApp template is used only once approved; until then the default one keeps working.
      db.query(
        `SELECT event_type, channel, language, name, subject, body, params FROM message_templates
          WHERE tenant_id = $1 AND (channel <> 'whatsapp' OR approval_status = 'approved')`,
        [tenantId],
      ),
      db.query(`SELECT event_type, enabled, channels, audience, timing FROM notification_rules WHERE tenant_id = $1`, [tenantId]),
      db.query(`SELECT value FROM tenant_settings WHERE tenant_id = $1 AND branch_id IS NULL AND section = 'messaging'`, [tenantId]),
    ]);

    const providers = {};
    const accounts = {};
    const problems = {};
    for (const channel of ['whatsapp', 'sms', 'email']) {
      if (ent && !ent.modules.includes(CHANNEL_MODULE[channel])) continue;
      const rows = channelRows.rows.filter((r) => r.channel === channel);
      const row = (branchId && rows.find((r) => r.branch_id === branchId)) || rows.find((r) => r.branch_id === null) || null;
      if (row && !row.enabled) continue;
      if (!row || row.provider === 'platform') {
        const platform = platformProviders[channel];
        if (platform?.supports(channel)) {
          providers[channel] = withQuota(platform, tenantId, channel);
          accounts[channel] = 'platform';
        }
        continue;
      }
      try {
        const secrets = openChannelSecrets(tenantId, channel, row.secrets_enc);
        providers[channel] = buildProvider(channel, row.provider, { ...row.config, replyTo: messaging.rows[0]?.value?.replyToEmail ?? undefined }, secrets, { env });
        accounts[channel] = 'school';
      } catch (err) {
        problems[channel] = err instanceof SecretBoxError ? 'Saved credentials cannot be read (encryption key changed): enter them again' : err.message;
        logger?.error('School channel unusable', { tenantId, branchId, channel, provider: row.provider, error: problems[channel] });
      }
    }

    const templates = {};
    for (const t of templateRows.rows) {
      (templates[t.event_type] ??= {})[t.channel] = { name: t.name, subject: t.subject, body: t.body, params: t.params ?? [], language: t.language };
    }
    const rules = {};
    for (const r of ruleRows.rows) rules[r.event_type] = { enabled: r.enabled, channels: r.channels, audience: r.audience, timing: r.timing };

    return {
      tenantId,
      branchId: branchId ?? null,
      providers,
      accounts,
      problems,
      displayName: messaging.rows[0]?.value?.displayName || null,
      replyToEmail: messaging.rows[0]?.value?.replyToEmail || null,
      rule(eventType) {
        return rules[eventType] ?? defaultRule(eventType) ?? { enabled: true, channels: ['whatsapp', 'sms'], audience: 'guardians', timing: { mode: 'immediate' } };
      },
      templates(eventType) {
        return templates[eventType] ?? {};
      },
    };
  }

  return {
    async resolve({ tenantId, branchId = null }) {
      if (!tenantId) return null;
      const cacheKey = `${tenantId}:${branchId ?? '-'}`;
      const hit = cache.get(cacheKey);
      if (hit && hit.expires > Date.now()) return hit.value;
      const value = await load(tenantId, branchId);
      cache.set(cacheKey, { value, expires: Date.now() + TTL_MS });
      return value;
    },
    invalidate(tenantId) {
      for (const k of cache.keys()) if (!tenantId || k.startsWith(`${tenantId}:`)) cache.delete(k);
    },
  };
}

export { EVENTS };
