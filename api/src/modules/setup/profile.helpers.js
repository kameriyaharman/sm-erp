/**
 * Pure helpers for the setup module and the student profile (no I/O). Unit-tested in
 * test/setup.test.js.
 */

// ===================================================================== Indian formats

/** States and union territories (2026), as printed on Indian addresses. */
export const INDIAN_STATES = Object.freeze([
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
  'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi',
  'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
]);

export const BLOOD_GROUPS = Object.freeze(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);

export const PINCODE_RE = /^[1-9]\d{5}$/;

// Verhoeff tables (dihedral group D5), used by UIDAI for the Aadhaar check digit.
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

/** True when the digit string (check digit last) passes the Verhoeff check. */
export function verhoeffValid(digits) {
  const s = String(digits ?? '');
  if (!/^\d+$/.test(s)) return false;
  let c = 0;
  [...s].reverse().forEach((ch, i) => {
    c = D[c][P[i % 8][Number(ch)]];
  });
  return c === 0;
}

/** Verhoeff check digit for a digit string (used to make valid demo numbers). */
export function verhoeffDigit(digits) {
  let c = 0;
  [...String(digits)].reverse().forEach((ch, i) => {
    c = D[c][P[(i + 1) % 8][Number(ch)]];
  });
  return INV[c];
}

/** "2345 6789 0123" -> "234567890123" (digits only), or null when blank. */
export function cleanAadhaar(input) {
  if (input === null || input === undefined) return null;
  const digits = String(input).replace(/[\s-]/g, '');
  return digits === '' ? null : digits;
}

/** 12 digits, not starting with 0 or 1, Verhoeff check digit. Returns an error sentence or null. */
export function aadhaarError(digits) {
  if (!/^\d{12}$/.test(digits ?? '')) return 'Aadhaar number is 12 digits';
  if (/^[01]/.test(digits)) return 'Aadhaar numbers do not start with 0 or 1';
  if (!verhoeffValid(digits)) return 'This is not a valid Aadhaar number (check digit does not match)';
  return null;
}

/** "234567890123" -> "XXXX-XXXX-0123" */
export function maskAadhaar(digits) {
  if (!digits) return null;
  return `XXXX-XXXX-${String(digits).slice(-4)}`;
}

// ===================================================================== address

const ADDRESS_KEYS = ['line1', 'line2', 'city', 'state', 'pincode'];

/** Stored jsonb -> API shape { line1, line2, city, state, pincode } (null when empty). */
export function addressOut(stored) {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return null;
  const out = {};
  let any = false;
  for (const k of ADDRESS_KEYS) {
    const v = typeof stored[k] === 'string' && stored[k].trim() ? stored[k].trim() : null;
    out[k] = v;
    any ||= v !== null;
  }
  return any ? out : null;
}

/** Validated API address -> jsonb to store ({} clears). Drops empty optional parts. */
export function addressIn(input) {
  if (!input) return {};
  const out = {};
  for (const k of ADDRESS_KEYS) {
    const v = typeof input[k] === 'string' ? input[k].trim() : '';
    if (v) out[k] = v;
  }
  return out;
}

/** One line for lists / letters: "12 MG Road, Sector 4, Gurugram, Haryana 122001". */
export function formatAddress(address) {
  const a = addressOut(address);
  if (!a) return null;
  const tail = [a.state, a.pincode].filter(Boolean).join(' ');
  return [a.line1, a.line2, a.city, tail].filter(Boolean).join(', ');
}

// ===================================================================== images

export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
export const MAX_LOGO_BYTES = 1024 * 1024;

