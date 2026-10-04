/**
 * Pure helpers for class-wise fee structures: instalment schedules, date shifting,
 * concession maths, totals and row validation. Money is integer paise throughout.
 * Unit-tested in test/fee-setup.test.js.
 */

export const FREQUENCIES = ['monthly', 'quarterly', 'half_yearly', 'annual', 'one_time'];
export const INSTALMENT_COUNT = { monthly: 12, quarterly: 4, half_yearly: 2, annual: 1, one_time: 1 };

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parts(iso) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return { y, m, d };
}

const pad = (n) => String(n).padStart(2, '0');
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12

/** Calendar date of (year, month 1-12 possibly out of range, day clamped to the month). */
export function makeDate(y, m, d) {
  const total = y * 12 + (m - 1);
  const yy = Math.floor(total / 12);
  const mm = (total % 12) + 1;
  return `${yy}-${pad(mm)}-${pad(Math.min(d, daysIn(yy, mm)))}`;
}

/** "2026-01-31" + 1 month -> "2026-02-28" (day clamped, never rolls into the next month). */
export function addMonths(iso, months) {
  const { y, m, d } = parts(iso);
  return makeDate(y, m + months, d);
}

/** Whole months from the month of `fromIso` to the month of `toIso` ("2025-04-01" -> "2026-04-01" = 12). */
export function monthsBetween(fromIso, toIso) {
  const a = parts(fromIso);
  const b = parts(toIso);
  return (b.y - a.y) * 12 + (b.m - a.m);
}

/**
 * Splits `total` paise into `n` instalments that add up exactly. Whole-rupee totals stay in
 * whole rupees (₹10,000 / 3 = 3,334 + 3,333 + 3,333); the remainder goes to the first ones.
 */
export function splitAmount(total, n) {
  if (!Number.isInteger(total) || total < 0) throw new RangeError('total must be a non-negative integer (paise)');
  if (!Number.isInteger(n) || n < 1) throw new RangeError('n must be a positive integer');
  const unit = total % 100 === 0 ? 100 : 1;
  const units = total / unit;
  const base = Math.floor(units / n);
  const extra = units - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < extra ? 1 : 0)) * unit);
}

function label(frequency, index, startMonth, startYear) {
  const m0 = startMonth - 1 + index * (12 / INSTALMENT_COUNT[frequency]);
  const name = (k) => MONTH_SHORT[((k % 12) + 12) % 12];
  switch (frequency) {
    case 'monthly':
      return `${name(m0)} ${startYear + Math.floor(m0 / 12)}`;
    case 'quarterly':
      return `Q${index + 1} (${name(m0)}-${name(m0 + 2)})`;
    case 'half_yearly':
      return `Term ${index + 1} (${name(m0)}-${name(m0 + 5)})`;
    case 'annual':
      return 'Annual';
    default:
      return 'One-time';
  }
}

/**
 * Instalment schedule for one fee head in one academic year.
 *   frequency      monthly | quarterly | half_yearly | annual | one_time
 *   yearStart      "2026-04-01" (the academic year's start date)
 *   dueDay         day of the month the instalment is due (1-31, clamped to short months)
 *   amount         paise per instalment, OR
 *   total          paise for the whole year, split exactly across instalments
 * Quarterly from April with dueDay 10 -> 10 Apr, 10 Jul, 10 Oct, 10 Jan.
 */
