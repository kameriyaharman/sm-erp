import { query } from '../../db/pool.js';

const USER_COLUMNS = `
  u.id, u.tenant_id, u.branch_id, u.role, u.email, u.username,
  u.first_name, u.last_name, u.status, u.password_hash,
  u.failed_login_attempts, u.locked_until, u.password_changed_at, u.must_change_password, u.password_set_at, u.phone`;

export async function findTenantByCode(code) {
  const { rows } = await query(
    `SELECT id, status FROM tenants WHERE code = $1 AND deleted_at IS NULL`,
    [code],
  );
  return rows[0] ?? null;
}

/**
 * Login lookup (see login-id.js for the identifier forms). tenantId NULL = platform-level super admin.
 *   email                      users.email (case-insensitive)
 *   phone (Indian mobile)      parents whose users.phone has those 10 digits (+91 / 0 prefixes ignored)
 *   username / admission no.   users.username, or a student's admission number (case-insensitive)
 * Phone numbers are not unique (a parent can have two accounts, siblings at two branches), so up
 * to 5 candidates come back and the caller lets the password pick the account.
 */
export async function findLoginCandidates(tenantId, login) {
  const tenantClause = tenantId ? 'u.tenant_id = $1' : 'u.tenant_id IS NULL';
  const { rows } = await query(
    `SELECT ${USER_COLUMNS}, t.status AS tenant_status
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE ${tenantClause}
        AND u.deleted_at IS NULL
        AND (
              ($2 = 'email' AND u.email = $3::citext)
           OR ($2 = 'phone' AND u.role = 'parent' AND regexp_replace(u.phone, '\\D', '', 'g') IN ($4, '91' || $4, '0' || $4))
           OR ($2 <> 'email' AND u.username = $5::citext)
           OR ($2 <> 'email' AND $1::uuid IS NOT NULL AND u.role = 'student' AND u.id IN (
                 SELECT sp.user_id FROM student_profiles sp
                  WHERE sp.tenant_id = $1 AND sp.deleted_at IS NULL AND lower(sp.admission_number) = lower($5)))
        )
      ORDER BY (u.password_set_at IS NOT NULL) DESC, u.last_login_at DESC NULLS LAST, u.created_at
      LIMIT 5`,
    [tenantId, login.kind, login.value, login.kind === 'phone' ? login.value : null, login.raw],
  );
  return rows;
}

export async function findUserForPasswordChange(userId) {
  const { rows } = await query(
    `SELECT ${USER_COLUMNS}, t.status AS tenant_status,
            (SELECT sp.admission_number FROM student_profiles sp WHERE sp.user_id = u.id AND sp.deleted_at IS NULL LIMIT 1) AS admission_number
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [userId],
  );
  return rows[0] ?? null;
}

/**
 * New password chosen by the user. Clears the "must change" flag. password_changed_at is stamped
 * with the new session's own token iat (whole seconds), so that token stays valid even if the API
 * and database clocks differ a little, while every older token is void (see authenticate).
 */
export async function setOwnPassword(db, userId, passwordHash, tokenIat) {
  await db.query(
    `UPDATE users
        SET password_hash = $2, must_change_password = false, password_set_at = now(),
            password_changed_at = to_timestamp($3), failed_login_attempts = 0, locked_until = NULL
      WHERE id = $1`,
    [userId, passwordHash, tokenIat],
  );
}

/** Per-request check in `authenticate` — PK lookup, so it is cheap. */
export async function findSessionUser(userId) {
  const { rows } = await query(
    `SELECT u.id, u.tenant_id, u.branch_id, u.role, u.status, u.password_changed_at, u.must_change_password,
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
    `SELECT u.id, u.tenant_id, u.branch_id, u.role, u.email, u.username, u.first_name, u.last_name, u.must_change_password,
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
        SET failed_login_attempts = 0, locked_until = NULL, last_login_at = now(),
            password_set_at = COALESCE(password_set_at, now())   -- signed in with it, so it is a usable password
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
