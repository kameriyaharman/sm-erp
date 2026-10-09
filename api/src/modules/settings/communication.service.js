import { CHANNEL_MODULE, LIMIT_FOR_CHANNEL } from '../../config/modules.js';
import { env } from '../../config/env.js';
import { pool, withTransaction } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { logger } from '../../utils/logger.js';
import { last4 } from '../payments/secret-box.js';
import { getEntitlements, usageThisMonth } from '../saas/entitlements.js';
import { buildProvider, PROVIDERS, verifyProvider } from '../notifications/channel-registry.js';
import { getNotifier, invalidateSchoolMessaging } from '../notifications/index.js';
import { NotificationError } from '../notifications/errors.js';
import { openChannelSecrets, sealChannelSecrets } from '../notifications/tenant-resolver.js';
import { diffValues, recordAudit } from './audit.js';
import { assertSchoolEditor, settingsScope, targetBranch } from './scope.js';

/**
 * Settings -> Communication: which WhatsApp / SMS / email account the school's messages go out
 * from. Either the SM ERP platform account (counted against the plan) or the school's own
 * (Meta WhatsApp Cloud API, WATI, Twilio, MSG91, SMTP). Owner: school-wide + per-branch rows;
 * branch admin: their branch's row (or everything when the school has one branch).
 *
 * Secrets are write-only: encrypted before they reach the database, shown as "set, ••••ab12".
 */

const CHANNEL_LABEL = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email' };

function view(row) {
  if (!row) return null;
  return {
    id: row.id,
    branchId: row.branch_id,
    provider: row.provider,
    config: row.config,
    secrets: Object.fromEntries(Object.entries(row.secret_hints ?? {}).map(([k, hint]) => [k, { set: true, last4: hint }])),
    enabled: row.enabled,
    verifiedAt: row.verified_at,
    verifyError: row.verify_error,
    lastUsedAt: row.last_used_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by_name ? { name: row.updated_by_name } : null,
  };
}

function platformAvailable(channel) {
  const notifier = getNotifier({ env, logger });
  return Boolean(notifier.providers[channel]?.supports(channel));
}

async function rowsFor(db, tenantId, channel) {
  const { rows } = await db.query(
    `SELECT c.*, NULLIF(concat_ws(' ', u.first_name, u.last_name), '') AS updated_by_name
       FROM communication_channels c
       LEFT JOIN users u ON u.id = c.updated_by
      WHERE c.tenant_id = $1 AND ($2::text IS NULL OR c.channel = $2)
      ORDER BY c.branch_id NULLS FIRST`,
    [tenantId, channel ?? null],
  );
  return rows;
}

export async function getCommunication(auth, { tenantId }) {
  const scope = await settingsScope(auth, { tenantId });
  const [ent, rows, usage] = await Promise.all([getEntitlements(scope.tenantId), rowsFor(pool, scope.tenantId, null), usageThisMonth(pool, scope.tenantId)]);

  const channels = {};
  for (const channel of ['whatsapp', 'sms', 'email']) {
    const mine = rows.filter((r) => r.channel === channel);
    const school = mine.find((r) => r.branch_id === null) ?? null;
    const limit = ent?.limits?.[LIMIT_FOR_CHANNEL[channel]];
    channels[channel] = {
      label: CHANNEL_LABEL[channel],
      module: ent ? ent.modules.includes(CHANNEL_MODULE[channel]) : true,
      inPlan: ent ? ent.availableModules.includes(CHANNEL_MODULE[channel]) : true,
      platformAvailable: platformAvailable(channel),
      providers: Object.entries(PROVIDERS[channel]).map(([key, def]) => ({ key, label: def.label, help: def.help, secrets: def.secrets.map((s) => ({ key: s.key, label: s.label })) })),
      school: view(school),
      branches: scope.branches.map((b) => {
        const own = mine.find((r) => r.branch_id === b.id) ?? null;
        const applies = own ?? school;
        return {
          id: b.id,
          name: b.name,
          settings: view(own),
          effective: applies ? { source: own ? 'branch' : 'school', provider: applies.provider, enabled: applies.enabled } : { source: 'platform', provider: 'platform', enabled: true },
        };
      }),
      usage: { ...usage[channel], platformLimit: limit ?? null },
    };
  }
  return {
    canEditSchool: scope.canEditSchool,
    encryptionReady: Boolean(env.SETTINGS_ENCRYPTION_KEY),
    channels,
  };
}

