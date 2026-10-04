import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Authenticated encryption for settings secrets (a school's Razorpay key secret and webhook
 * secret): AES-256-GCM, random 96-bit IV per value, 128-bit tag.
 *
 *   v1:<iv>:<tag>:<ciphertext>          (base64url parts)
 *
 * `context` is bound as additional authenticated data (e.g. "<tenantId>:key_secret"), so a
 * ciphertext copied into another school's row or another column fails to decrypt instead of
 * silently handing over someone else's secret.
 *
 * Pure module (the key is passed in) so it can be unit-tested without the app's env.
 */

const VERSION = 'v1';

export class SecretBoxError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SecretBoxError';
  }
}

/** base64 (or base64url) string of exactly 32 bytes -> Buffer. Throws on anything else. */
export function parseKey(base64) {
  if (typeof base64 !== 'string' || base64.length === 0) throw new SecretBoxError('Encryption key is not set');
  const key = Buffer.from(base64, 'base64');
  if (key.length !== 32) throw new SecretBoxError('Encryption key must be 32 bytes (base64)');
  return key;
}

export function encryptSecret(plaintext, { key, context }) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) throw new SecretBoxError('Nothing to encrypt');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(String(context), 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(':');
}

export function decryptSecret(sealed, { key, context }) {
  const parts = typeof sealed === 'string' ? sealed.split(':') : [];
  if (parts.length !== 4 || parts[0] !== VERSION) throw new SecretBoxError('Unknown secret format');
  const [, iv, tag, data] = parts.map((p, i) => (i === 0 ? p : Buffer.from(p, 'base64url')));
  if (iv.length !== 12 || tag.length !== 16) throw new SecretBoxError('Corrupt secret');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(String(context), 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    // Wrong key (SETTINGS_ENCRYPTION_KEY changed), tampered value, or a value from another row.
    throw new SecretBoxError('Secret could not be decrypted');
  }
}

/** Last 4 characters, for "••••abcd" hints. Never more. */
export const last4 = (secret) => String(secret).slice(-4);
