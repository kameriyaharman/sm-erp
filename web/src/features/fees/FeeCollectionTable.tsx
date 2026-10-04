'use client';

import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, CircleCheck, CircleDashed, Clock, IndianRupee, LoaderCircle, Minus, TriangleAlert, X } from 'lucide-react';
import type { FeesApi, ListStudentsParams, Receipt, StudentFeeList, StudentFeeRow, StudentFeeStatus } from './api';
import { formatInr, toPaise } from './format';
import CollectFeeModal from './CollectFeeModal';
import { buttonClass } from '@/components/ui';
import {
  ClassSectionFilter,
  FilterBar,
  FilterSearch,
  FilteredEmpty,
  SelectFilter,
  StatusFilter,
  chip,
  classSectionChips,
  describeFilters,
  useClassOptions,
  useUrlFilters,
} from '@/components/filters';

/* ============================================================================
 * Fee collection table
 * Server-paginated list of students with total fee, paid and pending; filters
 * (search, class, section, status, sort) live in the URL and the server applies
 * them, so the totals strip always matches the filters. "Collect fee" opens the modal.
 * ========================================================================== */

type FeeStatusFilter = NonNullable<ListStudentsParams['status']>;
type SortKey = NonNullable<ListStudentsParams['sort']>;

const STATUS_FILTERS: { value: FeeStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'paid', label: 'Fully paid' },
];

const STATUS_TAG: Record<StudentFeeStatus, { label: string; icon: typeof CircleCheck; iconClass: string; chip: string }> = {
  paid: {
    label: 'Paid',
    icon: CircleCheck,
    iconClass: 'text-emerald-600 dark:text-emerald-400',
    chip: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300',
  },
  partially_paid: {
    label: 'Part paid',
    icon: CircleDashed,
    iconClass: 'text-slate-500 dark:text-slate-400',
    chip: 'bg-slate-100 text-slate-700 dark:bg-white/[0.07] dark:text-slate-300',
  },
  unpaid: {
    label: 'Unpaid',
    icon: Clock,
    iconClass: 'text-amber-600 dark:text-amber-400',
    chip: 'bg-amber-50 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300',
  },
  overdue: {
    label: 'Overdue',
    icon: TriangleAlert,
    iconClass: 'text-red-600 dark:text-red-400',
    chip: 'bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-300',
  },
  no_fees: {
    label: 'No fees',
    icon: Minus,
    iconClass: 'text-slate-400',
    chip: 'bg-transparent text-slate-500 dark:text-slate-400',
  },
};

const PAGE_SIZE = 20;

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'pending', label: 'Highest pending' },
  { value: 'name', label: 'Student name' },
  { value: 'admission', label: 'Admission no.' },
];

/** Filters in the URL: /fees?classId=…&sectionId=…&status=overdue&search=…&sort=name&page=2 */
const FILTER_DEFAULTS = { search: '', classId: '', sectionId: '', status: 'all', sort: 'pending' };
const isStatus = (v: string): v is FeeStatusFilter => STATUS_FILTERS.some((o) => o.value === v);
const isSort = (v: string): v is SortKey => SORT_OPTIONS.some((o) => o.value === v);

interface FeeCollectionTableProps {
  api: FeesApi;
  /** Optional fixed filters, e.g. from a branch picker elsewhere on the page. */
  baseParams?: Omit<ListStudentsParams, 'search' | 'status' | 'sort' | 'page' | 'limit' | 'classId' | 'sectionId'>;
  /** Bump to reload (e.g. after "Add charge" on the page). */
  refreshKey?: number;
}