function validate(channel, provider, config) {
  const def = PROVIDERS[channel]?.[provider];
  if (!def) throw AppError.badRequest('Validation failed', { body: { provider: [`Choose one of: ${Object.keys(PROVIDERS[channel] ?? {}).join(', ')}`] } }, 'VALIDATION_ERROR');
  const parsed = def.config.safeParse(config ?? {});
  if (!parsed.success) throw AppError.badRequest('Validation failed', { body: parsed.error.flatten().fieldErrors }, 'VALIDATION_ERROR');
  return { def, config: parsed.data };
}

/**
 * Saves a channel. New secrets are merged over the saved ones (leave a secret empty to keep it).
 * Credentials are checked with the provider first where it offers a read-only check: rejected
 * credentials are not saved (422 INVALID_CREDENTIALS); if the provider can't be reached they
 * are saved but the channel stays off until "Test connection" succeeds.
 */
export async function saveChannel(auth, channel, input) {
  const scope = await settingsScope(auth, { tenantId: input.tenantId });
  const branchId = input.branchId === undefined ? (scope.canEditSchool ? null : scope.ownBranchId) : input.branchId;
  const target = branchId === null ? (assertSchoolEditor(scope, `the school's ${CHANNEL_LABEL[channel]} account`), null) : targetBranch(scope, branchId);
  const ent = await getEntitlements(scope.tenantId);
  if (ent && !ent.availableModules.includes(CHANNEL_MODULE[channel])) {
    throw AppError.forbidden(`${CHANNEL_LABEL[channel]} is not included in your plan. Contact SM ERP to upgrade.`, 'MODULE_DISABLED');
  }
  const { def, config } = validate(channel, input.provider, input.config);

  const existing = (await rowsFor(pool, scope.tenantId, channel)).find((r) => r.branch_id === target) ?? null;
  let secrets = {};
  if (input.provider !== 'platform') {
    const previous = existing && existing.provider === input.provider ? safeOpen(scope.tenantId, channel, existing.secrets_enc) : {};
    secrets = { ...previous };
    for (const s of def.secrets) {
      const value = input.secrets?.[s.key];
      if (typeof value === 'string' && value.trim() !== '') {
        if (value.trim().length < (s.minLength ?? 1)) {
          throw AppError.badRequest('Validation failed', { body: { [s.key]: [`${s.label} looks too short`] } }, 'VALIDATION_ERROR');
        }
        secrets[s.key] = value.trim();
      }
    }
    const missing = def.secrets.filter((s) => !secrets[s.key]);
    if (missing.length) {
      throw AppError.badRequest('Validation failed', { body: Object.fromEntries(missing.map((s) => [s.key, ['Required']])) }, 'VALIDATION_ERROR');
    }
  } else if (!platformAvailable(channel)) {
    throw new AppError(422, 'PLATFORM_NOT_AVAILABLE', `SM ERP's shared ${CHANNEL_LABEL[channel]} account is not set up on this server. Connect your own account instead.`);
  }

  // Check new credentials before saving.
  const credentialsChanged = input.provider !== 'platform' && (!existing || existing.provider !== input.provider || JSON.stringify(existing.config) !== JSON.stringify(config) || def.secrets.some((s) => input.secrets?.[s.key]));
  let verifiedAt = input.provider === 'platform' ? new Date() : existing?.provider === input.provider ? existing.verified_at : null;
  let verifyError = credentialsChanged ? null : existing?.verify_error ?? null;
  if (credentialsChanged) {
    const check = await runVerify(channel, input.provider, config, secrets);
    if (check.ok === false && check.reason === 'invalid_credentials') {
      throw new AppError(422, 'INVALID_CREDENTIALS', check.message, { body: Object.fromEntries(def.secrets.map((s) => [s.key, [check.message]])) });
    }
    verifiedAt = check.ok ? new Date() : null;
    verifyError = check.ok === false ? check.message : null;
  }
  const wantEnabled = input.enabled ?? existing?.enabled ?? true;
  // A provider without a read-only check (MSG91) may be switched on unverified: the test message proves it.
  const enabled = wantEnabled && (verifiedAt !== null || !credentialsChanged || verifyError === null);

  const hints = Object.fromEntries(def.secrets.filter((s) => secrets[s.key]).map((s) => [s.key, last4(secrets[s.key])]));
  const sealed = input.provider === 'platform' ? null : sealChannelSecrets(scope.tenantId, channel, secrets);

  await withTransaction(async (db) => {
    const { rows } = await db.query(
      `SELECT id FROM communication_channels
        WHERE tenant_id = $1 AND channel = $2 AND branch_id IS NOT DISTINCT FROM $3::uuid FOR UPDATE`,
      [scope.tenantId, channel, target],
    );
    if (rows[0]) {
      await db.query(
        `UPDATE communication_channels
            SET provider = $2, config = $3, secrets_enc = $4, secret_hints = $5, enabled = $6, verified_at = $7, verify_error = left($8, 300), updated_by = $9
          WHERE id = $1`,
        [rows[0].id, input.provider, JSON.stringify(config), sealed, JSON.stringify(hints), enabled, verifiedAt, verifyError, auth.userId],
      );
    } else {
      await db.query(
        `INSERT INTO communication_channels (tenant_id, branch_id, channel, provider, config, secrets_enc, secret_hints, enabled, verified_at, verify_error, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, left($10, 300), $11)`,
        [scope.tenantId, target, channel, input.provider, JSON.stringify(config), sealed, JSON.stringify(hints), enabled, verifiedAt, verifyError, auth.userId],
      );
    }
    await recordAudit(db, {
      tenantId: scope.tenantId,
      branchId: target,
      actorUserId: auth.userId,
      area: 'communication',
      action: existing ? 'update' : 'create',
      summary: `${CHANNEL_LABEL[channel]}: ${PROVIDERS[channel][input.provider].label}${enabled ? '' : ' (off)'}${Object.keys(hints).length && credentialsChanged ? ', credentials changed' : ''}`,
      changes: diffValues(existing ? { provider: existing.provider, config: existing.config, enabled: existing.enabled } : {}, { provider: input.provider, config, enabled }),
    });
  });
  invalidateSchoolMessaging(scope.tenantId);
  logger.info('Communication channel saved', { tenantId: scope.tenantId, branchId: target, channel, provider: input.provider, enabled, by: auth.userId });

  const warning = wantEnabled && !enabled ? `Saved, but ${CHANNEL_LABEL[channel]} stays off until "Test connection" succeeds: ${verifyError ?? 'the provider could not be reached'}.` : null;
  return { ...(await getCommunication(auth, { tenantId: input.tenantId })), warning };
}

