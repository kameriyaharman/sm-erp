/** Display helpers for the parent app (Indian formats, calendar dates without timezone shifts). */

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const FULL_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "4500.00" -> "₹4,500"; paise shown only when present. */
export function inr(value: string | number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '₹0';
  return Math.round(n * 100) % 100 === 0 ? inr0.format(n) : inr2.format(n);
}

export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const isoMonth = (d: Date) => isoDay(d).slice(0, 7);

export function parseDay(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** "2026-10-05" -> "5 Oct" (adds the year when it is not this year). */
export function shortDate(iso: string, now = new Date()): string {
  const d = parseDay(iso);
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** "2026-10-05" -> "Mon, 5 Oct 2026" */
export function longDate(iso: string): string {
  const d = parseDay(iso);
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** ISO timestamp -> "3 Jul 2026" in Indian time. */
export function tsDate(isoTs: string): string {
  return new Date(isoTs).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

/** "07:05" -> "7:05 am" */
export function time12(hhmm: string | null | undefined): string {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`;
}

export const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export function daysUntil(iso: string, today = new Date()): number {
  return Math.round((parseDay(iso).getTime() - parseDay(isoDay(today)).getTime()) / 86_400_000);
}

/** "2026-09" -> "September 2026" */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  return isoMonth(new Date(y, m - 1 + delta, 1));
}

export function relativeAgo(isoTs: string, now = new Date()): string {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(isoTs).getTime()) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return tsDate(isoTs);
}

export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/** "+919811100034" -> "+91 98111 00034"; leaves other formats readable. */
export function displayPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const ten = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits.length === 10 ? digits : null;
  return ten ? `+91 ${ten.slice(0, 5)} ${ten.slice(5)}` : phone;
}

export const PAYMENT_MODE: Record<string, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  cheque: 'Cheque',
  bank_transfer: 'Bank transfer',
  online: 'Online',
  razorpay: 'Online',
  netbanking: 'Net banking',
  dd: 'Demand draft',
};