export default function FeeCollectionTable({ api, baseParams, refreshKey = 0 }: FeeCollectionTableProps) {
  const titleId = useId();
  const f = useUrlFilters(FILTER_DEFAULTS);
  const cls = useClassOptions();
  const { search, classId, sectionId } = f.values;
  const status: FeeStatusFilter = isStatus(f.values.status) ? f.values.status : 'all';
  const sort: SortKey = isSort(f.values.sort) ? f.values.sort : 'pending';
  const page = f.page;

  const [result, setResult] = useState<StudentFeeList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [collectFor, setCollectFor] = useState<StudentFeeRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const baseKey = JSON.stringify(baseParams ?? {});
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api
      .listStudents(
        {
          ...(JSON.parse(baseKey) as ListStudentsParams),
          search: search || undefined,
          classId: classId || undefined,
          sectionId: sectionId || undefined,
          status,
          sort,
          page,
          limit: PAGE_SIZE,
        },
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
  }, [api, baseKey, search, classId, sectionId, status, sort, page, reloadKey, refreshKey]);

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

  const chips = [
    chip('search', 'Search', search, `“${search}”`, () => f.set({ search: '' })),
    ...classSectionChips(cls, f.values, f.set),
    chip('status', 'Status', status, STATUS_FILTERS.find((o) => o.value === status)?.label, () => f.set({ status: 'all' }), status === 'all'),
  ];
  const filterText = describeFilters(chips);

  return (
    <section aria-labelledby={titleId} className="rounded-xl border border-line bg-surface">
      {/* Header + totals */}
      <div className="flex flex-wrap items-end justify-between gap-6 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 id={titleId} className="text-[15px] font-semibold text-slate-900 dark:text-white">
            Fee ledger
          </h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            {rows[0]?.academicYear ? `Academic year ${rows[0].academicYear.name}. ` : ''}
            {filterText ? (
              <>
                Totals for <span className="font-medium text-slate-700 dark:text-slate-300">{filterText}</span>.
              </>
            ) : (
              'Totals cover every student.'
            )}
          </p>
        </div>
        {meta && <Totals totals={meta.totals} students={meta.total} />}
      </div>

      {/* Filters */}
      <FilterBar
        bordered={false}
        search={<FilterSearch value={search} onChange={(v) => f.set({ search: v })} placeholder="Name or admission no." />}
        chips={chips}
        onClear={f.clear}
        extra={
          <div className="flex items-end gap-2">
            {loading && result && <LoaderCircle className="mb-2.5 h-4 w-4 animate-spin text-slate-400" aria-label="Updating" />}
            <SelectFilter label="Sort by" name="sort" value={sort} onChange={(v) => f.set({ sort: v })} options={SORT_OPTIONS} />
          </div>
        }
      >
        <ClassSectionFilter options={cls} classId={classId} sectionId={sectionId} onChange={f.set} />
        <StatusFilter label="Status" name="status" value={status} onChange={(v) => f.set({ status: v })} options={STATUS_FILTERS} />
      </FilterBar>

      {/* Table */}
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[920px] border-t border-line text-sm" aria-busy={loading}>
          <caption className="sr-only">Students with total fee, amount paid, amount pending and payment status</caption>
          <thead>
            <tr className="bg-surface-muted text-left text-13 font-medium text-slate-500 dark:text-slate-400">
              <th scope="col" className="px-5 py-2.5 font-medium">Student</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Class</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Total fee</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Paid</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Pending</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
              <th scope="col" className="px-5 py-2.5 text-right font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className={`divide-y divide-line ${loading && result ? 'opacity-60' : ''}`}>
            {!result && loading && <SkeletonRows />}

            {error && (
              <tr>
                <td colSpan={7} className="px-5 py-14 text-center">
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
                <td colSpan={7}>
                  {chips.some(Boolean) ? (
                    <FilteredEmpty what="students" chips={chips} onClear={f.clear} />
                  ) : (
                    <p className="px-5 py-14 text-center text-sm font-medium text-slate-900 dark:text-slate-100">No students with fees yet</p>
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
        <div className="flex items-center justify-between border-t border-line px-5 py-3 text-13 text-slate-500 dark:text-slate-400">
          <p className="tabular-nums">
            Showing {firstRow}–{lastRow} of {meta.total.toLocaleString('en-IN')} students
          </p>
          <div className="flex items-center gap-1">
            <PageButton label="Previous page" disabled={page <= 1 || loading} onClick={() => f.setPage(page - 1)}>
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </PageButton>
            <span className="px-2 tabular-nums">
              Page {meta.page} of {Math.max(meta.totalPages, 1)}
            </span>
            <PageButton label="Next page" disabled={page >= meta.totalPages || loading} onClick={() => f.setPage(page + 1)}>
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
          <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-slate-900 shadow-float dark:text-slate-100">
            <CircleCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
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
    <tr className="transition-colors hover:bg-slate-50/70 dark:hover:bg-white/[0.025]">
      <th scope="row" className="px-5 py-3 text-left font-normal">
        <span className="block font-medium text-slate-900 dark:text-slate-100">{row.studentName}</span>
        <span className="block text-xs tabular-nums text-slate-500 dark:text-slate-400">{row.admissionNumber}</span>
      </th>
      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{classLabel}</td>
      <td className="px-4 py-3 text-right tabular-nums text-slate-900 dark:text-slate-100">{formatInr(row.totalFee)}</td>
      <td className="px-4 py-3 text-right tabular-nums">
        <span className="block text-slate-900 dark:text-slate-100">{formatInr(row.paid)}</span>
        {total > 0 && (
          <span className="ml-auto mt-1.5 block h-1 w-20 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden>
            <span className="block h-full rounded-full bg-indigo-500 dark:bg-indigo-400" style={{ width: `${paidShare}%` }} />
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
        <span className={`inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-medium ${tag.chip}`}>
          <TagIcon className={`h-3.5 w-3.5 ${tag.iconClass}`} aria-hidden />
          {tag.label}
        </span>
      </td>
      <td className="px-5 py-3 text-right">
        {pending > 0 ? (
          <button
            type="button"
            onClick={onCollect}
            aria-label={`Collect fee from ${row.studentName}`}
            className={buttonClass({ variant: 'secondary', size: 'sm' })}
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

function Totals({ totals, students }: { totals: StudentFeeList['meta']['totals']; students: number }) {
  const total = toPaise(totals.totalFee);
  const paid = toPaise(totals.paid);
  const share = total > 0 ? (paid / total) * 100 : 0;
  return (
    <dl className="flex flex-wrap items-end gap-x-8 gap-y-3" data-fee-totals>
      <div>
        <dt className="text-13 text-slate-500 dark:text-slate-400">Students</dt>
        <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50" data-total="students">{students.toLocaleString('en-IN')}</dd>
      </div>
      <div>
        <dt className="text-13 text-slate-500 dark:text-slate-400">Total fee</dt>
        <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">{formatInr(totals.totalFee)}</dd>
      </div>
      <div>
        <dt className="text-13 text-slate-500 dark:text-slate-400">Collected</dt>
        <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50">
          {formatInr(totals.paid)}
          <span className="ml-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">{share.toFixed(1)}%</span>
        </dd>
      </div>
      <div>
        <dt className="text-13 text-slate-500 dark:text-slate-400">Pending</dt>
        <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-50" data-total="pending">{formatInr(totals.pending)}</dd>
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
      className="rounded-md border border-line p-1.5 text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
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
            <td key={j} className={j === 0 ? 'px-5 py-4' : 'px-4 py-4'}>
              <span className="block h-3.5 animate-pulse rounded bg-slate-200/70 dark:bg-white/[0.06]" style={{ width: `${w * 3}px` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
