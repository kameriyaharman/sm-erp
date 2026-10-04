'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Download, ListFilter } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, Pagination, Spinner, Stat, cx } from '@/components/ui';
import {
  ClassSectionFilter,
  DateRangeFilter,
  FilterBar,
  FilterSearch,
  FilteredEmpty,
  ResultCount,
  SelectFilter,
  StatusFilter,
  ToggleFilter,
  chip,
  classSectionChips,
  describeRange,
  useClassOptions,
  useUrlFilters,
} from '@/components/filters';
import { formatDate, formatInr } from '@/lib/format';
import { qs, useApi } from '@/lib/useApi';
import { AutoBadge } from './EntryModals';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, categoryLabel, modeLabel, type Account, type LedgerEntry } from './types';
import { downloadFile } from './util';
import { presetRange } from '@/lib/filters-core';

interface LedgerPage {
  data: Array<LedgerEntry & { student?: { id: string; name: string; admissionNumber: string; classLabel: string | null } | null }>;
  meta: { page: number; limit: number; total: number; totalPages: number; totalIn: string; totalOut: string };
}

const DIRECTIONS = [
  { value: '', label: 'All' },
  { value: 'in', label: 'Money in' },
  { value: 'out', label: 'Money out' },
];
const MODES = ['cash', 'upi', 'card', 'bank_transfer', 'cheque', 'demand_draft', 'net_banking', 'online'];

/**
 * Day book → Entries: every entry with the same filters as GET /ledger (account, in / out,
 * category, payment mode, class / section of the student for fee entries, dates, search),
 * totals for the filtered set and a CSV of exactly what is shown.
 * /accounts?tab=entries&accountId=…&direction=in&category=fees&classId=…&from=…&to=…&search=…
 */
