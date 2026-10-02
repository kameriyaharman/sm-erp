import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from '../../config/env.js';
import { AppError } from '../../errors/AppError.js';
import { withTransaction } from '../../db/pool.js';
import { logger } from '../../utils/logger.js';
import * as repo from './auth.repository.js';
import {
  accessTokenTtlSeconds,
  createRefreshToken,
  hashRefreshToken,
  signAccessToken,
} from './token.service.js';

// Compared against when the user doesn't exist, so "unknown user" and "wrong password"
// take the same time and an attacker can't enumerate accounts by response latency.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(randomUUID(), 12);

const invalidCredentials = () =>
  AppError.unauthorized('Invalid credentials', 'INVALID_CREDENTIALS');

function toPublicUser(user) {
  return {
    id: user.id,
    role: user.role,
    tenantId: user.tenant_id,
    branchId: user.branch_id,
    email: user.email,
    username: user.username,
    firstName: user.first_name,
    lastName: user.last_name,
    ...(user.school_name !== undefined && { schoolName: user.school_name, branchName: user.branch_name }),
  };
}

async function issueSession(db, user, { familyId = randomUUID(), ip, userAgent }) {
  const accessToken = signAccessToken(user);
  const refresh = createRefreshToken();
  const refreshTokenId = await repo.insertRefreshToken(db, {
    userId: user.id,
    tenantId: user.tenant_id,
    familyId,
    hash: refresh.hash,
    ttlDays: env.REFRESH_TOKEN_TTL_DAYS,
    ip,
    userAgent,
  });

  return {
    tokens: {
      tokenType: 'Bearer',
      accessToken,
      expiresIn: accessTokenTtlSeconds(accessToken),
      refreshToken: refresh.token,
      refreshExpiresIn: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
    },
    refreshTokenId,
  };
}

export async function login({ tenantCode, identifier, password, ip, userAgent }) {
  let tenantId = null;
  if (tenantCode) {
    const tenant = await repo.findTenantByCode(tenantCode);
    if (!tenant) {
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      throw invalidCredentials();
    }
    tenantId = tenant.id;
  }

  const user = await repo.findUserForLogin(tenantId, identifier);
  if (!user) {
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
    throw invalidCredentials();
  }

  // Locked accounts are rejected before the password is checked, so a lock
  // actually stops guessing instead of just hiding the result.
  if (user.locked_until && user.locked_until > new Date()) {
    throw AppError.locked('Too many failed attempts. Account is temporarily locked; try again later.');
  }

  const passwordOk = await bcrypt.compare(password, user.password_hash);
  if (!passwordOk) {
    await repo.recordFailedLogin(user.id, env.MAX_FAILED_LOGINS, env.LOCKOUT_MINUTES);
    logger.warn('Failed login', { userId: user.id, ip });
    throw invalidCredentials();
  }

  // Status checks come after the password check: only the real owner learns the account state.
  if (user.status !== 'active') {
    throw AppError.forbidden('This account is not active. Contact your school administrator.', 'ACCOUNT_INACTIVE');
  }
  if (user.tenant_id && user.tenant_status !== 'active') {
    throw AppError.forbidden('Your school account is not active', 'TENANT_INACTIVE');
  }

  await repo.recordSuccessfulLogin(user.id);
  const { tokens } = await withTransaction((db) => issueSession(db, user, { ip, userAgent }));

  logger.info('Login', { userId: user.id, role: user.role, ip });
  return { user: toPublicUser(user), ...tokens };
}

/**
 * Refresh-token rotation with reuse detection: every refresh consumes the token and
 * issues a new one in the same "family". Presenting an already-consumed token means it
 * was copied (stolen), so the whole family — i.e. that device session — is revoked.
 */
export async function refresh({ refreshToken, ip, userAgent }) {
  const hash = hashRefreshToken(refreshToken);

  const outcome = await withTransaction(async (db) => {
    const stored = await repo.findRefreshTokenForUpdate(db, hash);
    if (!stored) return { error: AppError.unauthorized('Invalid refresh token', 'REFRESH_INVALID') };

    if (stored.revoked_at) {
      await repo.revokeRefreshTokenFamily(db, stored.family_id, 'reuse_detected');
      logger.warn('Refresh token reuse detected; session revoked', {
        userId: stored.user_id,
        familyId: stored.family_id,
        ip,
      });
      return { error: AppError.unauthorized('Session is no longer valid, please sign in again', 'REFRESH_REUSED') };
    }
    if (stored.expires_at <= new Date()) {
      return { error: AppError.unauthorized('Refresh token has expired', 'REFRESH_EXPIRED') };
    }
    if (stored.deleted_at || stored.status !== 'active' || (stored.tenant_id && stored.tenant_status !== 'active')) {
      await repo.revokeRefreshTokenFamily(db, stored.family_id, 'account_inactive');
      return { error: AppError.unauthorized('Account is no longer active', 'ACCOUNT_INACTIVE') };
    }

    const user = {
      id: stored.user_id,
      tenant_id: stored.tenant_id,
      branch_id: stored.branch_id,
      role: stored.role,
    };
    const session = await issueSession(db, user, { familyId: stored.family_id, ip, userAgent });
    await repo.markRefreshTokenRotated(db, stored.id, session.refreshTokenId);
    return { tokens: session.tokens };
  });

  // Errors are returned (not thrown) from the transaction so revocations still commit.
  if (outcome.error) throw outcome.error;
  return outcome.tokens;
}

/** Ends one device session. Idempotent: unknown or already-revoked tokens are ignored. */
export async function logout({ refreshToken }) {
  if (!refreshToken) return;
  const hash = hashRefreshToken(refreshToken);
  await withTransaction(async (db) => {
    const stored = await repo.findRefreshTokenForUpdate(db, hash);
    if (stored) await repo.revokeRefreshTokenFamily(db, stored.family_id, 'logout');
  });
}

/** Ends every session of the user (e.g. "sign out of all devices"). */
export async function logoutAll(userId) {
  await repo.revokeAllUserRefreshTokens(userId, 'logout_all');
}

export async function getCurrentUser(userId) {
  const user = await repo.findPublicUser(userId);
  if (!user) throw AppError.notFound('User not found', 'USER_NOT_FOUND');
  return toPublicUser(user);
}