export function generateInstallments({ frequency, yearStart, dueDay = 10, amount, total }) {
  if (!FREQUENCIES.includes(frequency)) throw new RangeError(`Unknown frequency: ${frequency}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(yearStart ?? '')) throw new RangeError('yearStart must be YYYY-MM-DD');
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) throw new RangeError('dueDay must be 1-31');
  if ((amount === undefined) === (total === undefined)) throw new RangeError('Pass exactly one of amount or total');
  const n = INSTALMENT_COUNT[frequency];
  const amounts = total !== undefined ? splitAmount(total, n) : Array(n).fill(amount);
  if (amounts.some((a) => !Number.isInteger(a) || a < 0)) throw new RangeError('amount must be a non-negative integer (paise)');
  const { y, m } = parts(yearStart);
  const step = 12 / n;
  return amounts.map((amt, i) => ({
    installmentNo: i + 1,
    label: label(frequency, i, m, y),
    dueDate: makeDate(y, m + i * step, dueDay),
    amount: amt,
  }));
}

/**
 * Concession on one instalment, in paise.
 *   percentage  value = percent (0-100, up to 2 decimals), rounded half up to the paisa
 *   flat        value = paise off this instalment, capped at the instalment
 *   full_waiver the whole instalment
 */
export function concessionPaise({ type, value = 0, base }) {
  if (!Number.isInteger(base) || base < 0) throw new RangeError('base must be a non-negative integer (paise)');
  switch (type) {
    case 'percentage': {
      const hundredths = Math.round(Number(value) * 100); // 12.5% -> 1250
      if (!(hundredths >= 0 && hundredths <= 10000)) throw new RangeError('percentage must be 0-100');
      return Math.floor((base * hundredths + 5000) / 10000);
    }
    case 'flat':
      if (!Number.isInteger(value) || value < 0) throw new RangeError('flat value must be paise');
      return Math.min(value, base);
    case 'full_waiver':
      return base;
    case 'none':
    case undefined:
    case null:
      return 0;
    default:
      throw new RangeError(`Unknown concession type: ${type}`);
  }
}

/** The rule that applies to an allocation: a head-specific rule wins over an "all heads" rule. */
export function pickRule(rules, feeHeadId) {
  return rules.find((r) => r.feeHeadId === feeHeadId) ?? rules.find((r) => !r.feeHeadId) ?? null;
}

/**
 * Totals of a structure grid. rows: [{ feeHeadId, installmentNo, amount (paise) }]
 * -> { annual, byHead: { [feeHeadId]: paise }, byInstallment: { [installmentNo]: paise } }
 */
export function structureTotals(rows) {
  const byHead = {};
  const byInstallment = {};
  let annual = 0;
  for (const r of rows) {
    annual += r.amount;
    byHead[r.feeHeadId] = (byHead[r.feeHeadId] ?? 0) + r.amount;
    byInstallment[r.installmentNo] = (byInstallment[r.installmentNo] ?? 0) + r.amount;
  }
  return { annual, byHead, byInstallment };
}

/**
 * Checks a submitted structure. rows: [{ feeHeadId, frequency, installmentNo, dueDate, amount }].
 * Returns [{ path, message }] (empty = valid):
 *  - one frequency per head, instalment numbers within that frequency's count, no duplicates
 *  - due dates inside the academic year (allowing 3 months before it starts, for admission fees)
 */
export function validateStructureRows(rows, { startDate, endDate }) {
  const issues = [];
  const seen = new Set();
  const freqByHead = new Map();
  const earliest = addMonths(startDate, -3);
  rows.forEach((r, i) => {
    const key = `${r.feeHeadId}#${r.installmentNo}`;
    if (seen.has(key)) issues.push({ path: `rows.${i}.installmentNo`, message: 'This instalment appears twice for the same fee head' });
    seen.add(key);
    const f = freqByHead.get(r.feeHeadId);
    if (f && f !== r.frequency) issues.push({ path: `rows.${i}.frequency`, message: 'A fee head can have only one frequency in a class' });
    if (!f) freqByHead.set(r.feeHeadId, r.frequency);
    if (r.installmentNo > INSTALMENT_COUNT[r.frequency]) {
      issues.push({ path: `rows.${i}.installmentNo`, message: `A ${r.frequency.replace('_', '-')} fee has at most ${INSTALMENT_COUNT[r.frequency]} instalment(s)` });
    }
    if (r.dueDate < earliest || r.dueDate > endDate) {
      issues.push({ path: `rows.${i}.dueDate`, message: `Due date must fall in the academic year (${startDate} to ${endDate})` });
    }
  });
  return issues;
}
