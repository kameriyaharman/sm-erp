import { AppError } from '../errors/AppError.js';
import { verifyAccessToken } from '../modules/auth/token.service.js';
import { findSessionUser } from '../modules/auth/auth.repository.js';

function extractBearerToken(req) {
  const header = req.get('authorization');
  if (!header) return null;

  const [scheme, token, ...rest] = header.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== 'bearer' || !token || rest.length > 0) return null;
  return token;
}

/**
 * Verifies the access token, then confirms against the database that the account
 * is still allowed in. The DB — not the token — is the source of truth for role,
 * tenant and branch, so a role change or deactivation takes effect immediately
 * rather than when the token expires.
 *
 * On success sets `req.auth = { userId, role, tenantId, branchId, tokenId }`.
 */
export async function authenticate(req, _res, next) {
  const token = extractBearerToken(req);
  if (!token) throw AppError.unauthorized('Missing or malformed Authorization header');

  const claims = verifyAccessToken(token);
  const user = await findSessionUser(claims.sub);

  if (!user || user.status !== 'active') {
    throw AppError.unauthorized('Account is no longer active', 'ACCOUNT_INACTIVE');
  }
  if (user.tenant_id && user.tenant_status !== 'active') {
    throw AppError.forbidden('Your school account is not active', 'TENANT_INACTIVE');
  }
  // Tokens issued before the last password change are void.
  if (user.password_changed_at && claims.iat < Math.floor(user.password_changed_at.getTime() / 1000)) {
    throw AppError.unauthorized('Session expired, please sign in again', 'TOKEN_REVOKED');
  }

  req.auth = Object.freeze({
    userId: user.id,
    role: user.role,
    tenantId: user.tenant_id,
    branchId: user.branch_id,
    tokenId: claims.jti,
  });
  next();
}
