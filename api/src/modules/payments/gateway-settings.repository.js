/** payment_gateway_settings: a school's own Razorpay account(s). Secrets arrive here already encrypted. */

export async function findTenantByCode(db, code) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,62}$/.test(String(code ?? ''))) return null;
  const { rows } = await db.query(`SELECT id, code, name, status FROM tenants WHERE lower(code) = lower($1) AND deleted_at IS NULL`, [code]);
  return rows[0] ?? null;
}

export async function getTenant(db, tenantId) {
  const { rows } = await db.query(`SELECT id, code, name FROM tenants WHERE id = $1`, [tenantId]);
  return rows[0] ?? null;
}

/** Branches the caller manages (all of the tenant, or one). */
export async function listBranches(db, tenantId, branchIds) {
  const { rows } = await db.query(
    `SELECT id, name, code, is_head_office FROM branches
      WHERE tenant_id = $1 AND deleted_at IS NULL AND ($2::uuid[] IS NULL OR id = ANY ($2))
      ORDER BY is_head_office DESC, name`,
    [tenantId, branchIds],
  );
  return rows;
}

export async function listSettings(db, tenantId) {
  const { rows } = await db.query(
    `SELECT s.*, s.min_amount::text AS min_amount, NULLIF(concat_ws(' ', u.first_name, u.last_name), '') AS updated_by_name
       FROM payment_gateway_settings s
       LEFT JOIN users u ON u.id = s.updated_by
      WHERE s.tenant_id = $1
      ORDER BY s.branch_id NULLS FIRST`,
    [tenantId],
  );
  return rows;
}

export async function getSettingsForUpdate(db, tenantId, branchId) {
  const { rows } = await db.query(
    `SELECT * FROM payment_gateway_settings
      WHERE tenant_id = $1 AND branch_id IS NOT DISTINCT FROM $2::uuid
      FOR UPDATE`,
    [tenantId, branchId],
  );
  return rows[0] ?? null;
}

export async function upsertSettings(db, s) {
  const { rows } = await db.query(
    `INSERT INTO payment_gateway_settings
            (tenant_id, branch_id, key_id, mode, key_secret_enc, key_secret_last4, webhook_secret_enc, webhook_secret_last4,
             enabled, allow_partial, min_amount, verified_at, verify_error, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING id`,
    [s.tenantId, s.branchId, s.keyId, s.mode, s.keySecretEnc, s.keySecretLast4, s.webhookSecretEnc, s.webhookSecretLast4,
      s.enabled, s.allowPartial, s.minAmount, s.verifiedAt, s.verifyError, s.updatedBy],
  );
  return rows[0].id;
}

export async function updateSettings(db, id, s) {
  await db.query(
    `UPDATE payment_gateway_settings
        SET key_id = $2, mode = $3, key_secret_enc = $4, key_secret_last4 = $5, webhook_secret_enc = $6, webhook_secret_last4 = $7,
            enabled = $8, allow_partial = $9, min_amount = $10, verified_at = $11, verify_error = $12, updated_by = $13
      WHERE id = $1`,
    [id, s.keyId, s.mode, s.keySecretEnc, s.keySecretLast4, s.webhookSecretEnc, s.webhookSecretLast4,
      s.enabled, s.allowPartial, s.minAmount, s.verifiedAt, s.verifyError, s.updatedBy],
  );
}

/**
 * Records a "Test connection" result. `disable` (keys rejected by Razorpay) also switches online
 * payment off; a gateway hiccup leaves `enabled` and the last good `verified_at` as they were.
 */
export async function setVerification(db, id, { ok, error = null, disable = false }) {
  await db.query(
    `UPDATE payment_gateway_settings
        SET verified_at  = CASE WHEN $2 THEN now() WHEN $4 THEN NULL ELSE verified_at END,
            verify_error = left($3, 200),
            enabled      = enabled AND NOT $4
      WHERE id = $1`,
    [id, ok, ok ? null : error, disable],
  );
}

export async function deleteSettings(db, tenantId, branchId) {
  const { rowCount } = await db.query(
    `DELETE FROM payment_gateway_settings WHERE tenant_id = $1 AND branch_id IS NOT DISTINCT FROM $2::uuid`,
    [tenantId, branchId],
  );
  return rowCount > 0;
}

export async function touchWebhook(db, settingsId) {
  await db.query(`UPDATE payment_gateway_settings SET last_webhook_at = now() WHERE id = $1`, [settingsId]);
}

/** Orders still waiting for Razorpay on an account (warned about before disconnecting it). */
export async function countOpenOrders(db, tenantId, keyId) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM payment_orders
      WHERE tenant_id = $1 AND gateway_key_id = $2 AND status = 'created' AND expires_at > now() - interval '1 day'`,
    [tenantId, keyId],
  );
  return rows[0].n;
}
