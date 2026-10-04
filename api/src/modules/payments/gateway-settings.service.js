import { env } from '../../config/env.js';
import { ROLES } from '../../config/roles.js';
import { pool, withTransaction } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { fromPaise } from '../../utils/money.js';
import { getRazorpay } from './index.js';
import { WEBHOOK_EVENTS, clientFor, gatewayFromRow, modeOfKey, sealSecret, testKeysAllowed } from './gateway.js';
import { last4 } from './secret-box.js';
import * as repo from './gateway-settings.repository.js';

/**
 * Settings -> Online payments: a school connects its OWN Razorpay account.
 *
 *   owner (super_admin of the tenant)  the school-wide account + any branch's override
 *   branch_admin                       an override for their own branch only (sees the school account, masked)
 *
 * Secrets are write-only: encrypted before they reach the database and never returned (only
 * "set" + the last 4 characters). They are never logged.
 */

const unprocessable = (code, message, details) => new AppError(422, code, message, details);

function callerScope(auth) {
  if (!auth.tenantId) {
    throw unprocessable('TENANT_REQUIRED', 'Payment settings belong to a school. Sign in with a school account to manage them.');
  }
  return auth.role === ROLES.SUPER_ADMIN
    ? { tenantId: auth.tenantId, branchIds: null, canEditSchool: true }
    : { tenantId: auth.tenantId, branchIds: [auth.branchId], canEditSchool: false };
}

/**
 * The settings row a write targets. undefined = the caller's natural level (owner: school,
 * branch admin: own branch); null = the school-wide account (owner only); uuid = a branch.
 */
async function targetBranch(auth, scope, branchId) {
  if (branchId === undefined) return scope.canEditSchool ? null : auth.branchId;
  if (branchId === null) {
    if (!scope.canEditSchool) throw AppError.forbidden('Only the school owner can change the school-wide Razorpay account', 'OWNER_ONLY');
    return null;
  }
  if (!scope.canEditSchool) {
    if (branchId !== auth.branchId) throw AppError.forbidden('You can only access your own branch', 'BRANCH_SCOPE_VIOLATION');
    return branchId;
  }
  const branches = await repo.listBranches(pool, scope.tenantId, [branchId]);
  if (branches.length === 0) throw AppError.notFound('Branch not found', 'BRANCH_NOT_FOUND');
  return branchId;
}

/** The public URL Razorpay must call for this school. */
export function webhookUrlFor(baseUrl, tenantCode) {
  return `${String(baseUrl).replace(/\/+$/, '')}/api/v1/finance/webhook/${encodeURIComponent(String(tenantCode).toLowerCase())}`;
}

function view(row) {
  if (!row) return null;
  return {
    id: row.id,
    branchId: row.branch_id,
    provider: row.provider,
    keyId: row.key_id,
    mode: row.mode,
    keySecretSet: true,
    keySecretLast4: row.key_secret_last4,
    webhookSecretSet: true,
    webhookSecretLast4: row.webhook_secret_last4,
    enabled: row.enabled,
    allowPartial: row.allow_partial,
    minAmount: typeof row.min_amount === 'string' ? row.min_amount : Number(row.min_amount).toFixed(2),
    verifiedAt: row.verified_at,
    verifyError: row.verify_error,
    lastWebhookAt: row.last_webhook_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by_name ? { name: row.updated_by_name } : null,
  };
}

function platformInfo() {
  const rzp = getRazorpay();
  return rzp.configured ? { configured: true, mode: modeOfKey(rzp.keyId) } : { configured: false, mode: null };
}

