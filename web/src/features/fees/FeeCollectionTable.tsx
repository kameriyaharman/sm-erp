'use client';

import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  Clock,
  IndianRupee,
  LoaderCircle,
  Minus,
  Search,
  TriangleAlert,
  X,
} from 'lucide-react';
import type { FeesApi, ListStudentsParams, Receipt, StudentFeeList, StudentFeeRow, StudentFeeStatus } from './api';
import { formatInr, toPaise } from './format';
import CollectFeeModal from './CollectFeeModal';

/* ============================================================================
 * Fee collection table
 * Server-paginated list of students with total fee, paid and pending, search,
 * status filter, sorting, and a "Collect fee" action that opens the modal.
 * ========================================================================== */

type StatusFilter = NonNullable<ListStudentsParams['status']>;
type SortKey = NonNullable<ListStudentsParams['sort']>;

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'paid', label: 'Fully paid' },
];

const STATUS_TAG: Record<StudentFeeStatus, { label: string; icon: typeof CircleCheck; iconClass: string; chip: string }> = {
  paid: {
    label: 'Paid',
    icon: CircleCheck,
    iconClass: 'text-[#0ca30c]',
    chip: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/25',
  },
  partially_paid: {
    label: 'Part paid',
    icon: CircleDashed,
    iconClass: 'text-slate-500 dark:text-slate-400',
    chip: 'bg-slate-100 text-slate-700 ring-slate-300/60 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
  },
  unpaid: {
    label: 'Unpaid',
    icon: Clock,
    iconClass: 'text-[#d99a0b] dark:text-[#fab219]',
    chip: 'bg-amber-50 text-amber-800 ring-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/25',
  },
  overdue: {
    label: 'Overdue',
    icon: TriangleAlert,
    iconClass: 'text-[#d03b3b]',
    chip: 'bg-red-50 text-red-800 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/25',
  },
  no_fees: {
    label: 'No fees',
    icon: Minus,
    iconClass: 'text-slate-400',
    chip: 'bg-white text-slate-500 ring-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:ring-slate-700',
  },
};

const PAGE_SIZE = 20;

function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

interface FeeCollectionTableProps {
  api: FeesApi;
  /** Optional fixed filters, e.g. from a branch or class picker elsewhere on the page. */
  baseParams?: Omit<ListStudentsParams, 'search' | 'status' | 'sort' | 'page' | 'limit'>;
}

