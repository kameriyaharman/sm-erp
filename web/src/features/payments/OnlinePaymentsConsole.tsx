'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AlertTriangle, CalendarDays, CircleX, Download, FileText, IndianRupee, RefreshCw, Settings2, X } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Notice, Page, PageHeader, Pagination, SearchInput, Select, Spinner, Stat, Table, Td, Th, cx } from '@/components/ui';
import { qs, useApi } from '@/lib/useApi';
import { apiSend, openPdf } from '@/lib/session';
import { formatDateTime, formatInr } from '@/lib/format';
import { FilterBar, errorText, useDebounced } from '@/features/admin/shared';
import { CopyButton, ModeBadge, ORDER_STATUS_LABEL, OrderStatusBadge } from './bits';
import type { OnlinePaymentDetail, OnlinePaymentRow, OnlineStatus, OnlineSummary, ReconcileResult } from './types';

type Paged = { data: OnlinePaymentRow[]; meta: { page: number; limit: number; total: number; totalPages: number } };

const STATUSES: OnlineStatus[] = ['paid', 'created', 'failed', 'expired', 'needs_review'];

/**
 * Fees -> Online payments: every payment parents and students started online, with Razorpay ids,
 * the receipt it produced, and Reconcile for payments whose webhook never arrived.
 */
export default function OnlinePaymentsConsole() {
  const [status, setStatus] = useState<OnlineStatus | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useDebounced(search.trim(), 300);
  useEffect(() => setPage(1), [status, from, to, q]);

  const list = useApi<Paged>(`/finance/online-payments${qs({ status, from, to, search: q, page, limit: 25 })}`);
  const summary = useApi<{ data: OnlineSummary }>('/finance/online-payments/summary');
  const sm = summary.data?.data;
  const rows = list.data?.data ?? [];

  const refreshAll = () => {
    list.reload();
    summary.reload();
  };

  return (
    <Page wide>
      <PageHeader
        title="Online payments"
        description="Fees paid by parents and students from their portal through your Razorpay account."
        actions={
          <Link href="/settings/payments" className="inline-flex h-10 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3.5 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-white/5 sm:h-9">
            <Settings2 className="h-4 w-4" aria-hidden /> Payment settings
          </Link>
        }
      />

      {sm && !sm.gateway.enabled && (
        <div className="mb-5">
          <Notice tone="warn">
            Online payment is off, so parents are asked to pay at the school office.{' '}
            <Link href="/settings/payments" className="font-medium underline underline-offset-2">
              Connect Razorpay
            </Link>
          </Notice>
        </div>
      )}
      {sm?.gateway.enabled && sm.gateway.mode === 'test' && (
        <div className="mb-5">
          <Notice tone="info">Test mode: payments use Razorpay test cards and UPI. No real money moves until you switch to Live keys.</Notice>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Collected today" icon={<IndianRupee aria-hidden />} value={sm ? formatInr(sm.today.amount) : '…'} hint={sm ? `${sm.today.count} payment${sm.today.count === 1 ? '' : 's'}` : undefined} tone={sm && Number(sm.today.amount) > 0 ? 'good' : 'default'} />
        <Stat label="This month" icon={<CalendarDays aria-hidden />} value={sm ? formatInr(sm.month.amount) : '…'} hint={sm ? `${sm.month.count} payment${sm.month.count === 1 ? '' : 's'}` : undefined} />
        <StatButton active={status === 'failed'} onClick={() => setStatus(status === 'failed' ? '' : 'failed')}>
          <Stat label="Failed this month" icon={<CircleX aria-hidden />} value={sm ? sm.failedThisMonth : '…'} hint="Payer can try again" tone={sm && sm.failedThisMonth > 0 ? 'bad' : 'default'} />
        </StatButton>
        <StatButton active={status === 'needs_review'} onClick={() => setStatus(status === 'needs_review' ? '' : 'needs_review')}>
          <Stat label="Needs review" icon={<AlertTriangle aria-hidden />} value={sm ? sm.needsReview : '…'} hint={sm?.inProgress ? `${sm.inProgress} in progress` : 'Refunds or adjustments'} tone={sm && sm.needsReview > 0 ? 'warn' : 'default'} />
        </StatButton>
      </div>

      <Card padded={false}>
        <FilterBar>
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as OnlineStatus | '')}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          <Input label="From" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          <Input label="To" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          <SearchInput label="Search" showLabel placeholder="Student, admission no., Razorpay id, receipt" value={search} onChange={(e) => setSearch(e.target.value)} containerClassName="sm:!min-w-[18rem]" />
        </FilterBar>

        {list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : list.loading && !list.data ? (
          <Spinner skeleton label="Loading payments" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<IndianRupee aria-hidden />}
            title={status || from || to || q ? 'No payments match these filters' : 'No online payments yet'}
            description={status || from || to || q ? 'Clear a filter to see more.' : 'When a parent or student presses "Pay now" in their portal, the payment shows up here.'}
          />
        ) : (
          <>
            {/* Phones: one card per payment */}
            <ul className="divide-y divide-line sm:hidden">
              {rows.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setOpenId(r.id)} className="flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-900 dark:text-white">{r.student.name}</span>
                      <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                        {r.student.admissionNumber} · {r.student.classLabel} · {formatDateTime(r.createdAt)}
                      </span>
                      <span className="mt-1.5 flex flex-wrap gap-1.5">
                        <OrderStatusBadge status={r.status} />
                        {r.isDemo && <Badge>Sample</Badge>}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-sm font-semibold tabular-nums">{formatInr(r.amount)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {/* Tablets and up */}
            <Table className="hidden sm:block">
              <thead>
                <tr>
                  <Th>Started</Th>
                  <Th>Student</Th>
                  <Th align="right">Amount</Th>
                  <Th>Status</Th>
                  <Th className="hidden lg:table-cell">Razorpay</Th>
                  <Th>Receipt</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer" onClick={() => setOpenId(r.id)}>
                    <Td className="whitespace-nowrap text-13 text-slate-600 dark:text-slate-300">{formatDateTime(r.createdAt)}</Td>
                    <Td>
                      <button type="button" className="text-left font-medium text-slate-900 hover:text-indigo-700 dark:text-white dark:hover:text-indigo-300" onClick={() => setOpenId(r.id)}>
                        {r.student.name}
                      </button>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">
                        {r.student.admissionNumber} · {r.student.classLabel}
                      </span>
                    </Td>
                    <Td align="right" className="font-medium">
                      {formatInr(r.amount)}
                    </Td>
                    <Td>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <OrderStatusBadge status={r.status} />
                        {r.mode === 'test' && !r.isDemo && <Badge tone="amber">Test</Badge>}
                        {r.isDemo && <Badge>Sample</Badge>}
                      </span>
                      {r.reason && <span className="mt-1 block max-w-[22rem] truncate text-xs text-slate-500 dark:text-slate-400" title={r.reason}>{r.reason}</span>}
                    </Td>
                    <Td className="hidden font-mono text-xs text-slate-500 dark:text-slate-400 lg:table-cell">
                      <span className="block">{r.gatewayOrderId}</span>
                      {r.gatewayPaymentId && <span className="block">{r.gatewayPaymentId}</span>}
                    </Td>
                    <Td>
                      {r.receipt ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<Download aria-hidden />}
                          onClick={(e) => {
                            e.stopPropagation();
                            openPdf(`/finance/receipts/${r.receipt!.id}/pdf`, `${r.receipt!.number.replace(/\//g, '-')}.pdf`).catch(() => undefined);
                          }}
                        >
                          {r.receipt.number}
                        </Button>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} totalPages={list.data?.meta.totalPages ?? 1} onChange={setPage} />
          </>
        )}
      </Card>

      {openId && <PaymentDrawer id={openId} onClose={() => setOpenId(null)} onChanged={refreshAll} />}
    </Page>
  );
}

function StatButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={cx('h-full rounded-xl text-left transition-shadow [&>div]:h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500', active && 'ring-2 ring-indigo-500')}>
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ detail drawer

const OUTCOME: Record<string, string> = {
  processed: 'Payment captured, receipt created',
  already_paid: 'Repeat notice (already settled)',
  payment_failed: 'Payment attempt failed',
  needs_review: 'Needs review',
  ignored: 'Ignored',
  unknown_order: 'Unknown order',
  duplicate: 'Duplicate',
};

function PaymentDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data, error, loading, reload, setData } = useApi<{ data: OnlinePaymentDetail }>(`/finance/online-payments/${id}`);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'success' | 'info' | 'error' | 'warn'; text: string } | null>(null);
  const d = data?.data;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  async function reconcile() {
    setBusy(true);
    setResult(null);
    try {
      const r = await apiSend<{ data: ReconcileResult }>('POST', `/finance/online-payments/${id}/reconcile`);
      setData({ data: r.data.order });
      setResult({ tone: r.data.outcome === 'settled' ? 'success' : r.data.outcome === 'needs_review' ? 'warn' : 'info', text: r.data.message });
      onChanged();
    } catch (err) {
      setResult({ tone: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink-950/45 animate-fade-in" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside role="dialog" aria-modal="true" aria-label="Payment details" className="flex h-full w-full max-w-xl flex-col border-l border-line bg-surface shadow-pop">
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <p className="text-13 text-slate-500 dark:text-slate-400">Online payment</p>
            <h2 className="truncate text-lg font-semibold text-slate-900 dark:text-white">{d ? `${formatInr(d.amount)} · ${d.student.name}` : 'Loading…'}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/5 dark:hover:text-slate-200">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : loading && !d ? (
            <Spinner label="Loading" />
          ) : d ? (
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap items-center gap-2">
                <OrderStatusBadge status={d.status} />
                <ModeBadge mode={d.mode} />
                {d.isDemo && <Badge>Sample record (demo school)</Badge>}
              </div>
              {result && <Notice tone={result.tone}>{result.text}</Notice>}
              {d.status === 'needs_review' && d.reviewReason && <Notice tone="warn">{d.reviewReason}</Notice>}
              {d.status === 'failed' && d.failureReason && <Notice tone="error">{d.failureReason}</Notice>}
              {d.status === 'created' && <Notice tone="info">The payer has Razorpay Checkout open (or closed it without paying). It expires {formatDateTime(d.expiresAt)}.</Notice>}
              {d.status === 'expired' && !d.isDemo && <Notice tone="info">Checkout was closed without a payment. If the parent says money was taken, press Reconcile.</Notice>}

              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <Item label="Student" value={`${d.student.name} (${d.student.admissionNumber})`} />
                <Item label="Class" value={d.student.classLabel || '-'} />
                <Item label="Started" value={formatDateTime(d.createdAt)} />
                <Item label="Paid" value={d.paidAt ? formatDateTime(d.paidAt) : '-'} />
                <Item label="Started by" value={d.paidBy ? `${d.paidBy.name} (${d.paidBy.role === 'student' ? 'student' : d.paidBy.role === 'parent' ? 'parent' : 'office'})` : '-'} />
                <Item label="Branch" value={d.branch.name} />
                <Item label="Razorpay order" value={<IdValue value={d.gatewayOrderId} />} />
                <Item label="Razorpay payment" value={d.gatewayPaymentId ? <IdValue value={d.gatewayPaymentId} /> : '-'} />
              </dl>

              <section>
                <h3 className="mb-2 text-13 font-medium text-slate-500 dark:text-slate-400">Bills in this payment</h3>
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {d.items.map((it) => (
                    <li key={it.invoiceId} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{it.periodLabel ?? it.invoiceNumber}</span>
                        <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                          {it.invoiceNumber} · now {it.invoiceStatus.replace('_', ' ')}
                          {Number(it.invoiceBalance) > 0 ? `, ${formatInr(it.invoiceBalance)} left` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 font-medium tabular-nums">{formatInr(it.amount)}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <h3 className="mb-2 text-13 font-medium text-slate-500 dark:text-slate-400">What Razorpay told us</h3>
                {d.events.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">Nothing yet.{!d.isDemo && d.status !== 'paid' ? ' If the webhook is missing, Reconcile asks Razorpay directly.' : ''}</p>
                ) : (
                  <ol className="relative ml-1.5 border-l border-line">
                    {d.events.map((e, i) => (
                      <li key={i} className="mb-3 ml-4 last:mb-0">
                        <span className={cx('absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full', e.outcome === 'processed' ? 'bg-emerald-500' : e.outcome === 'payment_failed' ? 'bg-red-500' : e.outcome === 'needs_review' ? 'bg-amber-500' : 'bg-slate-300 dark:bg-slate-600')} aria-hidden />
                        <p className="text-sm font-medium text-slate-900 dark:text-white">
                          {OUTCOME[e.outcome] ?? e.outcome}
                          <span className="ml-1.5 text-xs font-normal text-slate-500 dark:text-slate-400">
                            {e.source === 'reconcile' ? 'via Reconcile' : e.type}
                            {e.method ? ` · ${e.method}` : ''}
                          </span>
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {formatDateTime(e.at)}
                          {e.detail ? ` · ${e.detail}` : ''}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          ) : null}
        </div>

        {d && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-surface-muted/60 px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
            {d.receipt && (
              <Button variant="secondary" icon={<FileText aria-hidden />} onClick={() => openPdf(`/finance/receipts/${d.receipt!.id}/pdf`, `${d.receipt!.number.replace(/\//g, '-')}.pdf`).catch((err) => setResult({ tone: 'error', text: errorText(err) }))}>
                Receipt {d.receipt.number}
              </Button>
            )}
            {d.canReconcile && (
              <Button loading={busy} icon={<RefreshCw aria-hidden />} onClick={reconcile}>
                Reconcile with Razorpay
              </Button>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-13 text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-0.5 break-words">{value}</dd>
    </div>
  );
}

function IdValue({ value }: { value: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="min-w-0 break-all font-mono text-xs">{value}</span>
      <CopyButton text={value} label="Copy" variant="ghost" />
    </span>
  );
}
