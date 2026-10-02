import { query } from '../../db/pool.js';

const USER_COLUMNS = `
  u.id, u.tenant_id, u.branch_id, u.role, u.email, u.username,
  u.first_name, u.last_name, u.status, u.password_hash,
  u.failed_login_attempts, u.locked_until, u.password_changed_at`;

export async function findTenantByCode(code) {
  const { rows } = await query(
    `SELECT id, status FROM tenants WHERE code = $1 AND deleted_at IS NULL`,
    [code],
  );
  return rows[0] ?? null;
}

/**
 * Login lookup. `identifier` is an email (contains @) or a username — never a phone
 * number, because phones are not unique (parents share them across siblings).
 * tenantId NULL = platform-level super admin.
 */
export async function findUserForLogin(tenantId, identifier) {
  const column = identifier.includes('@') ? 'email' : 'username';
  const tenantClause = tenantId ? 'u.tenant_id = $2' : 'u.tenant_id IS NULL';
  const params = tenantId ? [identifier, tenantId] : [identifier];

  const { rows } = await query(
    `SELECT ${USER_COLUMNS}, t.status AS tenant_status
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE u.${column} = $1::citext
        AND ${tenantClause}
        AND u.deleted_at IS NULL`,
    params,
  );
  return rows[0] ?? null;
}

/** Per-request check in `authenticate` — PK lookup, so it is cheap. */
export async function findSessionUser(userId) {
  const { rows } = await query(
    `SELECT u.id, u.tenant_id, u.branch_id, u.role, u.status, u.password_changed_at,
            t.status AS tenant_status
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function findPublicUser(userId) {
  const { rows } = await query(
    `SELECT u.id, u.tenant_id, u.branch_id, u.role, u.email, u.username, u.first_name, u.last_name,
            t.name AS school_name, b.name AS branch_name
       FROM users u
       LEFT JOIN tenants t  ON t.id = u.tenant_id
       LEFT JOIN branches b ON b.id = u.branch_id
      WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [userId],
  );
  return rows[0] ?? null;
}

/**
 * Atomic increment; on reaching the limit the account is locked and the counter
 * reset, so the user gets a fresh set of attempts after the lock expires.
 */
export async function recordFailedLogin(userId, maxAttempts, lockoutMinutes) {
  await query(
    `UPDATE users
        SET failed_login_attempts = CASE WHEN failed_login_attempts + 1 >= $2 THEN 0
                                         ELSE failed_login_attempts + 1 END,
            locked_until          = CASE WHEN failed_login_attempts + 1 >= $2
                                         THEN now() + make_interval(mins => $3)
                                         ELSE locked_until END
      WHERE id = $1`,
    [userId, maxAttempts, lockoutMinutes],
  );
}

export async function recordSuccessfulLogin(userId) {
  await query(
    `UPDATE users
        SET failed_login_attempts = 0, locked_until = NULL, last_login_at = now()
      WHERE id = $1`,
    [userId],
  );
}

// ---------------------------------------------------------------- refresh tokens

export async function insertRefreshToken(db, { userId, tenantId, familyId, hash, ttlDays, ip, userAgent }) {
  const { rows } = await db.query(
    `INSERT INTO auth_refresh_tokens
            (user_id, tenant_id, family_id, token_hash, expires_at, created_ip, user_agent)
     VALUES ($1, $2, $3, $4, now() + make_interval(days => $5), $6, left($7, 255))
     RETURNING id`,
    [userId, tenantId, familyId, hash, ttlDays, ip, userAgent],
  );
  return rows[0].id;
}

/** Locks the row so two concurrent refreshes with the same token can't both win. */
export async function findRefreshTokenForUpdate(db, hash) {
  const { rows } = await db.query(
    `SELECT rt.id, rt.user_id, rt.family_id, rt.expires_at, rt.revoked_at,
            u.tenant_id, u.branch_id, u.role, u.status, u.deleted_at,
            t.status AS tenant_status
       FROM auth_refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE rt.token_hash = $1
      FOR UPDATE OF rt`,
    [hash],
  );
  return rows[0] ?? null;
}

export async function markRefreshTokenRotated(db, tokenId, replacedById) {
  await db.query(
    `UPDATE auth_refresh_tokens
        SET revoked_at = now(), revoked_reason = 'rotated', replaced_by_id = $2
      WHERE id = $1`,
    [tokenId, replacedById],
  );
}

export async function revokeRefreshTokenFamily(db, familyId, reason) {
  await db.query(
    `UPDATE auth_refresh_tokens
        SET revoked_at = now(), revoked_reason = $2
      WHERE family_id = $1 AND revoked_at IS NULL`,
    [familyId, reason],
  );
}

export async function revokeAllUserRefreshTokens(userId, reason) {
  await query(
    `UPDATE auth_refresh_tokens
        SET revoked_at = now(), revoked_reason = $2
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId, reason],
  );
}
