import { NotificationError } from './errors.js';

/**
 * Normalises an Indian mobile number to E.164 (+91XXXXXXXXXX).
 * Accepts "98110 42231", "098110-42231", "+91 98110 42231", "919811042231".
 * Indian mobiles are 10 digits starting 6–9. Other countries are accepted only
 * when already in +E.164 form.
 */
export function normalizePhone(input) {
  if (typeof input !== 'string' && typeof input !== 'number') {
    throw new NotificationError('INVALID_PHONE', 'Phone number is missing');
  }
  const raw = String(input).trim();
  const digits = raw.replace(/[^\d]/g, '');

  if (raw.startsWith('+') && !raw.startsWith('+91')) {
    if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
    throw new NotificationError('INVALID_PHONE', 'Phone number is not a valid international number');
  }

  let national = digits;
  if (national.length === 12 && national.startsWith('91')) national = national.slice(2);
  else if (national.length === 11 && national.startsWith('0')) national = national.slice(1);

  if (!/^[6-9]\d{9}$/.test(national)) {
    throw new NotificationError('INVALID_PHONE', 'Phone number is not a valid Indian mobile number');
  }
  return `+91${national}`;
}

/** "+919811042231" -> "+91•••••••231" (safe for logs) */
export function maskPhone(phone) {
  const compact = String(phone ?? '').replace(/[\s-]/g, '');
  const match = /^(\+91|\+\d{1,3})?(\d*)(\d{3})$/.exec(compact);
  if (!match) return '•••';
  return `${match[1] ?? ''}${'•'.repeat(match[2].length)}${match[3]}`;
}
