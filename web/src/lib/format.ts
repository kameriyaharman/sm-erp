/** Display helpers shared by every screen. Money is a rupee decimal string ("4500.00") as the API sends it. */
export { formatInr, formatDate, todayIso, toPaise, fromPaise, parseRupeeInput } from '@/features/fees/format';

/** ISO timestamp -> "12 Aug 2026, 10:30 am" in Indian time */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

/** "08:00:00" | "08:00" -> "8:00 am" */
export function formatTime(t: string | null | undefined): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** "2026-09" -> "September 2026" */
export function formatMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function titleCase(text: string): string {
  return text.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** New idempotency key for POSTs that must not run twice (payments). */
export function idempotencyKey(prefix = 'web'): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
