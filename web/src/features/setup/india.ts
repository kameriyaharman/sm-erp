/**
 * Indian formats used by the admission form and the school profile, mirrored from
 * api/src/modules/setup/profile.helpers.js (the server checks the same rules).
 */

export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
  'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
] as const;
export const UNION_TERRITORIES = [
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi',
  'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
] as const;

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export const RELIGIONS = ['Hindu', 'Muslim', 'Christian', 'Sikh', 'Buddhist', 'Jain', 'Parsi', 'Jewish', 'Other', 'Prefer not to say'] as const;
export const GUARDIAN_RELATIONS = ['Father', 'Mother', 'Grandfather', 'Grandmother', 'Uncle', 'Aunt', 'Brother', 'Sister', 'Other'] as const;
export const MOTHER_TONGUES = ['Hindi', 'English', 'Punjabi', 'Urdu', 'Bengali', 'Marathi', 'Gujarati', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Odia', 'Assamese', 'Nepali', 'Sindhi', 'Konkani', 'Maithili', 'Bhojpuri'];
export const BOARDS = ['CBSE', 'ICSE / ISC', 'State board', 'IB', 'Cambridge (CAIE)', 'NIOS', 'Playschool', 'Other'];

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

export function verhoeffValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let c = 0;
  [...digits].reverse().forEach((ch, i) => {
    c = D[c][P[i % 8][Number(ch)]];
  });
  return c === 0;
}

export const digitsOnly = (v: string) => v.replace(/\D/g, '');

/** "234567890123" -> "2345 6789 0123" while typing. */
export function formatAadhaar(v: string): string {
  return digitsOnly(v).slice(0, 12).replace(/(\d{4})(?=\d)/g, '$1 ');
}

/** Error sentence or null. Blank is fine (optional). */
export function aadhaarError(v: string): string | null {
  const d = digitsOnly(v);
  if (!d) return null;
  if (d.length !== 12) return 'Aadhaar number is 12 digits';
  if (/^[01]/.test(d)) return 'Aadhaar numbers do not start with 0 or 1';
  if (!verhoeffValid(d)) return 'This is not a valid Aadhaar number. Check the digits.';
  return null;
}

/** 10-digit Indian mobile (with or without +91 / 0). Returns null when valid or blank. */
export function mobileError(v: string, required = false): string | null {
  const raw = v.trim();
  if (!raw) return required ? 'Enter a 10-digit mobile number' : null;
  let d = digitsOnly(raw);
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (!/^[6-9]\d{9}$/.test(d)) return 'Enter a 10-digit mobile number starting with 6, 7, 8 or 9';
  return null;
}

export function pincodeError(v: string, required = false): string | null {
  if (!v.trim()) return required ? 'Enter the 6-digit PIN code' : null;
  return /^[1-9]\d{5}$/.test(v.trim()) ? null : 'PIN code is 6 digits';
}

export function emailError(v: string): string | null {
  if (!v.trim()) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? null : 'Enter a valid email or leave it blank';
}

/** "+919810055555" -> "98100 55555" for display. */
export function displayPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const m = /^\+91(\d{5})(\d{5})$/.exec(phone);
  return m ? `${m[1]} ${m[2]}` : phone;
}