function safeOpen(tenantId, channel, sealed) {
  try {
    return openChannelSecrets(tenantId, channel, sealed);
  } catch {
    return {};
  }
}

async function runVerify(channel, provider, config, secrets) {
  try {
    const instance = buildProvider(channel, provider, config, secrets, { env });
    return await verifyProvider(channel, provider, instance, config, secrets, { env });
  } catch (err) {
    if (err instanceof NotificationError) return { ok: false, reason: err.retryable ? 'unreachable' : 'rejected', message: err.message };
    return { ok: false, reason: 'rejected', message: err.message };
  }
}

async function loadRow(auth, channel, { tenantId, branchId }) {
  const scope = await settingsScope(auth, { tenantId });
  const target = branchId ? targetBranch(scope, branchId) : scope.canEditSchool ? null : scope.ownBranchId;
  const rows = await rowsFor(pool, scope.tenantId, channel);
  const row = rows.find((r) => r.branch_id === target) ?? (target ? rows.find((r) => r.branch_id === null) : null) ?? null;
  return { scope, target, row };
}

/** "Test connection": read-only credential check with the provider. */
export async function verifyChannel(auth, channel, input) {
  const { scope, row } = await loadRow(auth, channel, input);
  if (!row || row.provider === 'platform') {
    return { ok: platformAvailable(channel), message: platformAvailable(channel) ? `Using the SM ERP ${CHANNEL_LABEL[channel]} account.` : `SM ERP's shared ${CHANNEL_LABEL[channel]} account is not set up on this server.` };
  }
  let result;
  try {
    const secrets = openChannelSecrets(scope.tenantId, channel, row.secrets_enc);
    result = await runVerify(channel, row.provider, row.config, secrets);
  } catch {
    result = { ok: false, reason: 'unreadable', message: 'The saved credentials cannot be read on this server (its encryption key changed). Enter them again.' };
  }
  await pool.query(
    `UPDATE communication_channels
        SET verified_at = CASE WHEN $2 THEN now() WHEN $4 THEN NULL ELSE verified_at END,
            verify_error = $3,
            enabled = CASE WHEN $4 THEN false ELSE enabled END
      WHERE id = $1`,
    [row.id, result.ok === true, result.ok === false ? String(result.message).slice(0, 300) : null, result.ok === false && ['invalid_credentials', 'unreadable'].includes(result.reason)],
  );
  await recordAudit(pool, { tenantId: scope.tenantId, branchId: row.branch_id, actorUserId: auth.userId, area: 'communication', action: 'test', summary: `${CHANNEL_LABEL[channel]} connection test: ${result.ok === true ? 'ok' : result.ok === false ? 'failed' : 'no check available'}` });
  invalidateSchoolMessaging(scope.tenantId);
  return { ok: result.ok, message: result.message, details: result.details ?? null };
}

