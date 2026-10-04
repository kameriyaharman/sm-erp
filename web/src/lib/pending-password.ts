'use client';

/**
 * The temporary password typed on the sign-in screen, kept in memory only (never storage) for the
 * very next screen, "Set your password", so a parent doesn't have to type it twice. Read once.
 */
let pending: string | null = null;

export function rememberTemporaryPassword(password: string) {
  pending = password;
}

export function takeTemporaryPassword(): string | null {
  const value = pending;
  pending = null;
  return value;
}
