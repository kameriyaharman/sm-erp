/**
 * Login identifiers (pure functions, unit-tested).
 *
 *   email                     contains "@"                       any role
 *   Indian mobile number      9810055555, 09810055555,           parents
 *                             +91 98100 55555, 91-98100-55555
 *   username / admission no.  anything else, case-insensitive    students (admission no.), anyone with a username
 */

const PHONE = /^(?:\+?91|0)?([6-9]\d{9})$/;

/** @returns {{ kind: 'email'|'phone'|'username', value: string, raw: string }} */
export function normaliseLoginId(input) {
  const raw = String(input ?? '').trim();
  if (raw.includes('@')) return { kind: 'email', value: raw.toLowerCase(), raw };
  const compact = raw.replace(/[\s\-().]/g, '');
  const m = PHONE.exec(compact);
  if (m) return { kind: 'phone', value: m[1], raw };
  return { kind: 'username', value: raw.toLowerCase(), raw };
}

/** "+91 98100-55555" -> "9810055555"; null when it is not an Indian mobile number. */
export function phone10(input) {
  const m = PHONE.exec(String(input ?? '').replace(/[\s\-().]/g, ''));
  return m ? m[1] : null;
}

/** Stable key for per-account rate limits: every spelling of one phone number counts as one account. */
export function loginRateKey(tenantCode, identifier) {
  return `${String(tenantCode ?? '').trim().toLowerCase()}|${normaliseLoginId(identifier).value}`;
}

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX_BYTES = 72; // bcrypt reads at most 72 bytes

/**
 * New-password rules (portal users type these on a phone, so: length + a letter + a digit,
 * not the login id itself). Returns a list of problems; empty = acceptable.
 */
export function passwordProblems(password, { loginIds = [] } = {}) {
  const pw = String(password ?? '');
  const problems = [];
  if (pw.length < PASSWORD_MIN) problems.push(`Use at least ${PASSWORD_MIN} characters`);
  if (Buffer.byteLength(pw, 'utf8') > PASSWORD_MAX_BYTES) problems.push('Use at most 72 characters');
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) problems.push('Use letters and at least one number');
  if (/^\s|\s$/.test(pw)) problems.push('Do not start or end with a space');
  const lower = pw.toLowerCase();
  const contains = (id) => {
    const v = String(id).toLowerCase();
    return lower === v || (v.length >= 6 && lower.includes(v));
  };
  if (loginIds.filter(Boolean).some(contains)) {
    problems.push('Do not use your login id, phone number or admission number in the password');
  }
  return problems;
}

// Unambiguous characters for printed slips (no 0/O, 1/l/I).
const LOWER = 'abcdefghjkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGIT = '23456789';
const ALL = LOWER + UPPER + DIGIT;

/**
 * Temporary password like "Kq7m-x3Tp-9wZd": 12 random characters (~70 bits) from an
 * unambiguous alphabet, in groups of 4 so it can be read off a slip and typed on a phone.
 * Always has a lower, an upper and a digit. `randomInt(n)` is injectable for tests.
 */
export function temporaryPassword(randomInt) {
  for (;;) {
    const chars = Array.from({ length: 12 }, () => ALL[randomInt(ALL.length)]);
    const s = chars.join('');
    if (/[a-z]/.test(s) && /[A-Z]/.test(s) && /\d/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
  }
}