export default function FeeCollectionTable({ api, baseParams }: FeeCollectionTableProps) {
  const searchId = useId();
  const sortId = useId();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim());
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<SortKey>('pending');
  const [page, setPage] = useState(1);

  const [result, setResult] = useState<StudentFeeList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [collectFor, setCollectFor] = useState<StudentFeeRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Any filter change goes back to page 1.
  useEffect(() => setPage(1), [debouncedSearch, status, sort]);

  const baseKey = JSON.stringify(baseParams ?? {});
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api
      .listStudents(
        { ...(JSON.parse(baseKey) as ListStudentsParams), search: debouncedSearch || undefined, status, sort, page, limit: PAGE_SIZE },
        controller.signal,
      )
      .then((data) => {
        setResult(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if ((err as Error).name === 'AbortError') return;
        setError((err as Error).message);
        setLoading(false);
      });
    return () => controller.abort();
  }, [api, baseKey, debouncedSearch, status, sort, page, reloadKey]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  const onCollected = useCallback((receipt: Receipt) => {
    setToast(`Collected ${formatInr(receipt.amount)}. Receipt ${receipt.receiptNumber}.`);
    setReloadKey((k) => k + 1); // refresh paid/pending in the background
  }, []);

  const rows = result?.data ?? [];
  const meta = result?.meta;
  const firstRow = meta && meta.total > 0 ? (meta.page - 1) * meta.limit + 1 : 0;
  const lastRow = meta ? Math.min(meta.page * meta.limit, meta.total) : 0;
  const hasFilters = debouncedSearch !== '' || status !== 'all';

  return (
    <section aria-labelledby={`${searchId}-title`} className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      {/* Header + totals */}
      <div className="flex flex-wrap items-end justify-between gap-6 border-b border-slate-100 px-6 py-5 dark:border-slate-800">
        <div>
          <h2 id={`${searchId}-title`} className="text-base font-semibold text-slate-900 dark:text-slate-50">
            Fee collection
          </h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            {rows[0]?.academicYear ? `Academic year ${rows[0].academicYear.name}. ` : ''}
            Totals cover every student matching the filters.
          </p>
        </div>
        {meta && <Totals totals={meta.totals} />}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 px-6 py-4">
        <div className="relative w-72">
          <label htmlFor={searchId} className="sr-only">
            Search students
          </label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            id={searchId}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or admission no."
            className="block w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-8 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-900/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-white/20 [&::-webkit-search-cancel-button]:hidden"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>

        <div role="radiogroup" aria-label="Filter by payment status" className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
          {STATUS_FILTERS.map((option) => {
            const active = status === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setStatus(option.value)}
                className={[
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-slate-300',
                  active
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
                ].join(' ')}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {loading && result && <LoaderCircle className="h-4 w-4 animate-spin text-slate-400" aria-label="Updating" />}
          <label htmlFor={sortId} className="text-sm text-slate-500 dark:text-slate-400">
            Sort by
          </label>
          <select
            id={sortId}
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-lg border border-slate-300 bg-white py-1.5 pl-3 pr-8 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-900/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="pending">Highest pending</option>
            <option value="name">Student name</option>
            <option value="admission">Admission no.</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[920px] border-t border-slate-100 text-sm dark:border-slate-800" aria-busy={loading}>
          <caption className="sr-only">Students with total fee, amount paid, amount pending and payment status</caption>
          <thead>
            <tr className="bg-slate-50/70 text-left text-xs font-medium text-slate-500 dark:bg-slate-800/30 dark:text-slate-400">
              <th scope="col" className="px-6 py-2.5 font-medium">Student</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Class</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Total fee</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Paid</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Pending</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
              <th scope="col" className="px-6 py-2.5 text-right font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className={`divide-y divide-slate-100 dark:divide-slate-800 ${loading && result ? 'opacity-60' : ''}`}>
            {!result && loading && <SkeletonRows />}

            {error && (
              <tr>
                <td colSpan={7} className="px-6 py-14 text-center">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Couldn&apos;t load students</p>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{error}</p>
                  <button
                    type="button"
                    onClick={() => setReloadKey((k) => k + 1)}
                    className="mt-3 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Try again
                  </button>
                </td>
              </tr>
            )}

            {!error && result && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-14 text-center">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">No students match these filters</p>
                  {hasFilters && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearch('');
                        setStatus('all');
                      }}
                      className="mt-2 text-sm font-medium text-slate-600 underline underline-offset-2 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                    >
                      Clear filters
                    </button>
                  )}
                </td>
              </tr>
            )}

            {!error &&
              rows.map((row) => (
                <StudentRow key={row.studentId} row={row} onCollect={() => setCollectFor(row)} />
              ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {meta && meta.total > 0 && (
        <div className="flex items-center justify-between border-t border-slate-100 px-6 py-3 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
          <p className="tabular-nums">
            Showing {firstRow}–{lastRow} of {meta.total.toLocaleString('en-IN')} students
          </p>
          <div className="flex items-center gap-1">
            <PageButton label="Previous page" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </PageButton>
            <span className="px-2 tabular-nums">
              Page {meta.page} of {Math.max(meta.totalPages, 1)}
            </span>
            <PageButton label="Next page" disabled={page >= meta.totalPages || loading} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="h-4 w-4" aria-hidden />
            </PageButton>
          </div>
        </div>
      )}

      {collectFor && (
        <CollectFeeModal api={api} student={collectFor} onClose={() => setCollectFor(null)} onCollected={onCollected} />
      )}

      {/* Toast */}
      <div aria-live="polite" className="pointer-events-none fixed bottom-6 right-6 z-[60]">
        {toast && (
          <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
            <CircleCheck className="h-5 w-5 text-[#0ca30c]" aria-hidden />
            <span className="tabular-nums">{toast}</span>
            <button type="button" onClick={() => setToast(null)} aria-label="Dismiss" className="ml-2 rounded p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/* ============================================================================ */

function StudentRow({ row, onCollect }: { row: StudentFeeRow; onCollect: () => void }) {
  const tag = STATUS_TAG[row.status];
  const TagIcon = tag.icon;
  const total = toPaise(row.totalFee);
  const paid = toPaise(row.paid);
  const pending = toPaise(row.pending);
  const paidShare = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
  const classLabel = [row.class?.name, row.section?.name].filter(Boolean).join(' ') || 'Not assigned';

  return (
    <tr className="transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
      <th scope="row" className="px-6 py-3 text-left font-normal">
        <span className="block font-medium text-slate-900 dark:text-slate-100">{row.studentName}</span>
        <span className="block text-xs tabular-nums text-slate-500 dark:text-slate-400">{row.admissionNumber}</span>
      </th>
      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{classLabel}</td>
      <td className="px-4 py-3 text-right tabular-nums text-slate-900 dark:text-slate-100">{formatInr(row.totalFee)}</td>
      <td className="px-4 py-3 text-right tabular-nums">
        <span className="block text-slate-900 dark:text-slate-100">{formatInr(row.paid)}</span>
        {total > 0 && (
          <span className="ml-auto mt-1.5 block h-1 w-20 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden>
            <span className="block h-full rounded-full bg-[#2a78d6] dark:bg-[#3987e5]" style={{ width: `${paidShare}%` }} />
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <span className={`block font-semibold tabular-nums ${pending > 0 ? 'text-slate-900 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500'}`}>
          {formatInr(row.pending)}
        </span>
        {toPaise(row.overdue) > 0 && (
          <span className="block text-xs tabular-nums text-red-700 dark:text-red-400">{formatInr(row.overdue)} overdue</span>
        )}
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tag.chip}`}>
          <TagIcon className={`h-3.5 w-3.5 ${tag.iconClass}`} aria-hidden />
          {tag.label}
        </span>
      </td>
      <td className="px-6 py-3 text-right">
        {pending > 0 ? (
          <button
            type="button"
            onClick={onCollect}
            aria-label={`Collect fee from ${row.studentName}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 shadow-sm transition-colors hover:border-slate-900 hover:bg-slate-900 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-white dark:hover:bg-white dark:hover:text-slate-900 dark:focus-visible:ring-slate-300 dark:focus-visible:ring-offset-slate-900"
          >
            <IndianRupee className="h-3.5 w-3.5" aria-hidden />
            Collect fee
          </button>
        ) : (
          <span className="text-xs text-slate-400 dark:text-slate-500">Nothing due</span>
        )}
      </td>
    </tr>
  );
}

function Totals({ totals }: { totals: StudentFeeList['meta']['totals'] }) {
  const total = toPaise(totals.totalFee);
  const paid = toPaise(totals.paid);
  const share = total > 0 ? (paid / total) * 100 : 0;
  return (
    <dl className="flex flex-wrap items-end gap-x-8 gap-y-3">
      <div>
        <dt className="text-xs text-slate-500 dark:text-slate-400">Total fee</dt>
        <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">{formatInr(totals.totalFee)}</dd>
      </div>
      <div>
        <dt className="text-xs text-slate-500 dark:text-slate-400">Collected</dt>
        <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">
          {formatInr(totals.paid)}
          <span className="ml-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">{share.toFixed(1)}%</span>
        </dd>
      </div>
      <div>
        <dt className="text-xs text-slate-500 dark:text-slate-400">Pending</dt>
        <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">{formatInr(totals.pending)}</dd>
      </div>
    </dl>
  );
}

function PageButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      {children}
    </button>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 6 }, (_, i) => (
        <tr key={i} aria-hidden>
          {[40, 20, 16, 16, 16, 14, 18].map((w, j) => (
            <td key={j} className={j === 0 ? 'px-6 py-4' : 'px-4 py-4'}>
              <span className="block h-3.5 animate-pulse rounded bg-slate-100 dark:bg-slate-800" style={{ width: `${w * 3}px` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