const IMAGE_KINDS = {
  jpeg: { mime: 'image/jpeg', declared: ['image/jpeg', 'image/jpg', 'image/pjpeg'], magic: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  png: { mime: 'image/png', declared: ['image/png', 'image/x-png'], magic: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  webp: { mime: 'image/webp', declared: ['image/webp'], magic: (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
};

/** The image kind the bytes are, or null. */
export function sniffImage(buf) {
  if (!Buffer.isBuffer(buf)) return null;
  return Object.keys(IMAGE_KINDS).find((k) => IMAGE_KINDS[k].magic(buf)) ?? null;
}

/**
 * Checks an uploaded picture. The content decides the type (magic bytes); the declared MIME type
 * must agree with it. Returns { ok: true, mime } or { ok: false, status, code, message }.
 *   kinds: subset of ['jpeg', 'png', 'webp']
 */
export function checkImage(file, { kinds = ['jpeg', 'png', 'webp'], maxBytes = MAX_PHOTO_BYTES, label = 'Photo' } = {}) {
  const list = kinds.map((k) => (k === 'jpeg' ? 'JPG' : k.toUpperCase()));
  const names = list.length > 1 ? `${list.slice(0, -1).join(', ')} or ${list.at(-1)}` : list[0];
  const size = file?.size ?? file?.buffer?.length ?? 0;
  if (!file?.buffer || size === 0) return { ok: false, status: 400, code: 'FILE_EMPTY', message: 'The file is empty' };
  if (size > maxBytes) return { ok: false, status: 413, code: 'FILE_TOO_LARGE', message: `${label} can be at most ${maxBytes / (1024 * 1024)} MB` };
  const kind = sniffImage(file.buffer);
  if (!kind || !kinds.includes(kind)) {
    return { ok: false, status: 415, code: 'FILE_TYPE_NOT_ALLOWED', message: `${label} must be a ${names} image` };
  }
  const declared = String(file.mimetype ?? '').split(';')[0].trim().toLowerCase();
  // application/octet-stream: some Android pickers; the bytes already proved the type.
  if (declared && declared !== 'application/octet-stream' && !IMAGE_KINDS[kind].declared.includes(declared)) {
    return { ok: false, status: 415, code: 'FILE_TYPE_NOT_ALLOWED', message: `The file type (${declared}) does not match its content` };
  }
  return { ok: true, mime: IMAGE_KINDS[kind].mime };
}

// ===================================================================== academic years

/**
 * The year after `latest` ({ name, startDate, endDate } with YYYY-MM-DD dates): same
 * day/month one year later; name "2026-27" -> "2027-28" (else "<startYear>-<yy>").
 * With no year at all: April to March starting in `today`'s session.
 */
export function nextAcademicYear(latest, today = new Date().toISOString().slice(0, 10)) {
  const shift = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    // 29 Feb -> 28 Feb in a non-leap year
    const last = new Date(Date.UTC(y + 1, m, 0)).getUTCDate();
    return `${y + 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
  };
  let startDate;
  let endDate;
  if (latest?.startDate && latest?.endDate) {
    startDate = shift(latest.startDate);
    endDate = shift(latest.endDate);
  } else {
    const [y, m] = today.split('-').map(Number);
    const startYear = m >= 4 ? y : y - 1;
    startDate = `${startYear}-04-01`;
    endDate = `${startYear + 1}-03-31`;
  }
  return { name: yearName(startDate, endDate), startDate, endDate };
}

/** "2027-04-01", "2028-03-31" -> "2027-28"; a year inside one calendar year -> "2027". */
export function yearName(startDate, endDate) {
  const a = Number(startDate.slice(0, 4));
  const b = Number(endDate.slice(0, 4));
  return a === b ? String(a) : `${a}-${String(b).slice(-2)}`;
}

// ===================================================================== safe deletes

const USAGE_LABELS = {
  students: ['student', 'students'],
  formerStudents: ['former student', 'former students'],
  admissions: ['admission record', 'admission records'],
  sections: ['section', 'sections'],
  terms: ['term', 'terms'],
  feeStructures: ['fee structure line', 'fee structure lines'],
  feeAllocations: ['fee allocation', 'fee allocations'],
  invoices: ['fee invoice', 'fee invoices'],
  receipts: ['fee receipt', 'fee receipts'],
  exams: ['exam', 'exams'],
  examPapers: ['exam paper', 'exam papers'],
  marks: ['marks entry', 'marks entries'],
  reportCards: ['report card', 'report cards'],
  attendance: ['attendance record', 'attendance records'],
  homework: ['homework', 'homework'],
  timetable: ['timetable period', 'timetable periods'],
  assignments: ['teacher assignment', 'teacher assignments'],
  notices: ['notice', 'notices'],
};

/** { students: 27, exams: 0, ... } -> only the non-zero counts, as numbers. */
export function usedBy(counts) {
  return Object.fromEntries(Object.entries(counts ?? {}).map(([k, v]) => [k, Number(v) || 0]).filter(([, v]) => v > 0));
}

/** "27 students, 4 fee structure lines and 1 exam" ('' when nothing). */
export function describeUsage(counts) {
  const parts = Object.entries(usedBy(counts)).map(([k, n]) => {
    const [one, many] = USAGE_LABELS[k] ?? [k, k];
    return `${n} ${n === 1 ? one : many}`;
  });
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

// ===================================================================== account

/** Password rule for "my account": at least 10 characters, letters and digits, not the old one. */
export function passwordProblem(next, { current, email } = {}) {
  if (typeof next !== 'string' || next.length < 10) return 'Use at least 10 characters';
  if (next.length > 72) return 'Use at most 72 characters';
  if (!/[A-Za-z]/.test(next) || !/\d/.test(next)) return 'Use both letters and numbers';
  if (current && next === current) return 'The new password must be different from the current one';
  if (email && next.toLowerCase().includes(String(email).split('@')[0].toLowerCase()) && String(email).split('@')[0].length >= 4) {
    return 'Do not use your email name in the password';
  }
  return null;
}
