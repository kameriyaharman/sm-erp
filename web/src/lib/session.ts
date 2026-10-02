'use client';

/**
 * Browser session.
 *  - Access token (15 min JWT) + user live in sessionStorage for this tab.
 *  - Refresh token is an httpOnly, SameSite=Strict cookie set by the API (JS never sees it).
 *  - getAccessToken() refreshes shortly before expiry, so API clients never see a stale token.
 * All calls go to the same origin (/api/v1/*), which Next.js proxies to the API.
 */
export type Role = 'super_admin' | 'branch_admin' | 'teacher' | 'parent' | 'student';

export interface SessionUser {
  id: string;
  role: Role;
  tenantId: string | null;
  branchId: string | null;
  email: string | null;
  username: string | null;
  firstName: string;
  lastName: string | null;
  schoolName?: string | null;
  branchName?: string | null;
}

export const API_BASE = '/api/v1';
const TOKEN_KEY = 'sm_access_token';
const USER_KEY = 'sm_user';

export class AuthError extends Error {
  constructor(public code: string, message: string, public status = 0) {
    super(message);
  }
}

function read<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function store(token: string, user: SessionUser) {
  try {
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify(token));
    sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* private mode: the in-memory copy below still works for this page */
  }
  memory = { token, user };
}

function clear() {
  memory = null;
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
}

let memory: { token: string; user: SessionUser } | null = null;
let refreshing: Promise<string | null> | null = null;

function expiresAt(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return (payload.exp ?? 0) * 1000;
  } catch {
    return 0;
  }
}

export function currentUser(): SessionUser | null {
  return memory?.user ?? read<SessionUser>(USER_KEY);
}

async function postJson(path: string, body: unknown) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => null);
  return { res, payload };
}

export async function login(input: { tenantCode: string; identifier: string; password: string }): Promise<SessionUser> {
  let result;
  try {
    result = await postJson('/auth/login', { ...input, tenantCode: input.tenantCode.trim().toLowerCase() || undefined, client: 'web' });
  } catch {
    throw new AuthError('NETWORK_ERROR', 'Could not reach the server. Check your connection and try again.');
  }
  const { res, payload } = result;
  if (!res.ok) {
    const retryAfter = res.headers.get('retry-after');
    const message =
      res.status === 429
        ? `Too many attempts. Try again in ${retryAfter ? Math.ceil(Number(retryAfter) / 60) : 15} minutes.`
        : payload?.error?.code === 'INVALID_CREDENTIALS'
          ? 'School code, email or password is incorrect.'
          : payload?.error?.message ?? 'Sign-in failed. Please try again.';
    throw new AuthError(payload?.error?.code ?? 'LOGIN_FAILED', message, res.status);
  }
  store(payload.data.accessToken, payload.data.user);
  return payload.data.user;
}

/** Uses the refresh cookie to get a new access token. Returns null if the session is over. */
export function refresh(): Promise<string | null> {
  refreshing ??= (async () => {
    try {
      const { res, payload } = await postJson('/auth/refresh', { client: 'web' });
      if (!res.ok) {
        clear();
        return null;
      }
      const token = payload.data.accessToken as string;
      // The refresh response carries tokens only; fetch who we are when this tab doesn't know yet.
      let user: SessionUser | null = payload.data.user ?? currentUser();
      if (!user) {
        const me = await fetch(`${API_BASE}/auth/me`, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
        if (!me.ok) {
          clear();
          return null;
        }
        user = (await me.json()).data as SessionUser;
      }
      store(token, user);
      return token;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function getAccessToken(): Promise<string | null> {
  const token = memory?.token ?? read<string>(TOKEN_KEY);
  if (token && expiresAt(token) - Date.now() > 30_000) return token;
  return refresh();
}

export async function logout(): Promise<void> {
  try {
    await postJson('/auth/logout', {});
  } catch {
    /* the cookie is cleared server-side when reachable; local state is cleared regardless */
  }
  clear();
}

export function homeFor(role: Role): string {
  switch (role) {
    case 'super_admin':
    case 'branch_admin':
      return '/dashboard';
    case 'teacher':
      return '/teacher/attendance';
    case 'parent':
      return '/parent';
    default:
      return '/no-access';
  }
}

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Super admin',
  branch_admin: 'Branch admin',
  teacher: 'Teacher',
  parent: 'Parent',
  student: 'Student',
};

/** Error from an API call; `details` carries field errors for forms (VALIDATION_ERROR). */
export class ApiError extends AuthError {
  constructor(code: string, message: string, status: number, public details?: Record<string, string[] | undefined>) {
    super(code, message, status);
  }
}

/** Authenticated POST / PUT / PATCH / DELETE with a JSON body. Returns the parsed JSON (or null for 204). */
export async function apiSend<T = unknown>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new ApiError('UNAUTHENTICATED', 'Your session has ended. Please sign in again.', 401);
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(body !== undefined && { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null as T;
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const details = payload?.error?.details;
    const firstField = details && typeof details === 'object' ? Object.values(details as Record<string, string[]>).flat().find(Boolean) : null;
    const message = payload?.error?.code === 'VALIDATION_ERROR' && firstField ? String(firstField) : payload?.error?.message ?? `Request failed (${res.status})`;
    throw new ApiError(payload?.error?.code ?? 'HTTP_ERROR', message, res.status, details);
  }
  return payload as T;
}

/**
 * Opens an authenticated PDF (report card, receipt, certificate) in a new tab.
 * The tab is opened synchronously so popup blockers allow it, then pointed at the blob.
 */
export async function openPdf(path: string, filename = 'document.pdf'): Promise<void> {
  const win = typeof window !== 'undefined' ? window.open('', '_blank') : null;
  try {
    const token = await getAccessToken();
    if (!token) throw new ApiError('UNAUTHENTICATED', 'Your session has ended. Please sign in again.', 401);
    const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/pdf' } });
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      throw new ApiError(payload?.error?.code ?? 'HTTP_ERROR', payload?.error?.message ?? `Could not open the PDF (${res.status})`, res.status);
    }
    const url = URL.createObjectURL(await res.blob());
    if (win) {
      win.location.href = url;
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    win?.close();
    throw err;
  }
}

/** Authenticated JSON GET against the API. */
export async function apiGet<T>(path: string): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new AuthError('UNAUTHENTICATED', 'Your session has ended. Please sign in again.', 401);
  const res = await fetch(`${API_BASE}${path}`, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new AuthError(payload?.error?.code ?? 'HTTP_ERROR', payload?.error?.message ?? `Request failed (${res.status})`, res.status);
  return payload as T;
}