export async function getSettings(auth, { webhookBase }) {
  const scope = callerScope(auth);
  const [tenant, rows, branches] = await Promise.all([
    repo.getTenant(pool, scope.tenantId),
    repo.listSettings(pool, scope.tenantId),
    repo.listBranches(pool, scope.tenantId, scope.branchIds),
  ]);
  const school = rows.find((r) => r.branch_id === null) ?? null;
  const platform = platformInfo();
  return {
    schoolCode: tenant.code,
    schoolName: tenant.name,
    webhook: { url: webhookUrlFor(webhookBase, tenant.code), events: WEBHOOK_EVENTS },
    canEditSchool: scope.canEditSchool,
    testKeysAllowed: testKeysAllowed(tenant.code),
    encryptionReady: Boolean(env.SETTINGS_ENCRYPTION_KEY),
    platform,
    school: view(school),
    branches: branches.map((b) => {
      const own = rows.find((r) => r.branch_id === b.id) ?? null;
      const applies = own ?? school;
      return {
        id: b.id,
        name: b.name,
        code: b.code,
        isHeadOffice: b.is_head_office,
        settings: view(own),
        effective: applies
          ? { source: own ? 'branch' : 'school', enabled: applies.enabled, mode: applies.mode }
          : platform.configured
            ? { source: 'platform', enabled: true, mode: platform.mode }
            : { source: 'none', enabled: false, mode: null },
      };
    }),
  };
}

/**
 * Save keys and options. Changed keys are checked with Razorpay first: keys Razorpay rejects
 * are not saved (422 INVALID_KEYS); if Razorpay can't be reached they are saved but stay off
 * until "Test connection" succeeds.
 */
export async function saveSettings(auth, input, { webhookBase, logger }) {
  const scope = callerScope(auth);
  const branchId = await targetBranch(auth, scope, input.branchId);
  const tenant = await repo.getTenant(pool, scope.tenantId);

  const mode = modeOfKey(input.keyId);
  if (mode === 'test' && !testKeysAllowed(tenant.code)) {
    throw unprocessable('TEST_KEYS_NOT_ALLOWED', 'This is a Test mode key (rzp_test_...). Use your Live keys (rzp_live_...) to take real payments.', {
      keyId: ['Use a Live key (rzp_live_...)'],
    });
  }

  const existing = (await repo.listSettings(pool, scope.tenantId)).find((r) => r.branch_id === branchId) ?? null;
  const keyChanged = !existing || existing.key_id !== input.keyId;
  const modeChanged = Boolean(existing) && existing.mode !== mode;
  const fieldErrors = {};
  if (keyChanged && !input.keySecret) fieldErrors.keySecret = [existing ? 'Enter the Key secret that belongs to the new Key ID' : 'Required'];
  if ((!existing || modeChanged) && !input.webhookSecret) {
    fieldErrors.webhookSecret = [existing ? 'Test and Live mode have separate webhooks: enter the secret of this mode\'s webhook' : 'Required'];
  }
  if (Object.keys(fieldErrors).length > 0) throw AppError.badRequest('Validation failed', { body: fieldErrors }, 'VALIDATION_ERROR');

  // Check new keys with Razorpay before taking any lock.
  let verifiedAt = existing?.verified_at ?? null;
  let verifyError = existing?.verify_error ?? null;
  if (keyChanged || input.keySecret) {
    const check = await clientFor({ keyId: input.keyId, keySecret: input.keySecret, webhookSecret: 'x' }).verifyCredentials().catch((err) => {
      if (err instanceof AppError && err.code === 'GATEWAY_UNAVAILABLE') return { ok: false, reason: 'gateway_error', message: 'Razorpay could not be reached to check the keys.' };
      throw err;
    });
    if (!check.ok && check.reason === 'invalid_keys') {
      throw unprocessable('INVALID_KEYS', check.message, { keySecret: ['Razorpay did not accept this Key ID + Key secret'] });
    }
    verifiedAt = check.ok ? new Date() : null;
    verifyError = check.ok ? null : check.message;
  }

  const wantEnabled = input.enabled ?? existing?.enabled ?? false;
  const enabled = wantEnabled && verifiedAt !== null;
  const values = {
    tenantId: scope.tenantId,
    branchId,
    keyId: input.keyId,
    mode,
    keySecretEnc: input.keySecret ? sealSecret(scope.tenantId, 'key_secret', input.keySecret) : existing.key_secret_enc,
    keySecretLast4: input.keySecret ? last4(input.keySecret) : existing.key_secret_last4,
    webhookSecretEnc: input.webhookSecret ? sealSecret(scope.tenantId, 'webhook_secret', input.webhookSecret) : existing.webhook_secret_enc,
    webhookSecretLast4: input.webhookSecret ? last4(input.webhookSecret) : existing.webhook_secret_last4,
    enabled,
    allowPartial: input.allowPartial ?? existing?.allow_partial ?? false,
    minAmount: input.minAmount !== undefined ? fromPaise(input.minAmount) : existing?.min_amount ?? '1.00',
    verifiedAt,
    verifyError,
    updatedBy: auth.userId,
  };

  await withTransaction(async (db) => {
    const locked = await repo.getSettingsForUpdate(db, scope.tenantId, branchId);
    if (locked) await repo.updateSettings(db, locked.id, values);
    else await repo.upsertSettings(db, values);
  });

  logger?.info('Payment gateway settings saved', {
    tenantId: scope.tenantId, branchId, keyId: input.keyId, mode, enabled, keysChanged: Boolean(input.keySecret || input.webhookSecret), by: auth.userId,
  });

  const warning = wantEnabled && !enabled
    ? 'Keys saved, but online payment stays off until Test connection succeeds (Razorpay could not be reached).'
    : null;
  return { ...(await getSettings(auth, { webhookBase })), warning };
}

