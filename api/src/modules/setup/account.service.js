import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { pool, withTransaction } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { logger } from '../../utils/logger.js';
import { normalizePhone } from '../notifications/phone.js';
import { insertRefreshToken, recordFailedLogin } from '../auth/auth.repository.js';
import { accessTokenTtlSeconds, createRefreshToken, signAccessToken } from '../auth/token.service.js';
import { passwordProblem } from './profile.helpers.js';

const BCRYPT_COST = 12;
const invalid = (field, message) => AppError.badRequest('Validation failed', { body: { [field]: [message] } }, 'VALIDATION_ERROR');

async function loadMe(db, userId, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `SELECT u.id, u.tenant_id, u.branch_id, u.role, u.email, u.username, u.phone, u.first_name, u.last_name,
            u.password_hash, u.locked_until, u.last_login_at, u.password_changed_at, u.created_at,
            t.name AS school_name, b.name AS branch_name,
            sf.employee_code, sf.designation, sf.department
       FROM users u
       LEFT JOIN tenants t  ON t.id = u.tenant_id
       LEFT JOIN branches b ON b.id = u.branch_id
       LEFT JOIN staff_profiles sf ON sf.user_id = u.id AND sf.deleted_at IS NULL
      WHERE u.id = $1 AND u.deleted_at IS NULL
      ${forUpdate ? 'FOR UPDATE OF u' : ''}`,
    [userId],
  );
  if (!rows[0]) throw AppError.notFound('User not found', 'USER_NOT_FOUND');
  return rows[0];
}

function meOut(u) {
  return {
    id: u.id,
    role: u.role,
    tenantId: u.tenant_id,
    branchId: u.branch_id,
    firstName: u.first_name,
    lastName: u.last_name,
    email: u.email,
    username: u.username,
    phone: u.phone,
    schoolName: u.school_name,
    branchName: u.branch_name,
    staff: u.employee_code ? { employeeCode: u.employee_code, designation: u.designation, department: u.department } : null,
    lastLoginAt: u.last_login_at,
    passwordChangedAt: u.password_changed_at,
    memberSince: u.created_at,
  };
}

export async function getMe(auth) {
  return meOut(await loadMe(pool, auth.userId));
}

/** Name and mobile. Email (the login) is changed by the school office, not here. */
export async function updateMe(auth, patch) {
  let phone;
  if (patch.phone !== undefined && patch.phone !== null) {
    try {
      phone = normalizePhone(patch.phone);
    } catch (err) {
      throw invalid('phone', err.message);
    }
  } else phone = patch.phone;
  await pool.query(
    `UPDATE users
        SET first_name = COALESCE($2, first_name),
            last_name  = CASE WHEN $3 THEN $4 ELSE last_name END,
            phone      = CASE WHEN $5 THEN $6 ELSE phone END
      WHERE id = $1`,
    [auth.userId, patch.firstName ?? null, patch.lastName !== undefined, patch.lastName ?? null, phone !== undefined, phone ?? null],
  );
  return getMe(auth);
}

/**
 * Change password: checks the current one (a wrong one counts as a failed login, so a stolen
 * access token can't be used to guess it), stores the new hash, ends every session of the user
 * (all refresh tokens; access tokens issued before now stop working in `authenticate`) and opens
 * a fresh session for this device.
 */
export async function changePassword(auth, { currentPassword, newPassword }, meta) {
  const me = await loadMe(pool, auth.userId);
  if (me.locked_until && me.locked_until > new Date()) {
    throw AppError.locked('Too many wrong passwords. Your account is locked for a while; try again later.');
  }
  if (!(await bcrypt.compare(currentPassword, me.password_hash))) {
    await recordFailedLogin(me.id, env.MAX_FAILED_LOGINS, env.LOCKOUT_MINUTES);
    logger.warn('Wrong current password on password change', { userId: me.id, ip: meta.ip });
    throw invalid('currentPassword', 'Your current password is not correct');
  }
  const problem = passwordProblem(newPassword, { current: currentPassword, email: me.email });
  if (problem) throw invalid('newPassword', problem);
  const hash = await bcrypt.hash(newPassword, BCRYPT_COST);

  const session = await withTransaction(async (db) => {
    // `authenticate` voids tokens with iat < password_changed_at. Stamp the change with the new
    // token's own iat (whole seconds), so this device's token is valid even if the API and
    // database clocks differ a little; every older token is void.
    const user = { id: me.id, tenant_id: me.tenant_id, branch_id: me.branch_id, role: me.role };
    const accessToken = signAccessToken(user);
    const { iat } = jwt.decode(accessToken);
    await db.query(
      `UPDATE users SET password_hash = $2, password_changed_at = to_timestamp($3), failed_login_attempts = 0, locked_until = NULL WHERE id = $1`,
      [me.id, hash, iat],
    );
    const { rowCount } = await db.query(
      `UPDATE auth_refresh_tokens SET revoked_at = now(), revoked_reason = 'password_changed' WHERE user_id = $1 AND revoked_at IS NULL`,
      [me.id],
    );
    const refresh = createRefreshToken();
    await insertRefreshToken(db, {
      userId: me.id, tenantId: me.tenant_id, familyId: randomUUID(), hash: refresh.hash,
      ttlDays: env.REFRESH_TOKEN_TTL_DAYS, ip: meta.ip, userAgent: meta.userAgent,
    });
    return {
      endedSessions: rowCount,
      tokens: {
        tokenType: 'Bearer',
        accessToken,
        expiresIn: accessTokenTtlSeconds(accessToken),
        refreshToken: refresh.token,
        refreshExpiresIn: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
      },
    };
  });
  logger.info('Password changed', { userId: me.id, endedSessions: session.endedSessions, ip: meta.ip });
  return session;
}
