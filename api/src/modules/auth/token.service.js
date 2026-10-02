import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { AppError } from '../../errors/AppError.js';

// Pin the algorithm on both sign and verify: rejects `alg: none` and RS/HS confusion.
const ALGORITHM = 'HS256';

export function signAccessToken(user) {
  return jwt.sign(
    {
      role: user.role,
      tid: user.tenant_id ?? null,
      bid: user.branch_id ?? null,
    },
    env.JWT_ACCESS_SECRET,
    {
      algorithm: ALGORITHM,
      expiresIn: env.JWT_ACCESS_TTL,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      subject: user.id,
      jwtid: randomUUID(),
    },
  );
}

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: [ALGORITHM],
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw AppError.unauthorized('Access token has expired', 'TOKEN_EXPIRED');
    }
    throw AppError.unauthorized('Invalid access token', 'TOKEN_INVALID');
  }
}

/** Seconds until an access token expires — returned to clients so they can refresh early. */
export function accessTokenTtlSeconds(token) {
  const { exp, iat } = jwt.decode(token);
  return exp - iat;
}

/**
 * Refresh tokens are opaque random strings, not JWTs. Only their SHA-256 hash is
 * stored, so a database leak does not leak usable sessions.
 */
export function createRefreshToken() {
  const token = randomBytes(48).toString('base64url');
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token) {
  return createHash('sha256').update(token).digest();
}
