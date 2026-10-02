/**
 * Words for certificates: dates of birth in words (as the TC/admission register
 * requires) and class levels in words/roman numerals.
 */
const ONES = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const ORDINAL_ONES = ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth',
  'Eleventh', 'Twelfth', 'Thirteenth', 'Fourteenth', 'Fifteenth', 'Sixteenth', 'Seventeenth', 'Eighteenth', 'Nineteenth'];
const ORDINAL_TENS = { 20: 'Twentieth', 30: 'Thirtieth' };
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function underHundred(n) {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
}

/** 0..9999 in words: 2014 -> "Two Thousand Fourteen", 1999 -> "One Thousand Nine Hundred Ninety-Nine". */
export function numberInWords(n) {
  if (!Number.isInteger(n) || n < 0 || n > 9999) throw new RangeError('numberInWords supports 0..9999');
  if (n < 100) return underHundred(n);
  const parts = [];
  if (n >= 1000) parts.push(`${ONES[Math.floor(n / 1000)]} Thousand`);
  const hundreds = Math.floor((n % 1000) / 100);
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (n % 100) parts.push(underHundred(n % 100));
  return parts.join(' ');
}

export function ordinalInWords(n) {
  if (n < 20) return ORDINAL_ONES[n];
  if (n % 10 === 0) return ORDINAL_TENS[n];
  return `${TENS[Math.floor(n / 10)]}-${ORDINAL_ONES[n % 10]}`;
}

const parseIso = (iso) => String(iso).slice(0, 10).split('-').map(Number);

/** "2014-03-12" -> "Twelfth March Two Thousand Fourteen" */
export function dateInWords(iso) {
  if (!iso) return '';
  const [y, m, d] = parseIso(iso);
  return `${ordinalInWords(d)} ${MONTHS[m - 1]} ${numberInWords(y)}`;
}

/** "2014-03-12" -> "12-03-2014" (the form used on Indian school records) */
export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = parseIso(iso);
  return `${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}-${y}`;
}

/** "2014-03-12" -> "12 March 2014" */
export function formatDateLong(iso) {
  if (!iso) return '';
  const [y, m, d] = parseIso(iso);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const ROMAN = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
/** 7 -> "VII" (class levels 1..12; others returned as-is) */
export function roman(n) {
  if (!Number.isInteger(n) || n < 1 || n > 39) return String(n ?? '');
  let out = '';
  let rest = n;
  for (const [v, s] of ROMAN) while (rest >= v) { out += s; rest -= v; }
  return out;
}

/** Class label for certificates: level 7, name "Grade 7" -> "VII (Seven)" */
export function classInWords(numericLevel, fallbackName) {
  if (Number.isInteger(numericLevel) && numericLevel >= 1 && numericLevel <= 12) {
    return `${roman(numericLevel)} (${numberInWords(numericLevel)})`;
  }
  return fallbackName ?? '';
}
