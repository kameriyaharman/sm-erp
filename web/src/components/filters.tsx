'use client';

/**
 * The filter system shared by every list screen.
 *
 *   const f = useUrlFilters({ search: '', classId: '', sectionId: '', status: 'all' });
 *   const cls = useClassOptions();                       // classes + sections (teachers: their sections only)
 *   <FilterBar
 *     search={<FilterSearch value={f.values.search} onChange={(search) => f.set({ search })} placeholder="…" />}
 *     active={f.active} chips={[...classSectionChips(cls, f), ...]} onClear={f.clear}>
 *     <ClassSectionFilter options={cls} classId={f.values.classId} sectionId={f.values.sectionId} onChange={f.set} />
 *     <SelectFilter label="Status" … />
 *   </FilterBar>
 *
 *  - State lives in the URL (router.replace, no scroll jump): survives reload and Back, links can be
 *    shared, and other screens deep-link (e.g. /fees?classId=…&status=overdue). Any change resets page 1.
 *  - Order on every screen: Search, Class, Section, page-specific filters, then dates.
 *  - Phones (< 640 px): the search stays visible; the other controls move behind "Filters (n)",
 *    a bottom sheet. Active filters show as removable chips under the bar on every size.
 *  - The server does the filtering; these components only build the query.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SlidersHorizontal, X } from 'lucide-react';
import { Button, EmptyState, Input, Modal, SearchInput, Select, cx } from './ui';
import { useApi } from '@/lib/useApi';
import { useTeacherScope } from '@/lib/access';
import {
  DATE_PRESETS,
  clearFilters,
  countActive,
  describeRange,
  matchPreset,
  presetRange,
  readFilters,
  readPage,
  writeFilters,
  type DatePreset,
  type FilterValues,
} from '@/lib/filters-core';

export { describeRange } from '@/lib/filters-core';

// ------------------------------------------------------------------ URL state

export interface UrlFilters<T extends FilterValues> {
  /** Current values (URL, else defaults). */
  values: T;
  /** Change some filters (page goes back to 1). */
  set: (patch: Partial<Record<keyof T, string>>) => void;
  /** Reset every filter to its default (keys in `keep` stay). */
  clear: () => void;
  page: number;
  setPage: (page: number) => void;
  /** Number of filters that differ from the defaults (sort excluded). */
  active: number;
  /** The query string for the API: the values without empty ones (merge your own extras). */
  defaults: T;
}

/**
 * Filters stored in the query string. `defaults` lists every key the screen understands;
 * `aliases` accepts older link names ({ class: 'classId' }); `keep` survives "Clear filters".
 */
