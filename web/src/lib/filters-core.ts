/**
 * Pure helpers behind the list filters (components/filters.tsx). No React, no browser APIs,
 * so they are unit-tested with plain Node (web/test/filters-core.test.mjs).
 *
 *  - Filter values live in the URL query string. Only values that differ from the screen's
 *    defaults are written, so a fresh screen has a clean URL and shared links stay short.
 *  - Changing any filter drops `page` (back to page 1).
 *  - Date presets (Today, This week, ...) are computed from the school's "today" (YYYY-MM-DD).
 */

export type FilterValues = Record<string, string>;

/** Anything with URLSearchParams' get(). */
export interface ParamReader {
  get(name: string): string | null;
}

export const PAGE_KEY = 'page';

/**
 * Current filter values: the URL's value for each key of `defaults`, else the default.
 * `aliases` maps an old/alternative URL name to a key (e.g. { class: 'classId' }) for links
 * written before the key was renamed; the real key wins when both are present.
 */
export function readFilters<T extends FilterValues>(params: ParamReader, defaults: T, aliases: Record<string, keyof T & string> = {}): T {
  const out = { ...defaults } as FilterValues;
  for (const [alias, key] of Object.entries(aliases)) {
    const v = params.get(alias);
    if (v !== null && v !== '') out[key] = v;
  }
  for (const key of Object.keys(defaults)) {
    const v = params.get(key);
    if (v !== null) out[key] = v;
  }
  return out as T;
}

/** Page number from the URL (1 when missing or invalid). */
export function readPage(params: ParamReader): number {
  const n = Number(params.get(PAGE_KEY));
  return Number.isInteger(n) && n > 1 ? n : 1;
}

/**
 * The next query string (without "?") after applying `patch` to `current`.
 *  - a value equal to its default (or '') removes the key from the URL;
 *  - keys that are not filters (e.g. `tab`) are kept as they are;
 *  - aliases of patched keys are removed (the canonical name replaces them);
 *  - `page` is removed unless the patch sets it (any filter change goes back to page 1).
 */
export function writeFilters(
  current: string,
  patch: Record<string, string | number | null | undefined>,
  defaults: FilterValues,
  aliases: Record<string, string> = {},
): string {
  const sp = new URLSearchParams(current);
  const setsPage = Object.prototype.hasOwnProperty.call(patch, PAGE_KEY);
  for (const [key, raw] of Object.entries(patch)) {
    const value = raw === null || raw === undefined ? '' : String(raw);
    for (const [alias, target] of Object.entries(aliases)) if (target === key) sp.delete(alias);
    if (key === PAGE_KEY) {
      if (value === '' || value === '1') sp.delete(PAGE_KEY);
      else sp.set(PAGE_KEY, value);
      continue;
    }
    const def = defaults[key] ?? '';
    // A non-empty default ("active", "all") is written explicitly when cleared to '' so the
    // URL can say "everyone" even though the screen starts filtered.
    if (value === def) sp.delete(key);
    else sp.set(key, value);
  }
  if (!setsPage) sp.delete(PAGE_KEY);
  return sp.toString();
}

/** Query string with every filter key (and aliases, and page) removed; other keys stay. */
export function clearFilters(current: string, defaults: FilterValues, aliases: Record<string, string> = {}, keep: string[] = []): string {
  const sp = new URLSearchParams(current);
  for (const key of [...Object.keys(defaults), ...Object.keys(aliases), PAGE_KEY]) if (!keep.includes(key)) sp.delete(key);
  return sp.toString();
}

/** How many filters differ from their defaults (search and sort included unless ignored). */
export function countActive(values: FilterValues, defaults: FilterValues, ignore: string[] = ['sort']): number {
  return Object.keys(defaults).filter((k) => !ignore.includes(k) && (values[k] ?? '') !== (defaults[k] ?? '')).length;
}

// ------------------------------------------------------------------ dates

export type DatePreset = '' | 'today' | 'week' | 'month' | 'last_month' | 'year' | 'custom';

export const DATE_PRESETS: Array<{ value: Exclude<DatePreset, ''>; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'year', label: 'This academic year' },
  { value: 'custom', label: 'Custom dates' },
];

export const isIsoDate = (v: string | null | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [y, m, d];
}
function iso(y: number, m: number, d: number): string {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = parts(day);
  return iso(y, m, d + n);
}

/** Monday of the week containing `day` (Indian schools run Monday to Saturday). */
export function startOfWeek(day: string): string {
  const [y, m, d] = parts(day);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(day, weekday === 0 ? -6 : 1 - weekday);
}

export function monthBounds(day: string): { from: string; to: string } {
  const [y, m] = parts(day);
  return { from: iso(y, m, 1), to: iso(y, m + 1, 0) };
}

/**
 * Indian academic year containing `day`: 1 April to 31 March (or the school's own start month).
 * Pass the real current academic year as `year` when the screen knows it.
 */
export function academicYearBounds(day: string, startMonth = 4): { from: string; to: string } {
  const [y, m] = parts(day);
  const startYear = m >= startMonth ? y : y - 1;
  return { from: iso(startYear, startMonth, 1), to: iso(startYear + 1, startMonth, 0) };
}

/** from / to for a preset ('' and 'custom' give no dates). The range never ends after `today` except "year"/"month". */
export function presetRange(preset: DatePreset, today: string, year?: { from: string; to: string }): { from: string; to: string } {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'week':
      return { from: startOfWeek(today), to: addDays(startOfWeek(today), 6) };
    case 'month':
      return monthBounds(today);
    case 'last_month': {
      const [y, m] = parts(today);
      return monthBounds(iso(y, m - 1, 1));
    }
    case 'year':
      return year ?? academicYearBounds(today);
    default:
      return { from: '', to: '' };
  }
}

/** Which preset a from / to pair is (for the dropdown), 'custom' when it matches none, '' when both empty. */
export function matchPreset(from: string, to: string, today: string, year?: { from: string; to: string }): DatePreset {
  if (!from && !to) return '';
  for (const p of ['today', 'week', 'month', 'last_month', 'year'] as const) {
    const r = presetRange(p, today, year);
    if (r.from === from && r.to === to) return p;
  }
  return 'custom';
}

const SHORT = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const LONG = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmt = (d: string, long: boolean) => (long ? LONG : SHORT).format(new Date(`${d}T00:00:00Z`));

/** Chip text for a date range: "This month", "3 Sep – 9 Sep 2026", "From 1 Sep 2026", "Up to 9 Sep 2026". */
export function describeRange(from: string, to: string, today: string, year?: { from: string; to: string }): string {
  const preset = matchPreset(from, to, today, year);
  if (preset && preset !== 'custom') return DATE_PRESETS.find((p) => p.value === preset)!.label;
  if (from && to) return from === to ? fmt(from, true) : `${fmt(from, from.slice(0, 4) !== to.slice(0, 4))} – ${fmt(to, true)}`;
  if (from) return `From ${fmt(from, true)}`;
  if (to) return `Up to ${fmt(to, true)}`;
  return '';
}
