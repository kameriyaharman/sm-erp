import type { Money } from './api';

const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

/** "4500.00" -> 450000. Exact: parses the decimal string, never goes through a float. */
export function toPaise(value: Money | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const text = typeof value === 'number' ? value.toFixed(2) : String(value).trim();
  const negative = text.startsWith('-');
  const [rupees = '0', fraction = ''] = text.replace('-', '').split('.');
  const paise = Number(rupees) * 100 + Number((fraction + '00').slice(0, 2));
  return negative ? -paise : paise;
}

/** 450000 -> "4500.00" */
export function fromPaise(paise: number): Money {
  const abs = Math.abs(paise);
  const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return paise < 0 ? `-${text}` : text;
}

/** ₹4,500 or ₹4,500.50 — paise shown only when present. Indian digit grouping. */
export function formatInr(value: Money | number): string {
  const paise = typeof value === 'number' ? Math.round(value * 100) : toPaise(value);
  return paise % 100 === 0 ? inr0.format(paise / 100) : inr2.format(paise / 100);
}

/** "2026-04-10" -> "10 Apr 2026" (treated as a calendar date, no timezone shift) */
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Validates a rupee amount typed by a user. Returns paise, or an error message. */
export function parseRupeeInput(input: string): { paise: number } | { error: string } {
  const text = input.replace(/[,\s₹]/g, '');
  if (text === '') return { error: 'Enter an amount' };
  if (!/^\d+(\.\d{0,2})?$/.test(text)) return { error: 'Use numbers only, with up to 2 decimals' };
  const paise = toPaise(text);
  if (paise <= 0) return { error: 'Amount must be more than ₹0' };
  return { paise };
}
