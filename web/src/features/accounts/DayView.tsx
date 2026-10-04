'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Download, Printer, Trash2 } from 'lucide-react';
import { Button, Card, cx, EmptyState, ErrorState, Input, Select, Spinner, Stat, Table, Td, Th } from '@/components/ui';
import { formatInr } from '@/lib/format';
import { AccountIcon, AutoBadge, LockedHint } from './EntryModals';
import { categoryLabel, modeLabel, type Account, type DayBook, type LedgerEntry } from './types';
import { addDays, amountText, istDate, longDate, paise, timeOf } from './util';

export function AccountSelect({ accounts, value, onChange, label = 'Account' }: { accounts: Account[]; value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <Select label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">All accounts</option>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
          {a.isActive ? '' : ' (inactive)'}
        </option>
      ))}
    </Select>
  );
}

/** Clock time of an entry, only when it was recorded on its own date (a back-dated entry has no real time). */
export function entryTime(e: LedgerEntry): string {
  return istDate(e.postedAt) === e.date ? timeOf(e.postedAt) : '';
}

function Particulars({ e }: { e: LedgerEntry }) {
  const transfer = e.source === 'transfer';
  return (
    <div className="min-w-[14rem]">
      <p className="font-medium text-slate-900 dark:text-white">{e.description}</p>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        {e.party && !transfer && (
          <>
            {e.links.studentId ? (
              <Link href={`/students/${e.links.studentId}`} className="text-indigo-700 hover:underline dark:text-indigo-300">
                {e.party}
              </Link>
            ) : (
              <span>{e.party}</span>
            )}
            <span aria-hidden>·</span>
          </>
        )}
        {!transfer && (
          <>
            <span>{categoryLabel(e.category)}</span>
            <span aria-hidden>·</span>
          </>
        )}
        <span className="inline-flex items-center gap-1">
          <AccountIcon type={e.account.type} className="h-3 w-3" />
          {e.account.name}
        </span>
        <span aria-hidden>·</span>
        <span>{modeLabel(e.paymentMode)}</span>
        {e.reference && (
          <>
            <span aria-hidden>·</span>
            <span>Ref {e.reference}</span>
          </>
        )}
        <AutoBadge entry={e} />
      </p>
    </div>
  );
}