/**
 * Sends a real test message through the school's setup for this channel. WhatsApp and SMS use the
 * notice template (business-initiated WhatsApp needs an approved template; Indian SMS a DLT one).
 */
export async function sendTest(auth, channel, input) {
  const { scope, target } = await loadRow(auth, channel, input);
  const notifier = getNotifier({ env, logger });
  invalidateSchoolMessaging(scope.tenantId);
  const to = channel === 'email' ? { email: input.to } : { phone: input.to };
  const result = await notifier.sendEvent(
    'general_notice',
    to,
    { noticeTitle: 'Test message', noticeBody: `This is a test from SM ERP: ${CHANNEL_LABEL[channel]} messages from your school are working.`, schoolName: scope.school.name },
    { tenantId: scope.tenantId, branchId: target, channels: [channel], ignoreRule: true, eventType: 'test_message', createdBy: auth.userId, maxRetries: 0 },
  );
  await recordAudit(pool, { tenantId: scope.tenantId, branchId: target, actorUserId: auth.userId, area: 'communication', action: 'test', summary: `${CHANNEL_LABEL[channel]} test message: ${result.ok ? 'sent' : `failed (${result.error?.code})`}` });
  if (result.ok) {
    await pool.query(`UPDATE communication_channels SET last_used_at = now() WHERE tenant_id = $1 AND channel = $2 AND branch_id IS NOT DISTINCT FROM $3::uuid`, [scope.tenantId, channel, target]);
  }
  return {
    ok: Boolean(result.ok),
    channel: result.channel ?? channel,
    provider: result.provider ?? null,
    account: result.account ?? null,
    message: result.ok
      ? `Sent via ${result.provider}${result.account === 'platform' ? ' (SM ERP account)' : ''}. It may take a minute to arrive.`
      : `Not sent: ${result.error?.message ?? 'unknown error'}`,
    error: result.ok ? null : result.error,
  };
}

/** Removes the school's (or a branch's) own account: messages fall back to the school-wide row / platform. */
export async function deleteChannel(auth, channel, { tenantId, branchId }) {
  const scope = await settingsScope(auth, { tenantId });
  const target = branchId ? targetBranch(scope, branchId) : (assertSchoolEditor(scope), null);
  const { rowCount } = await pool.query(
    `DELETE FROM communication_channels WHERE tenant_id = $1 AND channel = $2 AND branch_id IS NOT DISTINCT FROM $3::uuid`,
    [scope.tenantId, channel, target],
  );
  if (rowCount === 0) throw AppError.notFound('Nothing is connected here', 'NOT_CONFIGURED');
  await recordAudit(pool, { tenantId: scope.tenantId, branchId: target, actorUserId: auth.userId, area: 'communication', action: 'delete', summary: `${CHANNEL_LABEL[channel]}: own account removed${target ? ' for a branch' : ''}` });
  invalidateSchoolMessaging(scope.tenantId);
  return getCommunication(auth, { tenantId });
}

/** The school's Meta WhatsApp provider (templates sync / submit), or 422. */
export async function metaProviderFor(scope) {
  const { rows } = await pool.query(
    `SELECT * FROM communication_channels WHERE tenant_id = $1 AND channel = 'whatsapp' AND branch_id IS NULL`,
    [scope.tenantId],
  );
  const row = rows[0];
  if (!row || row.provider !== 'meta_cloud') {
    throw new AppError(422, 'META_NOT_CONNECTED', 'Connect your own number with the WhatsApp Cloud API (Settings -> Communication) to submit and sync templates from here.');
  }
  return buildProvider('whatsapp', 'meta_cloud', row.config, openChannelSecrets(scope.tenantId, 'whatsapp', row.secrets_enc), { env });
}