/** "Test connection": asks Razorpay whether the saved Key ID + Key secret work. */
export async function testSettings(auth, input, { logger }) {
  const scope = callerScope(auth);
  const branchId = await targetBranch(auth, scope, input.branchId);
  const row = (await repo.listSettings(pool, scope.tenantId)).find((r) => r.branch_id === branchId);
  if (!row) throw AppError.notFound('No Razorpay account is connected here yet', 'NOT_CONFIGURED');

  const gateway = gatewayFromRow(row);
  let result;
  if (!gateway.client) {
    result = { ok: false, reason: 'unreadable', message: 'The saved secrets cannot be read on this server (its encryption key changed). Enter the Key secret and Webhook secret again.' };
  } else {
    result = await gateway.client.verifyCredentials().catch((err) => {
      if (err instanceof AppError && err.code === 'GATEWAY_UNAVAILABLE') return { ok: false, reason: 'gateway_error', message: 'Razorpay could not be reached. Check the server\'s internet access and try again.' };
      throw err;
    });
  }
  await repo.setVerification(pool, row.id, { ok: result.ok, error: result.ok ? null : result.message, disable: result.reason === 'invalid_keys' || result.reason === 'unreadable' });
  logger?.info('Payment gateway test', { tenantId: scope.tenantId, branchId, keyId: row.key_id, ok: result.ok, reason: result.reason, by: auth.userId });
  return {
    ok: result.ok,
    reason: result.ok ? null : result.reason,
    message: result.ok ? `Connected to Razorpay (${row.mode === 'live' ? 'Live' : 'Test'} mode). Key ${row.key_id} works.` : result.message,
    mode: row.mode,
    verifiedAt: result.ok ? new Date().toISOString() : null,
  };
}

/** Disconnect: deletes the account's keys. Payments already settled are untouched. */
export async function deleteSettings(auth, input, { logger }) {
  const scope = callerScope(auth);
  const branchId = await targetBranch(auth, scope, input.branchId);
  const row = (await repo.listSettings(pool, scope.tenantId)).find((r) => r.branch_id === branchId);
  if (!row) throw AppError.notFound('No Razorpay account is connected here', 'NOT_CONFIGURED');
  const openOrders = await repo.countOpenOrders(pool, scope.tenantId, row.key_id);
  await repo.deleteSettings(pool, scope.tenantId, branchId);
  logger?.info('Payment gateway disconnected', { tenantId: scope.tenantId, branchId, keyId: row.key_id, openOrders, by: auth.userId });
  return { openOrders };
}