export function useUrlFilters<T extends FilterValues>(
  defaults: T,
  opts: { aliases?: Record<string, keyof T & string>; keep?: Array<keyof T & string>; ignoreInCount?: Array<keyof T & string> } = {},
): UrlFilters<T> {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const defaultsKey = JSON.stringify(defaults);
  const stableDefaults = useMemo(() => JSON.parse(defaultsKey) as T, [defaultsKey]);
  const aliasKey = JSON.stringify(opts.aliases ?? {});
  const aliases = useMemo(() => JSON.parse(aliasKey) as Record<string, string>, [aliasKey]);
  const keepKey = (opts.keep ?? []).join(',');
  const ignoreKey = (opts.ignoreInCount ?? ['sort']).join(',');

  // Several set() calls in one event must compose: build each from the latest URL we asked for.
  const latest = useRef(params.toString());
  const paramsString = params.toString();
  useEffect(() => {
    latest.current = paramsString;
  }, [paramsString]);

  const go = useCallback(
    (query: string) => {
      latest.current = query;
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  const values = useMemo(() => readFilters(params, stableDefaults, aliases as Record<string, keyof T & string>), [params, stableDefaults, aliases]);
  const page = readPage(params);

  const set = useCallback(
    (patch: Partial<Record<keyof T, string>>) => go(writeFilters(latest.current, patch as Record<string, string>, stableDefaults, aliases)),
    [go, stableDefaults, aliases],
  );
  const setPage = useCallback((p: number) => go(writeFilters(latest.current, { page: p }, stableDefaults, aliases)), [go, stableDefaults, aliases]);
  const clear = useCallback(
    () => go(clearFilters(latest.current, stableDefaults, aliases, keepKey ? keepKey.split(',') : [])),
    [go, stableDefaults, aliases, keepKey],
  );
  const active = countActive(values, stableDefaults, ignoreKey ? ignoreKey.split(',') : []);
  return { values, set, clear, page, setPage, active, defaults: stableDefaults };
}

// ------------------------------------------------------------------ layout

const PHONE_QUERY = '(max-width: 639px)';
function subscribePhone(cb: () => void) {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
/** True below the `sm` breakpoint (false during server render). */
export function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}

export interface FilterChip {
  key: string;
  /** e.g. "Class: Grade 5" */
  label: string;
  onRemove: () => void;
}

type MaybeChip = FilterChip | null | false | undefined | '';

/**
 * Search + filter controls + "Clear filters" + removable chips. On phones the controls go into a
 * bottom sheet behind "Filters (n)"; the search stays in the bar. `extra` sits at the end of the row
 * on desktop (sort, export…) and inside the sheet on phones.
 */
export function FilterBar({
  search,
  children,
  chips = [],
  onClear,
  active,
  extra,
  className,
  bordered = true,
}: {
  search?: ReactNode;
  children?: ReactNode;
  chips?: MaybeChip[];
  onClear?: () => void;
  /** Count shown on the phone button; defaults to the number of chips. */
  active?: number;
  extra?: ReactNode;
  className?: string;
  /** Bottom border (inside a card above a table). */
  bordered?: boolean;
}) {
  const isPhone = useIsPhone();
  const [sheet, setSheet] = useState(false);
  const list = chips.filter(Boolean) as FilterChip[];
  const count = active ?? list.length;
  const hasControls = Boolean(children) || Boolean(extra);
  // Leaving phone width with the sheet open: close it (the controls are inline again).
  useEffect(() => {
    if (!isPhone) setSheet(false);
  }, [isPhone]);

  return (
    <div className={cx(bordered && 'border-b border-line', className)} data-filter-bar>
      {isPhone ? (
        <div className="flex items-end gap-2 p-4 pb-3">
          {search && <div className="min-w-0 flex-1">{search}</div>}
          {hasControls && (
            <Button
              variant="secondary"
              icon={<SlidersHorizontal aria-hidden />}
              onClick={() => setSheet(true)}
              aria-haspopup="dialog"
              data-filters-button
              className={cx(!search && 'w-full')}
            >
              Filters{count > 0 ? ` (${count})` : ''}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-x-3 gap-y-3 p-4 [&>*]:min-w-0">
          {search && <div className="w-full sm:w-60 xl:w-64">{search}</div>}
          {children}
          {extra && <div className="ml-auto flex flex-wrap items-end gap-3">{extra}</div>}
          {onClear && list.length > 0 && !extra && (
            <Button variant="ghost" onClick={onClear} className="ml-auto" data-clear-filters>
              Clear filters
            </Button>
          )}
        </div>
      )}

      {list.length > 0 && (
        <div className={cx('flex flex-wrap items-center gap-1.5 px-4 pb-3', !isPhone && '-mt-1')} aria-label="Active filters">
          {list.map((c) => (
            <span
              key={c.key}
              data-chip={c.key}
              className="inline-flex h-7 max-w-full items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 pl-2.5 pr-1 text-xs font-medium text-indigo-800 dark:border-indigo-400/25 dark:bg-indigo-400/10 dark:text-indigo-100"
            >
              <span className="truncate">{c.label}</span>
              {/* Named by its (screen-reader) text, not aria-label, so it never matches the filter's own label. */}
              <button
                type="button"
                onClick={c.onRemove}
                title="Remove this filter"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-indigo-500 transition-colors hover:bg-indigo-100 hover:text-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-400/20 dark:hover:text-white"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
                <span className="sr-only">Remove filter {c.label}</span>
              </button>
            </span>
          ))}
          {onClear && (isPhone || extra) && (
            <button type="button" onClick={onClear} data-clear-filters className="ml-1 h-7 px-1.5 text-xs font-medium text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline dark:text-slate-300 dark:hover:text-white">
              Clear filters
            </button>
          )}
        </div>
      )}

      {isPhone && (
        <Modal
          open={sheet}
          title="Filters"
          onClose={() => setSheet(false)}
          footer={
            <>
              {onClear && (
                <Button variant="secondary" onClick={onClear} disabled={list.length === 0} className="flex-1 sm:flex-none">
                  Clear filters
                </Button>
              )}
              <Button onClick={() => setSheet(false)} className="flex-1 sm:flex-none">
                Show results
              </Button>
            </>
          }
        >
          <div className="grid gap-4 pb-1 [&_.filter-control]:w-full" data-filter-sheet>
            {children}
            {extra}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ controls

/** Debounced (300 ms) search box. Follows `value` when it changes from outside (Clear filters, Back). */
export function FilterSearch({
  value,
  onChange,
  placeholder = 'Search',
  label = 'Search',
  delay = 300,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  delay?: number;
}) {
  const [text, setText] = useState(value);
  const pushed = useRef(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (value !== pushed.current) {
      pushed.current = value;
      setText(value);
    }
  }, [value]);
  useEffect(() => {
    const next = text.trim();
    if (next === pushed.current) return;
    const t = setTimeout(() => {
      pushed.current = next;
      onChangeRef.current(next);
    }, delay);
    return () => clearTimeout(t);
  }, [text, delay]);
  return (
    <SearchInput
      label={label}
      showLabel
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          const next = text.trim();
          if (next !== pushed.current) {
            pushed.current = next;
            onChangeRef.current(next);
          }
        }
      }}
      data-filter="search"
    />
  );
}

export interface Option {
  value: string;
  label: string;
}

/** A labelled dropdown filter. `allLabel` is the "no filter" option (value ''); omit it when a value is required. */
export function SelectFilter({
  label,
  value,
  onChange,
  options,
  allLabel,
  disabled,
  name,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  allLabel?: string;
  disabled?: boolean;
  /** data-filter attribute (tests). */
  name?: string;
  className?: string;
}) {
  return (
    <Select
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={cx('filter-control', className ?? 'sm:w-44')}
      data-filter={name}
    >
      {allLabel !== undefined && <option value="">{allLabel}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

/** Segmented control for a few statuses (All / Pending / Overdue / Paid). */
export function StatusFilter({
  label,
  value,
  onChange,
  options,
  name,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  name?: string;
}) {
  const id = useId();
  return (
    <div className="filter-control" data-filter={name}>
      <span id={id} className="mb-1.5 block text-13 font-medium text-slate-700 dark:text-slate-300">
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={id} className="flex flex-wrap gap-0.5 rounded-[10px] border border-line bg-slate-100/80 p-[3px] dark:bg-white/[0.04] sm:inline-flex sm:flex-nowrap">
        {options.map((o) => {
          const on = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.value)}
              className={cx(
                'h-8 flex-1 whitespace-nowrap rounded-[7px] px-3 text-13 font-medium transition-colors sm:h-7 sm:flex-none',
                on
                  ? 'bg-surface text-slate-900 shadow-[0_1px_2px_rgb(14_26_51/0.08),0_0_0_1px_rgb(14_26_51/0.04)] dark:bg-white/10 dark:text-white dark:shadow-none'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Checkbox filter ("Below 75% only", "Pinned only"), aligned with the other controls. */
export function ToggleFilter({ label, checked, onChange, name }: { label: string; checked: boolean; onChange: (on: boolean) => void; name?: string }) {
  return (
    <label className="filter-control flex h-10 cursor-pointer select-none items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-sm text-slate-800 hover:border-slate-400/70 dark:text-slate-100 sm:h-9 sm:self-end" data-filter={name}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
      {label}
    </label>
  );
}

/** Date range with presets (Today, This week, This month, Last month, This academic year, Custom from / to). */
export function DateRangeFilter({
  label = 'Date',
  from,
  to,
  onChange,
  today,
  year,
  max,
  name = 'date',
}: {
  label?: string;
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
  /** The school's today (YYYY-MM-DD); defaults to this device's date. */
  today?: string;
  /** The current academic year, when the screen knows it (else April to March). */
  year?: { from: string; to: string };
  /** Latest date allowed in the custom inputs. */
  max?: string;
  name?: string;
}) {
  const day = today ?? localToday();
  const preset = matchPreset(from, to, day, year);
  const [custom, setCustom] = useState(preset === 'custom');
  useEffect(() => {
    if (preset === 'custom') setCustom(true);
    else if (preset === '') setCustom(false);
  }, [preset]);
  const shown: DatePreset = custom ? 'custom' : preset;
  return (
    <div className="filter-control flex flex-wrap items-end gap-2" data-filter={name}>
      <Select
        label={label}
        // "Any time" is the option value "all" (no dates).
        value={shown || 'all'}
        className="sm:w-44"
        onChange={(e) => {
          const p = (e.target.value === 'all' ? '' : e.target.value) as DatePreset;
          if (p === 'custom') {
            setCustom(true);
            if (!from && !to) onChange(presetRange('month', day, year));
            return;
          }
          setCustom(false);
          onChange(presetRange(p, day, year));
        }}
      >
        <option value="all">Any time</option>
        {DATE_PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </Select>
      {shown === 'custom' && (
        <div className="flex min-w-0 flex-1 items-end gap-2 sm:flex-none">
          <Input label="From" type="date" value={from} max={to || max} onChange={(e) => onChange({ from: e.target.value, to })} className="min-w-0 flex-1 sm:w-40" />
          <Input label="To" type="date" value={to} min={from || undefined} max={max} onChange={(e) => onChange({ from, to: e.target.value })} className="min-w-0 flex-1 sm:w-40" />
        </div>
      )}
    </div>
  );
}

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ------------------------------------------------------------------ class / section

interface ApiSection {
  id: string;
  name: string;
  label: string;
}
interface ApiClass {
  id: string;
  name: string;
  sections: ApiSection[];
}

export interface ClassOptions {
  classes: Array<{ id: string; name: string; sections: ApiSection[] }>;
  loading: boolean;
  error: string | null;
  /** Teacher: limited to their own sections. */
  limited: boolean;
  className: (classId: string) => string | undefined;
  section: (sectionId: string) => (ApiSection & { classId: string; className: string }) | undefined;
}

/**
 * Current-year classes and sections for the Class / Section filters (GET /school/classes).
 * Teachers only get the classes and sections they teach or are class teacher of
 * (GET /teacher/assignments), so the pickers never offer something the server would refuse.
 */
export function useClassOptions(enabled = true): ClassOptions {
  const res = useApi<{ data: ApiClass[] }>(enabled ? '/school/classes' : null);
  const teacher = useTeacherScope(enabled);
  return useMemo(() => {
    const scope = teacher.scope;
    const all = res.data?.data ?? [];
    const classes = (teacher.isTeacher && !scope ? [] : all)
      .map((c) => ({ id: c.id, name: c.name, sections: c.sections.filter((s) => !scope || scope.sectionIds.has(s.id)) }))
      .filter((c) => !scope || c.sections.length > 0);
    const sections = new Map(classes.flatMap((c) => c.sections.map((s) => [s.id, { ...s, classId: c.id, className: c.name }] as const)));
    const names = new Map(classes.map((c) => [c.id, c.name]));
    return {
      classes,
      loading: res.loading || teacher.loading,
      error: res.error ?? teacher.error,
      limited: teacher.isTeacher,
      className: (id: string) => names.get(id),
      section: (id: string) => sections.get(id),
    };
  }, [res.data, res.loading, res.error, teacher.scope, teacher.isTeacher, teacher.loading, teacher.error]);
}

/**
 * Class select, then Section (of that class). Picking a section first is not possible; changing the
 * class clears the section. `requireSection` hides "All" options (screens that show one section).
 */
export function ClassSectionFilter({
  options,
  classId,
  sectionId,
  onChange,
  requireSection = false,
  allClassesLabel,
  showSection = true,
}: {
  options: ClassOptions;
  classId: string;
  sectionId: string;
  onChange: (patch: { classId: string; sectionId: string }) => void;
  requireSection?: boolean;
  allClassesLabel?: string;
  showSection?: boolean;
}) {
  // A section link without its class (?sectionId=… only): show the section's class.
  const effectiveClassId = classId || options.section(sectionId)?.classId || '';
  const cls = options.classes.find((c) => c.id === effectiveClassId);
  const sections = cls?.sections ?? [];
  return (
    <>
      <SelectFilter
        label="Class"
        name="classId"
        value={effectiveClassId}
        allLabel={requireSection ? undefined : allClassesLabel ?? (options.limited ? 'All my classes' : 'All classes')}
        disabled={options.loading && options.classes.length === 0}
        options={[
          ...(requireSection && !effectiveClassId ? [{ value: '', label: options.loading ? 'Loading…' : 'Choose a class' }] : []),
          ...options.classes.map((c) => ({ value: c.id, label: c.name })),
        ]}
        onChange={(id) => {
          const next = options.classes.find((c) => c.id === id);
          // One section in the class (or a screen that needs one): pick it straight away.
          const only = requireSection && next?.sections.length ? next.sections[0].id : '';
          onChange({ classId: id, sectionId: only });
        }}
      />
      {showSection && (
        <SelectFilter
          label="Section"
          name="sectionId"
          value={sectionId}
          allLabel={requireSection ? undefined : 'All sections'}
          disabled={!effectiveClassId || sections.length === 0}
          options={[
            ...(requireSection && !sectionId ? [{ value: '', label: effectiveClassId && sections.length === 0 ? 'No sections' : 'Choose a section' }] : []),
            ...sections.map((s) => ({ value: s.id, label: s.name })),
          ]}
          onChange={(id) => onChange({ classId: effectiveClassId, sectionId: id })}
          className="sm:w-36"
        />
      )}
    </>
  );
}

/** Chips for the class / section pair ("Class: Grade 5", "Section: A"). */
export function classSectionChips(
  options: ClassOptions,
  values: { classId?: string; sectionId?: string },
  set: (patch: { classId?: string; sectionId?: string }) => void,
): FilterChip[] {
  const out: FilterChip[] = [];
  const sec = values.sectionId ? options.section(values.sectionId) : undefined;
  const classId = values.classId || sec?.classId || '';
  if (classId) {
    out.push({ key: 'classId', label: `Class: ${options.className(classId) ?? '…'}`, onRemove: () => set({ classId: '', sectionId: '' }) });
  }
  if (values.sectionId) {
    out.push({ key: 'sectionId', label: `Section: ${sec?.name ?? '…'}`, onRemove: () => set({ sectionId: '' }) });
  }
  return out;
}

/** A chip for a simple value, or null when the value is the default. */
export function chip(key: string, label: string, value: string, display: string | undefined, onRemove: () => void, isDefault = value === ''): FilterChip | null {
  if (isDefault) return null;
  return { key, label: `${label}: ${display ?? value}`, onRemove };
}

/** Text that lists the active filters, for empty states and print headers ("Class: Grade 5 · Status: Overdue"). */
export function describeFilters(chips: MaybeChip[]): string {
  return (chips.filter(Boolean) as FilterChip[]).map((c) => c.label).join(' · ');
}

/** "No students match these filters" + which filters + a Clear filters button. */
export function FilteredEmpty({
  what,
  chips,
  onClear,
  icon,
  hint = 'Remove a filter or clear them all to see more.',
}: {
  what: string;
  chips: MaybeChip[];
  onClear: () => void;
  icon?: ReactNode;
  hint?: string;
}) {
  const text = describeFilters(chips);
  return (
    <div data-empty-filtered>
      <EmptyState
        icon={icon}
        title={`No ${what} match these filters`}
        description={
          <>
            {text && <span className="block font-medium text-slate-700 dark:text-slate-300">{text}</span>}
            <span className="mt-1 block">{hint}</span>
          </>
        }
        action={
          <Button variant="secondary" size="sm" onClick={onClear} data-clear-filters>
            Clear filters
          </Button>
        }
      />
    </div>
  );
}

/** Small inline count + "matching the filters" line used above tables. */
export function ResultCount({ total, noun, filtered }: { total: number | null | undefined; noun: [string, string]; filtered: boolean }) {
  if (total === null || total === undefined) return null;
  return (
    <p className="text-13 tabular-nums text-slate-500 dark:text-slate-400" data-result-count={total}>
      {total.toLocaleString('en-IN')} {total === 1 ? noun[0] : noun[1]}
      {filtered ? ' match the filters' : ''}
    </p>
  );
}