export default function DayView({
  date,
  onDate,
  accountId,
  onAccount,
  accounts,
  book,
  loading,
  error,
  reload,
  onDelete,
  onPrint,
  onExport,
  exporting,
}: {
  date: string;
  onDate: (d: string) => void;
  accountId: string;
  onAccount: (id: string) => void;
  accounts: Account[];
  book: DayBook | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  onDelete: (e: LedgerEntry) => void;
  onPrint: () => void;
  onExport: () => void;
  exporting: boolean;
}) {
  const today = book?.today ?? date;
  const isToday = date === today;
  const ins = book?.entries.filter((e) => e.direction === 'in').length ?? 0;
  const outs = (book?.entries.length ?? 0) - ins;

  return (
    <div className="space-y-5">
      <Card padded={false}>
        <div className="flex flex-wrap items-end gap-3 p-4">
          <div className="flex items-end gap-1.5">
            <Button variant="secondary" icon={<ChevronLeft aria-hidden />} aria-label="Previous day" onClick={() => onDate(addDays(date, -1))} />
            <Input label="Date" type="date" value={date} max={today} onChange={(e) => e.target.value && onDate(e.target.value)} className="w-[10.5rem]" />
            <Button variant="secondary" icon={<ChevronRight aria-hidden />} aria-label="Next day" disabled={date >= today} onClick={() => onDate(addDays(date, 1))} />
            {!isToday && (
              <Button variant="ghost" onClick={() => onDate(today)}>
                Today
              </Button>
            )}
          </div>
          <div className="min-w-[12rem] flex-1 sm:max-w-[16rem] sm:flex-none">
            <AccountSelect accounts={accounts} value={accountId} onChange={onAccount} />
          </div>
          <div className="flex w-full gap-2 sm:ml-auto sm:w-auto">
            <Button variant="secondary" icon={<Printer aria-hidden />} onClick={onPrint} disabled={!book} className="flex-1 sm:flex-none">
              Print
            </Button>
            <Button variant="secondary" icon={<Download aria-hidden />} onClick={onExport} loading={exporting} disabled={!book} className="flex-1 sm:flex-none">
              Export CSV
            </Button>
          </div>
        </div>
      </Card>

      {loading && !book ? (
        <Spinner label="Loading the day book…" />
      ) : error ? (
        <Card>
          <ErrorState message={error} onRetry={reload} />
        </Card>
      ) : book ? (
        <div className={cx('space-y-5', loading && 'opacity-60')}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Opening balance" value={formatInr(book.opening)} hint={`Start of ${isToday ? 'today' : 'the day'}`} />
            <Stat label="Money in" value={formatInr(book.totalIn)} tone="good" hint={`${ins} entr${ins === 1 ? 'y' : 'ies'}`} />
            <Stat label="Money out" value={formatInr(book.totalOut)} tone={paise(book.totalOut) > 0 ? 'bad' : 'default'} hint={`${outs} entr${outs === 1 ? 'y' : 'ies'}`} />
            <Stat label="Closing balance" value={formatInr(book.closing)} tone={paise(book.closing) < 0 ? 'bad' : 'default'} hint="Carried to the next day" />
          </div>

          {book.byAccount.length > 1 && (
            <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="Balances by account">
              {book.byAccount.map((a) => (
                <li key={a.account.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => onAccount(accountId === a.account.id ? '' : a.account.id)}
                    aria-pressed={accountId === a.account.id}
                    className={cx(
                      'flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-sm transition-colors',
                      accountId === a.account.id ? 'border-indigo-400 bg-indigo-50/60 dark:border-indigo-400/50 dark:bg-indigo-400/10' : 'border-line bg-surface hover:border-slate-300',
                    )}
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-300">
                      <AccountIcon type={a.account.type} />
                    </span>
                    <span>
                      <span className="block text-13 font-medium">{a.account.name}</span>
                      <span className="block text-xs tabular-nums text-slate-500 dark:text-slate-400">
                        {formatInr(a.opening)} → <span className={cx('font-medium', paise(a.closing) < 0 ? 'text-red-600' : 'text-slate-800 dark:text-slate-200')}>{formatInr(a.closing)}</span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <Card padded={false} title={longDate(book.date)} description={accountId ? `${accounts.find((a) => a.id === accountId)?.name ?? 'Account'} only` : 'All accounts'}>
            {book.entries.length === 0 ? (
              <EmptyState
                title="No money in or out on this day"
                description="Fee receipts, expenses and transfers for this date will appear here. The balance carries over unchanged."
              />
            ) : (
              <>
                {/* phones */}
                <ul className="divide-y divide-line sm:hidden">
                  <li className="flex justify-between px-4 py-2.5 text-13 text-slate-500 dark:text-slate-400">
                    <span>Opening balance</span>
                    <span className="tabular-nums">{formatInr(book.opening)}</span>
                  </li>
                  {book.entries.map((e) => (
                    <li key={e.id} className="flex gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {[entryTime(e), e.voucherNo].filter(Boolean).join(' · ')}
                        </p>
                        <p className="mt-0.5 text-sm font-medium">{e.description}</p>
                        <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                          {[e.source === 'transfer' ? null : e.party, e.account.name, modeLabel(e.paymentMode)].filter(Boolean).join(' · ')}
                        </p>
                        <div className="mt-1">
                          <AutoBadge entry={e} />
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={cx('text-sm font-semibold tabular-nums', e.direction === 'in' ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400')}>
                          {e.direction === 'in' ? '+' : '−'}
                          {formatInr(e.amount)}
                        </p>
                        <p className="text-xs tabular-nums text-slate-500 dark:text-slate-400">Bal {formatInr(e.balance ?? '0')}</p>
                        {e.canDelete ? (
                          <button type="button" onClick={() => onDelete(e)} className="mt-1 text-xs font-medium text-red-600 hover:underline" aria-label={`Delete ${e.description}`}>
                            Delete
                          </button>
                        ) : (
                          <span className="mt-1 inline-block">
                            <LockedHint />
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                  <li className="flex justify-between bg-surface-muted/60 px-4 py-3 text-sm font-semibold">
                    <span>Closing balance</span>
                    <span className="tabular-nums">{formatInr(book.closing)}</span>
                  </li>
                </ul>

                {/* tablets and up */}
                <div className="hidden sm:block">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Time</Th>
                        <Th>Voucher</Th>
                        <Th>Particulars</Th>
                        <Th align="right">In</Th>
                        <Th align="right">Out</Th>
                        <Th align="right">Balance</Th>
                        <Th align="right">
                          <span className="sr-only">Actions</span>
                        </Th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="bg-surface-muted/40">
                        <Td className="text-slate-500" />
                        <Td />
                        <Td className="font-medium text-slate-600 dark:text-slate-300">Opening balance (b/f)</Td>
                        <Td align="right" />
                        <Td align="right" />
                        <Td align="right" className="font-medium">
                          {amountText(book.opening)}
                        </Td>
                        <Td />
                      </tr>
                      {book.entries.map((e) => (
                        <tr key={e.id}>
                          <Td className="whitespace-nowrap text-slate-500 dark:text-slate-400">{entryTime(e) || '—'}</Td>
                          <Td className="whitespace-nowrap font-mono text-xs text-slate-600 dark:text-slate-300">{e.voucherNo}</Td>
                          <Td>
                            <Particulars e={e} />
                          </Td>
                          <Td align="right" className="whitespace-nowrap font-medium text-emerald-700 dark:text-emerald-400">
                            {e.direction === 'in' ? amountText(e.amount) : ''}
                          </Td>
                          <Td align="right" className="whitespace-nowrap font-medium text-red-700 dark:text-red-400">
                            {e.direction === 'out' ? amountText(e.amount) : ''}
                          </Td>
                          <Td align="right" className={cx('whitespace-nowrap', paise(e.balance) < 0 && 'text-red-600')}>
                            {amountText(e.balance)}
                          </Td>
                          <Td align="right">
                            {e.canDelete ? (
                              <button
                                type="button"
                                onClick={() => onDelete(e)}
                                aria-label={`Delete ${e.description}`}
                                className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                              >
                                <Trash2 className="h-4 w-4" aria-hidden />
                              </button>
                            ) : (
                              <LockedHint />
                            )}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-line-strong bg-surface-muted/60 font-semibold">
                        <td className="px-4 py-3 sm:pl-5" colSpan={3}>
                          Total · Closing balance (c/f)
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{amountText(book.totalIn)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-red-700 dark:text-red-400">{amountText(book.totalOut)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{amountText(book.closing)}</td>
                        <td className="sm:pr-5" />
                      </tr>
                    </tfoot>
                  </Table>
                </div>
              </>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ print

/** A proper day-book page: school header, vouchers, in / out / balance, totals, signatures. Shown only when printing. */
export function PrintDayBook({ book, accountName, printedBy }: { book: DayBook; accountName: string; printedBy: string }) {
  return (
    <PrintFrame branch={book.branch} title="Day Book" subtitle={longDate(book.date)} accountName={accountName} printedBy={printedBy}>
      <table className="print-table">
        <thead>
          <tr>
            <th style={{ width: '13%' }}>Voucher No.</th>
            <th>Particulars</th>
            <th style={{ width: '14%' }}>Account / Mode</th>
            <th className="num" style={{ width: '12%' }}>In (₹)</th>
            <th className="num" style={{ width: '12%' }}>Out (₹)</th>
            <th className="num" style={{ width: '13%' }}>Balance (₹)</th>
          </tr>
        </thead>
        <tbody>
          <tr className="sub">
            <td />
            <td>Opening balance b/f</td>
            <td />
            <td />
            <td />
            <td className="num">{amountText(book.opening)}</td>
          </tr>
          {book.entries.map((e) => (
            <tr key={e.id}>
              <td className="mono">{e.voucherNo}</td>
              <td>
                {e.description}
                {e.party && e.source !== 'transfer' ? <span className="muted"> — {e.party}</span> : null}
                <span className="muted"> ({e.source === 'transfer' ? 'Contra' : categoryLabel(e.category)})</span>
              </td>
              <td>
                {e.account.name}
                <span className="muted">
                  {' '}
                  · {modeLabel(e.paymentMode)}
                  {e.reference ? ` · Ref ${e.reference}` : ''}
                </span>
              </td>
              <td className="num">{e.direction === 'in' ? amountText(e.amount) : ''}</td>
              <td className="num">{e.direction === 'out' ? amountText(e.amount) : ''}</td>
              <td className="num">{amountText(e.balance)}</td>
            </tr>
          ))}
          {book.entries.length === 0 && (
            <tr>
              <td />
              <td className="muted">No transactions</td>
              <td />
              <td />
              <td />
              <td />
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td />
            <td>Total</td>
            <td />
            <td className="num">{amountText(book.totalIn)}</td>
            <td className="num">{amountText(book.totalOut)}</td>
            <td />
          </tr>
          <tr>
            <td />
            <td>Closing balance c/f</td>
            <td />
            <td />
            <td />
            <td className="num">{amountText(book.closing)}</td>
          </tr>
        </tfoot>
      </table>
      {book.byAccount.length > 1 && (
        <table className="print-table compact">
          <thead>
            <tr>
              <th>Account</th>
              <th className="num">Opening</th>
              <th className="num">In</th>
              <th className="num">Out</th>
              <th className="num">Closing</th>
            </tr>
          </thead>
          <tbody>
            {book.byAccount.map((a) => (
              <tr key={a.account.id}>
                <td>{a.account.name}</td>
                <td className="num">{amountText(a.opening)}</td>
                <td className="num">{amountText(a.in)}</td>
                <td className="num">{amountText(a.out)}</td>
                <td className="num">{amountText(a.closing)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </PrintFrame>
  );
}

export function PrintFrame({
  branch,
  title,
  subtitle,
  accountName,
  printedBy,
  children,
}: {
  branch: DayBook['branch'];
  title: string;
  subtitle: string;
  accountName: string;
  printedBy: string;
  children: ReactNode;
}) {
  const printedAt = new Date().toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  return (
    <div className="print-book hidden print:block">
      <style>{PRINT_CSS}</style>
      <header className="print-head">
        <h1>{branch.schoolName}</h1>
        <p>
          {branch.name}
          {branch.address ? ` · ${branch.address}` : ''}
          {branch.phone ? ` · ${branch.phone}` : ''}
        </p>
        <div className="print-title">
          <span>{title}</span>
          <span>{subtitle}</span>
          <span>{accountName}</span>
        </div>
      </header>
      {children}
      <footer className="print-sign">
        <div>Prepared by</div>
        <div>Checked by (Accountant)</div>
        <div>Principal</div>
      </footer>
      <p className="print-meta">
        Printed {printedAt} by {printedBy} · SM ERP
      </p>
    </div>
  );
}

const PRINT_CSS = `
@page { size: A4; margin: 12mm 11mm 14mm; }
@media print {
  html, body { background: #fff !important; }
  .print-book { color: #111; font-size: 10.5pt; line-height: 1.35; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .print-head { text-align: center; border-bottom: 2px solid #111; padding-bottom: 6pt; margin-bottom: 8pt; }
  .print-head h1 { font-size: 17pt; font-weight: 700; letter-spacing: .01em; margin: 0; }
  .print-head p { margin: 2pt 0 0; font-size: 9pt; color: #333; }
  .print-title { display: flex; justify-content: space-between; margin-top: 8pt; font-size: 10.5pt; font-weight: 600; text-transform: none; }
  .print-title span:first-child { text-transform: uppercase; letter-spacing: .12em; }
  .print-table { width: 100%; border-collapse: collapse; margin-bottom: 10pt; }
  .print-table th, .print-table td { border: 0.75pt solid #555; padding: 3pt 5pt; vertical-align: top; text-align: left; }
  .print-table th { background: #eef0f4; font-weight: 600; font-size: 9pt; }
  .print-table .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .print-table .mono { font-family: ui-monospace, Menlo, monospace; font-size: 8.5pt; white-space: nowrap; }
  .print-table .muted { color: #555; }
  .print-table tr.sub td { font-style: italic; }
  .print-table tfoot td { font-weight: 700; background: #f6f7f9; }
  .print-table tr { break-inside: avoid; }
  .print-table thead { display: table-header-group; }
  .print-table.compact { width: 70%; font-size: 9pt; }
  .print-sign { display: flex; justify-content: space-between; gap: 18pt; margin-top: 36pt; }
  .print-sign div { flex: 1; border-top: 0.75pt solid #111; padding-top: 3pt; text-align: center; font-size: 9pt; }
  .print-meta { margin-top: 10pt; font-size: 8pt; color: #666; text-align: right; }
}
`;
