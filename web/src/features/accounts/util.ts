'use client';

import { API_BASE, ApiError, getAccessToken } from '@/lib/session';
import { fromPaise, toPaise } from '@/lib/format';

/** "2026-10-03" + 1 -> "2026-10-04" (calendar arithmetic, no timezone shift). */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-10-03" -> "Saturday, 3 October 2026" */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${d} ${MONTHS[m - 1]} ${y}`;
}

/** Calendar date (Indian time) of an ISO timestamp. */
export function istDate(iso: string): string {
  return new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/** "2026-10-03" -> "Sat, 3 Oct" */
export function shortDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()].slice(0, 3)}, ${d} ${MONTHS[m - 1].slice(0, 3)}`;
}

/** ISO timestamp -> "10:30 am" in Indian time. */
export function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

export function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** Signed paise of a money string, for colouring. */
export const paise = (m: string | null | undefined) => toPaise(m ?? '0');
export const money = fromPaise;

/** Plain number for print / tables: "1,23,450.00" (Indian grouping, always 2 decimals). */
const plain = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function amountText(m: string | null | undefined): string {
  const p = paise(m);
  return plain.format(p / 100);
}

/** Authenticated download of a CSV (or any file) the API sends as an attachment. */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const token = await getAccessToken();
  if (!token) throw new ApiError('UNAUTHENTICATED', 'Your session has ended. Please sign in again.', 401);
  const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new ApiError(payload?.error?.code ?? 'HTTP_ERROR', payload?.error?.message ?? `Download failed (${res.status})`, res.status);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
