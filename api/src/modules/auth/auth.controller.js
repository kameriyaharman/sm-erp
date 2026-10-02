import { env } from '../../config/env.js';
import { AppError } from '../../errors/AppError.js';
import * as authService from './auth.service.js';

const REFRESH_COOKIE = 'sm_rt';

// The refresh cookie is only ever sent to the auth endpoints, never to the rest of the API.
const refreshCookieOptions = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: 'strict',
  path: '/api/v1/auth',
};

function setRefreshCookie(res, token, maxAgeSeconds) {
  res.cookie(REFRESH_COOKIE, token, { ...refreshCookieOptions, maxAge: maxAgeSeconds * 1000 });
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions);
}

/**
 * Web: refresh token goes only into an httpOnly cookie (unreadable by JS / XSS).
 * Mobile: there is no cookie jar, so it is returned in the body for secure storage
 * (Keychain / Keystore).
 */
function sendSession(res, client, { refreshToken, refreshExpiresIn, ...session }, status = 200) {
  setRefreshCookie(res, refreshToken, refreshExpiresIn);
  const body = client === 'mobile' ? { ...session, refreshToken, refreshExpiresIn } : session;
  res.status(status).json({ data: body });
}

function requestMeta(req) {
  return { ip: req.ip, userAgent: req.get('user-agent') ?? null };
}

export async function login(req, res) {
  const { client, ...credentials } = req.valid.body;
  const session = await authService.login({ ...credentials, ...requestMeta(req) });
  sendSession(res, client, session);
}

export async function refresh(req, res) {
  const { client, refreshToken: bodyToken } = req.valid.body;
  const refreshToken = bodyToken ?? req.cookies?.[REFRESH_COOKIE];
  if (!refreshToken) throw AppError.unauthorized('Refresh token missing', 'REFRESH_MISSING');

  try {
    const session = await authService.refresh({ refreshToken, ...requestMeta(req) });
    sendSession(res, client, session);
  } catch (err) {
    clearRefreshCookie(res);
    throw err;
  }
}

export async function logout(req, res) {
  const refreshToken = req.valid.body.refreshToken ?? req.cookies?.[REFRESH_COOKIE];
  await authService.logout({ refreshToken });
  clearRefreshCookie(res);
  res.status(204).end();
}

export async function logoutAll(req, res) {
  await authService.logoutAll(req.auth.userId);
  clearRefreshCookie(res);
  res.status(204).end();
}

export async function me(req, res) {
  const user = await authService.getCurrentUser(req.auth.userId);
  res.json({ data: user });
}
