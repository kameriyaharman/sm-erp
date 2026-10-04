/**
 * Pure helpers for the day book: running balances, per-day roll-ups, account balances,
 * income/expense summaries and CSV. Money is integer paise. Unit-tested in test/accounts.test.js.
 */

export const INCOME_CATEGORIES = ['fees', 'admission', 'donation', 'transport', 'canteen', 'grant', 'interest', 'other_income'];
/** Expense categories = the expenses table's categories (an "out" in the day book is an expense row). */
export const EXPENSE_CATEGORIES = [
  'salary', 'utilities', 'maintenance', 'transport', 'supplies', 'events', 'rent', 'printing', 'canteen', 'bank_charges', 'taxes', 'other',
];
/** Income a person may enter by hand: fees come only from fee collection (receipts). */
export const MANUAL_INCOME_CATEGORIES = INCOME_CATEGORIES.filter((c) => c !== 'fees');
export const TRANSFER = 'transfer';
export const FEE_REFUND = 'fee_refund';

const signed = (e) => (e.direction === 'in' ? e.amount : -e.amount);

/**
 * Adds a running balance to entries already in day-book order.
 * entries: [{ direction: 'in'|'out', amount: paise, ... }]
 * -> { entries: [{ ...e, in, out, balance }], totalIn, totalOut, opening, closing }
 */
export function withRunningBalance(opening, entries) {
  let balance = opening;
  let totalIn = 0;
  let totalOut = 0;
  const out = entries.map((e) => {
    if (!Number.isInteger(e.amount) || e.amount <= 0) throw new RangeError('amount must be a positive integer (paise)');
    balance += signed(e);
    if (e.direction === 'in') totalIn += e.amount;
    else totalOut += e.amount;
    return { ...e, in: e.direction === 'in' ? e.amount : 0, out: e.direction === 'out' ? e.amount : 0, balance };
  });
  return { entries: out, opening, totalIn, totalOut, closing: balance };
}

/**
 * Opening balance of a set of accounts at the start of `date`:
 * opening balances of accounts opened on or before `date` + every entry dated before `date`.
 * accounts: [{ openingBalance, openingDate, before }] where `before` = net of entries dated before `date`.
 */
export function openingOn(date, accounts) {
  return accounts.reduce((sum, a) => sum + (a.openingDate <= date ? a.openingBalance : 0) + (a.before ?? 0), 0);
}

/** Every date from `from` to `to` inclusive ("YYYY-MM-DD"). */
export function datesBetween(from, to) {
  const out = [];
  let d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86_400_000);
  }
  return out;
}

/**
 * Per-day roll-up for a date range: each day's opening, in, out and closing, chained so that
 * one day's closing is the next day's opening (plus any account opened that day).
 *   opening      balance at the start of `from` (openingOn(from, ...))
 *   totals       Map date -> { in, out, count }
 *   openedOn     Map date -> opening balances of accounts whose book starts that day (after `from`)
 */
export function dailyRollup({ from, to, opening, totals, openedOn = new Map() }) {
  let balance = opening;
  let totalIn = 0;
  let totalOut = 0;
  const days = datesBetween(from, to).map((date) => {
    if (date !== from) balance += openedOn.get(date) ?? 0;
    const t = totals.get(date) ?? { in: 0, out: 0, count: 0 };
    const dayOpening = balance;
    balance += t.in - t.out;
    totalIn += t.in;
    totalOut += t.out;
    return { date, opening: dayOpening, in: t.in, out: t.out, closing: balance, entries: t.count };
  });
  return { days, opening, totalIn, totalOut, closing: balance };
}

/**
 * Income vs expense for a period. entries: [{ direction, category, amount }] (no deleted rows).
 * Transfers move money between the school's own accounts and are neither. Fee refunds and
 * cancelled receipts reduce fee income instead of counting as an expense.
 */
export function incomeExpenseSummary(entries) {
  const income = new Map();
  const expense = new Map();
  let feeRefunds = 0;
  for (const e of entries) {
    if (e.category === TRANSFER) continue;
    if (e.category === FEE_REFUND) {
      feeRefunds += e.amount;
      continue;
    }
    const bucket = e.direction === 'in' ? income : expense;
    bucket.set(e.category, (bucket.get(e.category) ?? 0) + e.amount);
  }
  if (feeRefunds) income.set('fees', (income.get('fees') ?? 0) - feeRefunds);
  const list = (m) => [...m.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
  const totalIncome = [...income.values()].reduce((a, b) => a + b, 0);
  const totalExpense = [...expense.values()].reduce((a, b) => a + b, 0);
  return { income: list(income), expense: list(expense), feeRefunds, totalIncome, totalExpense, net: totalIncome - totalExpense };
}

/** Indian financial year: "2026-05-10" -> "2026-27", "2027-02-01" -> "2026-27". */
export function fyKey(iso) {
  const [y, m] = iso.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** 123450 -> "1234.50" (plain, for CSV / spreadsheets). */
export function plainRupees(paise) {
  const neg = paise < 0;
  const abs = Math.abs(paise);
  return `${neg ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * One CSV cell. Quotes when needed; text that a spreadsheet would run as a formula
 * (=, +, -, @, tab, CR at the start) is prefixed with an apostrophe. Numbers pass through.
 */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows) {
  return `${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