export default function EntriesView({ accounts, today, onError }: { accounts: Account[]; today: string; onError: (text: string) => void }) {
  // Default: this month (the same range as the "This month" preset).
  const month = presetRange('month', today);
  const f = useUrlFilters(
    { search: '', accountId: '', direction: '', category: '', paymentMode: '', classId: '', sectionId: '', from: month.from, to: month.to, deleted: '' },
    { ignoreInCount: [] },
  );
  const { search, accountId, direction, category, paymentMode, classId, sectionId, from, to } = f.values;
  const includeDeleted = f.values.deleted === '1';
  const cls = useClassOptions();
  const [exporting, setExporting] = useState(false);
  const bad = Boolean(from && to && from > to);
  const query = { search, accountId, direction, category, paymentMode, classId, sectionId, from, to, includeDeleted: includeDeleted ? 'true' : '' };
  const res = useApi<LedgerPage>(bad ? null : `/ledger${qs({ ...query, page: f.page, limit: 50 })}`);
  const rows = res.data?.data ?? [];
  const meta = res.data?.meta;

  const categories = direction === 'in' ? INCOME_CATEGORIES : direction === 'out' ? EXPENSE_CATEGORIES : [...new Set<string>([...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES])];
  const chips = [
    chip('search', 'Search', search, `“${search}”`, () => f.set({ search: '' })),
    chip('accountId', 'Account', accountId, accounts.find((a) => a.id === accountId)?.name, () => f.set({ accountId: '' })),
    chip('direction', 'Showing', direction, direction === 'in' ? 'Money in' : 'Money out', () => f.set({ direction: '' })),
    chip('category', 'Category', category, categoryLabel(category), () => f.set({ category: '' })),
    chip('paymentMode', 'Mode', paymentMode, modeLabel(paymentMode), () => f.set({ paymentMode: '' })),
    ...classSectionChips(cls, f.values, f.set),
    (from !== month.from || to !== month.to) && { key: 'date', label: `Dates: ${from || to ? describeRange(from, to, today) : 'Any time'}`, onRemove: () => f.set({ from: month.from, to: month.to }) },
    includeDeleted && { key: 'deleted', label: 'Including deleted', onRemove: () => f.set({ deleted: '' }) },
  ];

  async function exportCsv() {
    setExporting(true);
    try {
      await downloadFile(`/ledger/entries.csv${qs(query)}`, `entries-${from || 'start'}-to-${to || today}.csv`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-5">
      {meta && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-entry-totals>
          <Stat label="Entries" value={meta.total.toLocaleString('en-IN')} hint={from || to ? describeRange(from, to, today) : 'Any time'} />
          <Stat label="Money in" value={formatInr(meta.totalIn)} tone="good" />
          <Stat label="Money out" value={formatInr(meta.totalOut)} tone={Number(meta.totalOut) > 0 ? 'bad' : 'default'} />
          <Stat label="Net" value={formatInr((Number(meta.totalIn) - Number(meta.totalOut)).toFixed(2))} hint="In minus out, these entries" />
        </div>
      )}
      <Card padded={false}>
        <FilterBar
          search={<FilterSearch value={search} onChange={(v) => f.set({ search: v })} placeholder="Party, particulars, voucher or reference" />}
          chips={chips}
          onClear={f.clear}
          extra={
            <div className="flex items-end gap-3">
              {meta && <ResultCount total={meta.total} noun={['entry', 'entries']} filtered={f.active > 0} />}
              <Button variant="secondary" icon={<Download aria-hidden />} onClick={exportCsv} loading={exporting} disabled={!meta || meta.total === 0}>
                Export CSV
              </Button>
            </div>
          }
        >
          <SelectFilter
            label="Account"
            name="accountId"
            value={accountId}
            allLabel="All accounts"
            options={accounts.map((a) => ({ value: a.id, label: `${a.name}${a.isActive ? '' : ' (inactive)'}` }))}
            onChange={(v) => f.set({ accountId: v })}
          />
          <StatusFilter label="Direction" name="direction" value={direction} options={DIRECTIONS} onChange={(v) => f.set({ direction: v, category: '' })} />
          <SelectFilter label="Category" name="category" value={category} allLabel="All categories" options={categories.map((c) => ({ value: c, label: categoryLabel(c) }))} onChange={(v) => f.set({ category: v })} />
          <SelectFilter label="Payment mode" name="paymentMode" value={paymentMode} allLabel="Any mode" options={MODES.map((m) => ({ value: m, label: modeLabel(m) }))} onChange={(v) => f.set({ paymentMode: v })} />
          <ClassSectionFilter options={cls} classId={classId} sectionId={sectionId} allClassesLabel="Any class" onChange={f.set} />
          <DateRangeFilter label="Dates" from={from} to={to} today={today} max={today} onChange={(r) => f.set(r)} />
          <ToggleFilter label="Show deleted" name="deleted" checked={includeDeleted} onChange={(on) => f.set({ deleted: on ? '1' : '' })} />
        </FilterBar>
        {(classId || sectionId) && (
          <p className="border-b border-line px-4 py-2 text-xs text-slate-500 dark:text-slate-400 sm:px-5">
            <ListFilter className="mr-1 inline h-3.5 w-3.5" aria-hidden />
            A class filter shows fee receipts and refunds of students now in that class; other income and expenses have no class.
          </p>
        )}

        {bad ? (
          <EmptyState title="Check the dates" description="“From” must be on or before “To”." />
        ) : res.error ? (
          <ErrorState message={res.error} onRetry={res.reload} />
        ) : !res.data ? (
          <Spinner label="Loading entries…" />
        ) : rows.length === 0 ? (
          f.active > 0 ? <FilteredEmpty what="entries" chips={chips} onClear={f.clear} /> : <EmptyState title="No entries this month" description="Fee receipts, expenses, income and transfers appear here as they are recorded." />
        ) : (
          <>
            {/* phones */}
            <ul className="divide-y divide-line sm:hidden">
              {rows.map((e) => (
                <li key={e.id} className={cx('flex gap-3 px-4 py-3', e.deleted && 'opacity-60')} data-entry={e.id}>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-slate-500 dark:text-slate-400">{[formatDate(e.date), e.voucherNo].filter(Boolean).join(' · ')}</p>
                    <p className="mt-0.5 text-sm font-medium">{e.description}</p>
                    <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                      {[e.student ? `${e.student.name}${e.student.classLabel ? `, ${e.student.classLabel}` : ''}` : e.party, categoryLabel(e.category), e.account.name, modeLabel(e.paymentMode)].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <p className={cx('shrink-0 text-sm font-semibold tabular-nums', e.direction === 'in' ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400')}>
                    {e.direction === 'in' ? '+' : '−'}
                    {formatInr(e.amount)}
                  </p>
                </li>
              ))}
            </ul>
            {/* tablets and up */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[56rem] text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-muted text-left text-13 text-slate-500 dark:text-slate-400">
                    <th scope="col" className="px-4 py-2.5 font-medium sm:pl-5">Date</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Particulars</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Account</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Category</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">In</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium sm:pr-5">Out</th>
                  </tr>
                </thead>
                <tbody className={cx('divide-y divide-line', res.loading && 'opacity-60')}>
                  {rows.map((e) => (
                    <tr key={e.id} className={cx(e.deleted && 'opacity-60')} data-entry={e.id}>
                      <td className="whitespace-nowrap px-4 py-2.5 align-top sm:pl-5">
                        {formatDate(e.date)}
                        <span className="block font-mono text-xs text-slate-500 dark:text-slate-400">{e.voucherNo}</span>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <p className="font-medium">
                          {e.description} {e.deleted && <Badge tone="red">Deleted</Badge>}
                        </p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500 dark:text-slate-400">
                          {e.student ? (
                            <Link href={`/students/${e.student.id}`} className="text-indigo-700 hover:underline dark:text-indigo-300" data-col="student">
                              {e.student.name}
                              {e.student.classLabel ? ` · ${e.student.classLabel}` : ''}
                            </Link>
                          ) : (
                            e.party && <span>{e.party}</span>
                          )}
                          <span>{modeLabel(e.paymentMode)}</span>
                          {e.reference && <span>Ref {e.reference}</span>}
                          <AutoBadge entry={e} />
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 align-top" data-col="account">{e.account.name}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 align-top" data-col="category">{categoryLabel(e.category)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right align-top font-medium tabular-nums text-emerald-700 dark:text-emerald-400" data-col="in">
                        {e.direction === 'in' ? formatInr(e.amount) : ''}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right align-top font-medium tabular-nums text-red-700 dark:text-red-400 sm:pr-5" data-col="out">
                        {e.direction === 'out' ? formatInr(e.amount) : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {meta && <Pagination page={meta.page} totalPages={meta.totalPages} onChange={f.setPage} />}
          </>
        )}
      </Card>
    </div>
  );
}
