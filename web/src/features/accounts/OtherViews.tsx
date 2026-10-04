'use client';

import { useState } from 'react';
import { CalendarRange, Download, Pencil, Plus, Printer } from 'lucide-react';
import { Badge, Button, Card, cx, EmptyState, ErrorState, Input, Spinner, Stat, Table, Td, Th } from '@/components/ui';
import { formatDate, formatInr, formatMonth } from '@/lib/format';
import { AccountSelect, PrintFrame } from './DayView';
import { AccountIcon } from './EntryModals';
import { categoryColor, categoryLabel, type Account, type AccountMovement, type DayBookRange, type MonthSummary } from './types';
import { addDays, amountText, monthStart, paise, shortDay } from './util';

// ------------------------------------------------------------------ range

function fyStart(iso: string) {
  const [y, m] = iso.split('-').map(Number);
  return `${m >= 4 ? y : y - 1}-04-01`;
}

export function RangeView({
  from,
  to,
  onRange,
  accountId,
  onAccount,
  accounts,
  data,
  loading,
  error,
  reload,
  today,
  onOpenDay,
  onPrint,
  onExport,
  exporting,
}: {
  from: string;
  to: string;
  onRange: (from: string, to: string) => void;
  accountId: string;
  onAccount: (id: string) => void;
  accounts: Account[];
  data: DayBookRange | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  today: string;
  onOpenDay: (d: string) => void;
  onPrint: () => void;
  onExport: () => void;
  exporting: boolean;
}) {
  const [showEmpty, setShowEmpty] = useState(false);
  const lastMonthEnd = addDays(monthStart(today), -1);
  const presets: Array<[string, string, string]> = [
    ['This month', monthStart(today), today],
    ['Last month', monthStart(lastMonthEnd), lastMonthEnd],
    ['This financial year', fyStart(today), today],
  ];
  const bad = from > to;
  const days = data ? data.days.filter((d) => showEmpty || d.entries > 0).slice().reverse() : [];

  return (
    <div className="space-y-5">
      <Card padded={false}>
        <div className="flex flex-wrap items-end gap-3 p-4">
          <Input label="From" type="date" value={from} max={to} onChange={(e) => e.target.value && onRange(e.target.value, to)} className="w-[10.5rem]" />
          <Input label="To" type="date" value={to} max={today} onChange={(e) => e.target.value && onRange(from, e.target.value)} className="w-[10.5rem]" error={bad ? 'Before “From”' : undefined} />
          <div className="min-w-[12rem] flex-1 sm:max-w-[16rem] sm:flex-none">
            <AccountSelect accounts={accounts} value={accountId} onChange={onAccount} />
          </div>
          <div className="flex w-full gap-2 sm:ml-auto sm:w-auto">
            <Button variant="secondary" icon={<Printer aria-hidden />} onClick={onPrint} disabled={!data} className="flex-1 sm:flex-none">
              Print
            </Button>
            <Button variant="secondary" icon={<Download aria-hidden />} onClick={onExport} loading={exporting} disabled={!data || bad} className="flex-1 sm:flex-none">
              Export CSV
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-line px-4 py-2.5">
          {presets.map(([label, f, t]) => (
            <button
              key={label}
              type="button"
              onClick={() => onRange(f, t)}
              className={cx(
                'h-7 rounded-full border px-3 text-xs font-medium transition-colors',
                from === f && to === t ? 'border-indigo-400 bg-indigo-50 text-indigo-800 dark:border-indigo-400/50 dark:bg-indigo-400/10 dark:text-indigo-200' : 'border-line text-slate-600 hover:border-slate-300 dark:text-slate-300',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </Card>

      {bad ? (
        <Card>
          <EmptyState title="Check the dates" description="“From” must be on or before “To”." />
        </Card>
      ) : loading && !data ? (
        <Spinner label="Adding up the days…" />
      ) : error ? (
        <Card>
          <ErrorState message={error} onRetry={reload} />
        </Card>
      ) : data ? (
        <div className={cx('space-y-5', loading && 'opacity-60')}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Opening balance" value={formatInr(data.opening)} hint={formatDate(data.from)} />
            <Stat label="Money in" value={formatInr(data.totalIn)} tone="good" />
            <Stat label="Money out" value={formatInr(data.totalOut)} tone="bad" />
            <Stat label="Closing balance" value={formatInr(data.closing)} hint={formatDate(data.to)} />
          </div>
          <Card
            padded={false}
            title="Day by day"
            description="Tap a day to open its day book"
            actions={
              <label className="flex items-center gap-2 text-13 text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} />
                Show days without entries
              </label>
            }
          >
            {days.length === 0 ? (
              <EmptyState icon={<CalendarRange aria-hidden />} title="No entries in this period" />
            ) : (
              <Table className="max-h-[70vh]">
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th align="right">Entries</Th>
                    <Th align="right">Opening</Th>
                    <Th align="right">In</Th>
                    <Th align="right">Out</Th>
                    <Th align="right">Closing</Th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.date} className="cursor-pointer" onClick={() => onOpenDay(d.date)}>
                      <Td className="whitespace-nowrap">
                        <button type="button" className="font-medium text-indigo-700 hover:underline dark:text-indigo-300" onClick={() => onOpenDay(d.date)}>
                          {shortDay(d.date)}
                        </button>
                      </Td>
                      <Td align="right" className="text-slate-500">
                        {d.entries || '—'}
                      </Td>
                      <Td align="right" className="whitespace-nowrap text-slate-500">
                        {amountText(d.opening)}
                      </Td>
                      <Td align="right" className="whitespace-nowrap text-emerald-700 dark:text-emerald-400">
                        {paise(d.in) ? amountText(d.in) : ''}
                      </Td>
                      <Td align="right" className="whitespace-nowrap text-red-700 dark:text-red-400">
                        {paise(d.out) ? amountText(d.out) : ''}
                      </Td>
                      <Td align="right" className="whitespace-nowrap font-medium">
                        {amountText(d.closing)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          <AccountMovementCard rows={data.byAccount} title="By account" />
        </div>
      ) : null}
    </div>
  );
}

export function PrintRange({ data, accountName, printedBy }: { data: DayBookRange; accountName: string; printedBy: string }) {
  return (
    <PrintFrame branch={data.branch} title="Day Book Summary" subtitle={`${formatDate(data.from)} to ${formatDate(data.to)}`} accountName={accountName} printedBy={printedBy}>
      <table className="print-table">
        <thead>
          <tr>
            <th>Date</th>
            <th className="num">Entries</th>
            <th className="num">Opening (₹)</th>
            <th className="num">In (₹)</th>
            <th className="num">Out (₹)</th>
            <th className="num">Closing (₹)</th>
          </tr>
        </thead>
        <tbody>
          {data.days
            .filter((d) => d.entries > 0)
            .map((d) => (
              <tr key={d.date}>
                <td>{shortDay(d.date)}</td>
                <td className="num">{d.entries}</td>
                <td className="num">{amountText(d.opening)}</td>
                <td className="num">{amountText(d.in)}</td>
                <td className="num">{amountText(d.out)}</td>
                <td className="num">{amountText(d.closing)}</td>
              </tr>
            ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            <td />
            <td className="num">{amountText(data.opening)}</td>
            <td className="num">{amountText(data.totalIn)}</td>
            <td className="num">{amountText(data.totalOut)}</td>
            <td className="num">{amountText(data.closing)}</td>
          </tr>
        </tfoot>
      </table>
    </PrintFrame>
  );
}

function AccountMovementCard({ rows, title }: { rows: AccountMovement[]; title: string }) {
  if (rows.length === 0) return null;
  const sum = (k: 'opening' | 'in' | 'out' | 'closing') => rows.reduce((n, r) => n + paise(r[k]), 0);
  return (
    <Card padded={false} title={title}>
      <Table>
        <thead>
          <tr>
            <Th>Account</Th>
            <Th align="right">Opening</Th>
            <Th align="right">In</Th>
            <Th align="right">Out</Th>
            <Th align="right">Closing</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.account.id}>
              <Td>
                <span className="flex items-center gap-2 whitespace-nowrap font-medium">
                  <AccountIcon type={r.account.type} className="h-4 w-4 text-slate-400" />
                  {r.account.name}
                  {!r.account.isActive && <Badge>Inactive</Badge>}
                </span>
              </Td>
              <Td align="right" className="whitespace-nowrap">{formatInr(r.opening)}</Td>
              <Td align="right" className="whitespace-nowrap text-emerald-700 dark:text-emerald-400">{formatInr(r.in)}</Td>
              <Td align="right" className="whitespace-nowrap text-red-700 dark:text-red-400">{formatInr(r.out)}</Td>
              <Td align="right" className="whitespace-nowrap font-semibold">{formatInr(r.closing)}</Td>
            </tr>
          ))}
        </tbody>
        {rows.length > 1 && (
          <tfoot>
            <tr className="border-t-2 border-line-strong font-semibold">
              <td className="px-4 py-3 sm:pl-5">Total</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatInr(sum('opening') / 100)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatInr(sum('in') / 100)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatInr(sum('out') / 100)}</td>
              <td className="px-4 py-3 text-right tabular-nums sm:pr-5">{formatInr(sum('closing') / 100)}</td>
            </tr>
          </tfoot>
        )}
      </Table>
    </Card>
  );
}

// ------------------------------------------------------------------ month summary

function CategoryBars({ rows, total, emptyText }: { rows: Array<{ category: string; amount: string }>; total: number; emptyText: string }) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">{emptyText}</p>;
  return (
    <ul className="space-y-3">
      {rows.map((c) => {
        const pct = total > 0 ? (paise(c.amount) / total) * 100 : 0;
        return (
          <li key={c.category}>
            <span className="mb-1 flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2">
                <span className={cx('h-2.5 w-2.5 rounded-sm', categoryColor(c.category))} aria-hidden />
                {categoryLabel(c.category)}
              </span>
              <span className="tabular-nums">
                {formatInr(c.amount)} <span className="text-xs text-slate-500">({pct.toFixed(0)}%)</span>
              </span>
            </span>
            <span className="block h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <span className={cx('block h-full rounded-full', categoryColor(c.category))} style={{ width: `${Math.max(Math.min(pct, 100), 1)}%` }} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function SummaryView({
  month,
  onMonth,
  today,
  data,
  loading,
  error,
  reload,
}: {
  month: string;
  onMonth: (m: string) => void;
  today: string;
  data: MonthSummary | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}) {
  const net = data ? paise(data.net) : 0;
  return (
    <div className="space-y-5">
      <Card padded={false}>
        <div className="flex flex-wrap items-end gap-3 p-4">
          <Input label="Month" type="month" value={month} max={today.slice(0, 7)} onChange={(e) => e.target.value && onMonth(e.target.value)} className="w-[12rem]" />
          <p className="pb-2 text-13 text-slate-500 dark:text-slate-400">Income vs expense for {formatMonth(month)}. Transfers between accounts are neither.</p>
        </div>
      </Card>
      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <Card>
          <ErrorState message={error} onRetry={reload} />
        </Card>
      ) : data ? (
        <div className={cx('space-y-5', loading && 'opacity-60')}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label="Income" value={formatInr(data.totalIncome)} tone="good" hint={paise(data.feeRefunds) ? `after ${formatInr(data.feeRefunds)} fee refunds` : undefined} />
            <Stat label="Expenses" value={formatInr(data.totalExpense)} tone="bad" />
            <Stat label={net >= 0 ? 'Surplus' : 'Deficit'} value={formatInr(Math.abs(net) / 100)} tone={net >= 0 ? 'good' : 'bad'} hint={paise(data.transfers) ? `${formatInr(data.transfers)} moved between accounts` : undefined} />
          </div>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card title="Income by category">
              <CategoryBars rows={data.income} total={paise(data.totalIncome)} emptyText="No income this month." />
            </Card>
            <Card title="Expenses by category">
              <CategoryBars rows={data.expense} total={paise(data.totalExpense)} emptyText="Nothing spent this month." />
            </Card>
          </div>
          <AccountMovementCard rows={data.byAccount} title={`Accounts in ${formatMonth(month)}`} />
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ accounts

export function AccountsView({
  accounts,
  totalBalance,
  loading,
  error,
  reload,
  onAdd,
  onEdit,
  onOpen,
}: {
  accounts: Account[];
  totalBalance: string | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  onAdd: () => void;
  onEdit: (a: Account) => void;
  onOpen: (a: Account) => void;
}) {
  if (loading && accounts.length === 0) return <Spinner />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Money held today: <span className="font-semibold tabular-nums text-slate-900 dark:text-white">{totalBalance ? formatInr(totalBalance) : '—'}</span>
        </p>
        <Button icon={<Plus aria-hidden />} onClick={onAdd}>
          Add account
        </Button>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {accounts.map((a) => (
          <li key={a.id} className={cx('flex flex-col rounded-xl border border-line bg-surface p-4', !a.isActive && 'opacity-70')}>
            <div className="flex items-start gap-3">
              <span className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', a.type === 'cash' ? 'bg-marigold-50 text-marigold-700 dark:bg-marigold-400/10 dark:text-marigold-300' : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-200')}>
                <AccountIcon type={a.type} className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{a.name}</p>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">{a.details || (a.type === 'cash' ? 'Cash' : a.type === 'upi' ? 'UPI / wallet' : 'Bank account')}</p>
              </div>
              <Button variant="ghost" size="sm" icon={<Pencil aria-hidden />} aria-label={`Edit ${a.name}`} onClick={() => onEdit(a)} />
            </div>
            <p className={cx('mt-4 text-2xl font-semibold tabular-nums tracking-tight', paise(a.balance) < 0 && 'text-red-600')}>{formatInr(a.balance ?? '0')}</p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Opened with {formatInr(a.openingBalance)} on {formatDate(a.openingDate)} · {a.entries ?? 0} entries
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {a.defaultFor && <Badge tone="indigo">Default for {a.defaultFor === 'cash' ? 'cash' : 'bank / UPI'}</Badge>}
              {!a.isActive && <Badge>Inactive</Badge>}
              <button type="button" onClick={() => onOpen(a)} className="ml-auto text-13 font-medium text-indigo-700 hover:underline dark:text-indigo-300">
                Day book →
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-13 text-slate-500 dark:text-slate-400">
        Fee receipts post to the default cash account (cash) or the default bank account (UPI, card, cheque, transfer, online). Expenses do the same unless you pick an account.
      </p>
    </div>
  );
}
