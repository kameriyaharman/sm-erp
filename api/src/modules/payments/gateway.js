import { env } from '../../config/env.js';
import { AppError } from '../../errors/AppError.js';
import { logger } from '../../utils/logger.js';
import { getRazorpay } from './index.js';
import { RazorpayClient } from './razorpay.client.js';
import { SecretBoxError, decryptSecret, encryptSecret, parseKey } from './secret-box.js';

/**
 * Which Razorpay account takes a payment.
 *
 *   1. the branch's own settings row (payment_gateway_settings.branch_id = branch), else
 *   2. the school's default row (branch_id IS NULL), else
 *   3. the platform account from RAZORPAY_* env vars (backward compatibility), else none.
 *
 * The most specific row wins outright: a branch row that is disabled means "this branch takes
 * no online payments", it does not fall back to the school default.
 */

export const WEBHOOK_EVENTS = Object.freeze(['payment.captured', 'payment.failed', 'order.paid']);

/** rzp_test_... -> 'test', rzp_live_... -> 'live', anything else -> null. */
export function modeOfKey(keyId) {
  const m = /^rzp_(test|live)_/.exec(String(keyId ?? ''));
  return m ? m[1] : null;
}

/** Pure: the row that applies to `branchId` from a tenant's rows (branch override, else default). */
export function pickSettings(rows, branchId) {
  return rows.find((r) => branchId && r.branch_id === branchId) ?? rows.find((r) => r.branch_id === null) ?? null;
}

// ------------------------------------------------------------------ secrets

function encryptionKey() {
  if (!env.SETTINGS_ENCRYPTION_KEY) {
    throw new AppError(503, 'ENCRYPTION_KEY_MISSING', 'The server is missing SETTINGS_ENCRYPTION_KEY, so payment keys cannot be stored or used. Ask your SM ERP administrator to set it.');
  }
  return parseKey(env.SETTINGS_ENCRYPTION_KEY);
}

/** context binds a ciphertext to its school and column (AES-GCM additional data). */
const contextFor = (tenantId, field) => `${tenantId}:${field}`;

export function sealSecret(tenantId, field, value) {
  return encryptSecret(value, { key: encryptionKey(), context: contextFor(tenantId, field) });
}

export function openSecret(tenantId, field, sealed) {
  return decryptSecret(sealed, { key: encryptionKey(), context: contextFor(tenantId, field) });
}

// ------------------------------------------------------------------ clients

/** A client for one account. The API base (RAZORPAY_API_BASE) applies to every account, so tests can point all of them at a fake. */
export function clientFor({ keyId, keySecret, webhookSecret }) {
  return new RazorpayClient({ keyId, keySecret, webhookSecret, baseUrl: env.RAZORPAY_API_BASE, timeoutMs: env.RAZORPAY_TIMEOUT_MS, logger });
}

const PLATFORM_MIN_PAISE = 100;

function platformGateway() {
  const client = getRazorpay();
  if (!client.configured) return { source: 'none', enabled: false, mode: null, keyId: null, client: null };
  return {
    source: 'platform',
    settingsId: null,
    keyId: client.keyId,
    mode: modeOfKey(client.keyId),
    enabled: true,
    allowPartial: true,          // the platform account always allowed part payments
    minAmountPaise: PLATFORM_MIN_PAISE,
    client,
  };
}

let lastDecryptWarning = 0;

/** Settings row -> gateway. Secrets that can't be decrypted make the gateway unusable (enabled: false, broken). */
export function gatewayFromRow(row) {
  const base = {
    source: row.branch_id ? 'branch' : 'school',
    settingsId: row.id,
    branchId: row.branch_id,
    keyId: row.key_id,
    mode: row.mode,
    allowPartial: row.allow_partial,
    minAmountPaise: Math.round(Number(row.min_amount) * 100),
  };
  try {
    const client = clientFor({
      keyId: row.key_id,
      keySecret: openSecret(row.tenant_id, 'key_secret', row.key_secret_enc),
      webhookSecret: openSecret(row.tenant_id, 'webhook_secret', row.webhook_secret_enc),
    });
    return { ...base, enabled: row.enabled, client };
  } catch (err) {
    if (!(err instanceof SecretBoxError) && !(err instanceof AppError)) throw err;
    if (Date.now() - lastDecryptWarning > 60_000) {
      lastDecryptWarning = Date.now();
      logger.error('Payment gateway secrets unreadable', { settingsId: row.id, tenantId: row.tenant_id, error: err.message });
    }
    return { ...base, enabled: false, broken: true, client: null };
  }
}

export async function loadTenantSettings(db, tenantId) {
  const { rows } = await db.query(`SELECT * FROM payment_gateway_settings WHERE tenant_id = $1 ORDER BY branch_id NULLS FIRST`, [tenantId]);
  return rows;
}

/** The gateway that takes payments for a student of this branch. */
export async function resolveGateway(db, { tenantId, branchId }) {
  const { rows } = await db.query(
    `SELECT * FROM payment_gateway_settings WHERE tenant_id = $1 AND (branch_id IS NULL OR branch_id = $2)`,
    [tenantId, branchId],
  );
  const row = pickSettings(rows, branchId);
  return row ? gatewayFromRow(row) : platformGateway();
}

/**
 * The account an existing order was created with (for reconcile): matched by key id, so
 * re-saving the same keys keeps old orders reachable. Orders from before migration 013
 * (gateway_key_id NULL) belong to the platform account.
 */
export async function gatewayForOrder(db, order) {
  const platform = platformGateway();
  if (!order.gateway_key_id) {
    if (platform.client) return platform;
    throw new AppError(409, 'GATEWAY_GONE', 'This payment was taken with the platform Razorpay account, which is no longer configured.');
  }
  const { rows } = await db.query(
    `SELECT * FROM payment_gateway_settings WHERE tenant_id = $1 AND key_id = $2 ORDER BY (branch_id = $3) DESC NULLS LAST LIMIT 1`,
    [order.tenant_id, order.gateway_key_id, order.branch_id],
  );
  if (rows[0]) {
    const gw = gatewayFromRow(rows[0]);
    if (gw.client) return gw;
    throw new AppError(503, 'GATEWAY_KEYS_UNREADABLE', 'The saved Razorpay keys cannot be read. Enter them again in Settings -> Online payments.');
  }
  if (platform.client && platform.keyId === order.gateway_key_id) return platform;
  throw new AppError(409, 'GATEWAY_GONE', 'The Razorpay account this payment was made with is no longer connected. Check it in the Razorpay Dashboard.');
}

/**
 * Webhook on a school's URL: find which of the school's accounts signed it. Every saved account
 * is tried, enabled or not, so payments started before an admin switched online payment off
 * still settle. Returns { settingsId, keyId, mode } or null.
 */
export async function matchTenantWebhook(db, tenantId, rawBody, signature) {
  if (!signature) return null;
  for (const row of await loadTenantSettings(db, tenantId)) {
    let secret;
    try {
      secret = openSecret(row.tenant_id, 'webhook_secret', row.webhook_secret_enc);
    } catch {
      continue;
    }
    if (clientFor({ keyId: row.key_id, keySecret: 'x', webhookSecret: secret }).verifyWebhookSignature(rawBody, signature)) {
      return { settingsId: row.id, keyId: row.key_id, mode: row.mode };
    }
  }
  return null;
}

/** Test keys in production only for schools listed in PAYMENTS_TEST_TENANTS (the demo school by default). */
export function testKeysAllowed(tenantCode) {
  return !env.isProduction || env.PAYMENTS_TEST_TENANTS.includes(String(tenantCode).toLowerCase());
}
