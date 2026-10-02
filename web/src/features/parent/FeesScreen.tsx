'use client';

import { useState, type ReactNode } from 'react';
import { CalendarClock, CircleAlert, CircleCheck, Download, FileText, Info, LoaderCircle, ReceiptText, Wallet } from 'lucide-react';
import { useApi } from '@/lib/useApi';
import { API_BASE, getAccessToken, openPdf } from '@/lib/session';
import { payFees } from './razorpay-checkout';
import { ACCENT, EmptyBlock, ErrorBlock, Loading, PCard, SectionTitle, primaryBtn, secondaryBtn } from './ParentLayout';
import { PAYMENT_MODE, daysUntil, inr, shortDate, tsDate } from './format';
import type { ChildFees, ChildHome, FeeInvoice, UpcomingInstallment } from './types';

type Flash = { tone: 'success' | 'error' | 'info'; text: string } | null;

export default function FeesScreen({ home }: { home: ChildHome }) {
  const { data, error, loading, reload } = useApi<{ data: ChildFees }>(`/parent/children/${home.child.id}/fees`);
  const [flash, setFlash] = useState<Flash>(null);
  const [paying, setPaying] = useState<string | null>(null);

  if (error) return <ErrorBlock message={error} onRetry={reload} />;
  if (loading && !data) return <Loading label="Loading fees" />;
  if (!data) return null;
  const fees = data.data;

  const open = fees.invoices.filter((i) => i.status !== 'paid' && Number(i.balanceAmount) > 0);
  const paidBills = fees.invoices.filter((i) => !open.includes(i));
  const online = fees.onlinePayment.enabled;

  async function pay(invoices: FeeInvoice[], key: string) {
    setFlash(null);
    setPaying(key);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Your session has ended. Please sign in again.');
      const result = await payFees({ baseUrl: API_BASE, accessToken: token, invoiceIds: invoices.map((i) => i.id), themeColor: ACCENT });
      if (result.status === 'paid') {
        setFlash({ tone: 'success', text: `Payment received. Receipt ${result.receiptNumber} is ready below.` });
        reload();
      } else if (result.status === 'processing') {
        setFlash({ tone: 'info', text: 'Payment done. The school is confirming it; your receipt will appear here in a few minutes.' });
      } else if (result.status === 'needs_review') {
        setFlash({ tone: 'info', text: 'Payment received but needs a check by the school office. They will confirm or refund it.' });
      } else if (result.status === 'failed') {
        setFlash({ tone: 'error', text: result.reason });
      }
    } catch (e) {
      setFlash({ tone: 'error', text: (e as Error).message });
    } finally {
      setPaying(null);
    }
  }

  async function downloadReceipt(id: string, number: string) {
    setFlash(null);
    try {
      await openPdf(`/finance/receipts/${id}/pdf`, `${number.replace(/\//g, '-')}.pdf`);
    } catch (e) {
      setFlash({ tone: 'error', text: (e as Error).message });
    }
  }

  return (
    <>
      <Totals fees={fees} firstName={home.child.firstName} />

      {flash && (
        <p
          role={flash.tone === 'error' ? 'alert' : 'status'}
          className={[
            'rounded-xl px-4 py-3 text-sm',
            flash.tone === 'success' && 'bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200',
            flash.tone === 'error' && 'bg-red-50 text-red-900 dark:bg-red-500/10 dark:text-red-200',
            flash.tone === 'info' && 'bg-[#e3f1f2] text-[#0a4d56] dark:bg-[#0b6b78]/25 dark:text-[#bfe6eb]',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {flash.text}
        </p>
      )}

      <section aria-labelledby="open-bills">
        <SectionTitle
          id="open-bills"
          icon={FileText}
          action={
            open.length > 1 && online ? (
              <button type="button" className={secondaryBtn} disabled={paying !== null} onClick={() => pay(open, 'all')}>
                {paying === 'all' && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
                Pay all {inr(open.reduce((s, i) => s + Number(i.balanceAmount), 0))}
              </button>
            ) : undefined
          }
        >
          Bills to pay
        </SectionTitle>
        {open.length === 0 ? (
          <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100">
            <CircleCheck className="h-5 w-5 shrink-0" aria-hidden />
            <p>
              No bills due right now.
              {fees.upcoming[0] && ` The next instalment is due on ${shortDate(fees.upcoming[0].dueDate)}.`}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {open.map((inv) => (
              <InvoiceCard key={inv.id} invoice={inv}>
                <div className="mt-4 flex flex-col gap-2">
                  <button type="button" className={`${primaryBtn} w-full`} disabled={!online || paying !== null} onClick={() => pay([inv], inv.id)}>
                    {paying === inv.id && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
                    Pay {inr(inv.balanceAmount)} now
                  </button>
                  {!online && <p className="text-center text-xs text-stone-500 dark:text-stone-400">Online payment is not enabled by the school yet — pay at the school office.</p>}
                </div>
              </InvoiceCard>
            ))}
          </ul>
        )}
      </section>

      {fees.upcoming.length > 0 && <Upcoming items={fees.upcoming} />}

      <section aria-labelledby="receipts">
        <SectionTitle id="receipts" icon={ReceiptText}>
          Receipts
        </SectionTitle>
        {fees.receipts.length === 0 ? (
          <EmptyBlock icon={ReceiptText} title="No payments yet" description="Receipts for fees you pay will appear here." />
        ) : (
          <PCard as="div">
            <ul>
              {fees.receipts.map((r, i) => (
                <li key={r.id} className={`flex items-center gap-3 px-4 py-3 ${i ? 'border-t border-stone-100 dark:border-stone-800' : ''}`}>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" aria-hidden>
                    <CircleCheck className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold tabular-nums">{inr(r.amount)}</span>
                    <span className="block truncate text-xs text-stone-500 dark:text-stone-400">
                      {tsDate(r.receivedAt)} · {PAYMENT_MODE[r.paymentMode] ?? r.paymentMode} · {r.receiptNumber}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => downloadReceipt(r.id, r.receiptNumber)}
                    aria-label={`Download receipt ${r.receiptNumber}`}
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold text-[#0b6b78] hover:bg-[#e3f1f2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b78] dark:text-[#7dd0da] dark:hover:bg-[#0b6b78]/20"
                  >
                    <Download className="h-4 w-4" aria-hidden />
                    Receipt
                  </button>
                </li>
              ))}
            </ul>
          </PCard>
        )}
      </section>

      {paidBills.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl px-1 py-2 text-sm font-semibold text-stone-600 marker:hidden dark:text-stone-300">
            Paid bills ({paidBills.length})
            <span className="text-[#0b6b78] group-open:hidden dark:text-[#7dd0da]">Show</span>
            <span className="hidden text-[#0b6b78] group-open:inline dark:text-[#7dd0da]">Hide</span>
          </summary>
          <ul className="mt-2 flex flex-col gap-3">
            {paidBills.map((inv) => (
              <InvoiceCard key={inv.id} invoice={inv} />
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function Totals({ fees, firstName }: { fees: ChildFees; firstName: string }) {
  const { totalFee, paid, pending, overdue } = fees.totals;
  const pct = Number(totalFee) > 0 ? Math.min(100, Math.round((Number(paid) / Number(totalFee)) * 100)) : 0;
  const hasOverdue = Number(overdue) > 0;
  return (
    <PCard className="p-5" aria-label="Fee summary">
      <p className="text-sm text-stone-500 dark:text-stone-400">{firstName}&apos;s fees this year</p>
      <p className="mt-1 flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums tracking-tight">{inr(pending)}</span>
        <span className="text-sm text-stone-500 dark:text-stone-400">pending</span>
      </p>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Share of the year's fees paid">
        <div className="h-full rounded-full bg-[#0b6b78] dark:bg-[#5cc0cc]" style={{ width: `${pct}%` }} />
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-stone-50 px-2 py-2.5 dark:bg-stone-950/60">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">Paid</dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{inr(paid)}</dd>
        </div>
        <div className={`rounded-xl px-2 py-2.5 ${hasOverdue ? 'bg-red-50 dark:bg-red-500/10' : 'bg-stone-50 dark:bg-stone-950/60'}`}>
          <dt className="text-[11px] font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">Overdue</dt>
          <dd className={`mt-0.5 text-sm font-semibold tabular-nums ${hasOverdue ? 'text-red-700 dark:text-red-300' : ''}`}>{inr(overdue)}</dd>
        </div>
        <div className="rounded-xl bg-stone-50 px-2 py-2.5 dark:bg-stone-950/60">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">Year total</dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums">{inr(totalFee)}</dd>
        </div>
      </dl>
      {!fees.onlinePayment.enabled && Number(pending) > 0 && (
        <p className="mt-4 flex gap-2 rounded-xl bg-stone-100 px-3 py-2.5 text-xs leading-relaxed text-stone-600 dark:bg-stone-800/70 dark:text-stone-300">
          <Info className="mt-px h-4 w-4 shrink-0" aria-hidden />
          Online payment is not enabled by the school yet — pay at the school office. Your receipt will show up here.
        </p>
      )}
    </PCard>
  );
}

function InvoiceCard({ invoice: inv, children }: { invoice: FeeInvoice; children?: ReactNode }) {
  const paid = inv.status === 'paid';
  const d = daysUntil(inv.dueDate);
  const dueText = paid ? `Paid · due was ${shortDate(inv.dueDate)}` : inv.overdue ? `Overdue since ${shortDate(inv.dueDate)}` : d === 0 ? 'Due today' : `Due ${shortDate(inv.dueDate)}`;
  return (
    <PCard as="li" className={`p-4 ${inv.overdue ? 'border-red-300 ring-1 ring-red-200 dark:border-red-500/50 dark:ring-red-500/20' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold">{inv.periodLabel ?? 'Fee bill'}</p>
          <p className="truncate text-xs text-stone-500 dark:text-stone-400">{inv.invoiceNumber}</p>
        </div>
        <span
          className={[
            'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
            paid
              ? 'bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30'
              : inv.overdue
                ? 'bg-red-50 text-red-800 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30'
                : 'bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-400/10 dark:text-amber-200 dark:ring-amber-400/30',
          ].join(' ')}
        >
          {inv.overdue && <CircleAlert className="h-3 w-3" aria-hidden />}
          {dueText}
        </span>
      </div>
      <ul className="mt-3 flex flex-col gap-1.5 text-sm">
        {inv.items.map((item, i) => (
          <li key={i} className="flex justify-between gap-3 text-stone-600 dark:text-stone-300">
            <span className="min-w-0 truncate">{item.description || item.feeHead}</span>
            <span className="shrink-0 tabular-nums">{inr(item.amount)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex justify-between gap-3 border-t border-dashed border-stone-200 pt-3 text-sm dark:border-stone-700">
        <span className="text-stone-500 dark:text-stone-400">{paid ? 'Total paid' : Number(inv.paidAmount) > 0 ? `Balance (of ${inr(inv.netAmount)})` : 'Amount due'}</span>
        <span className="font-semibold tabular-nums">{inr(paid ? inv.netAmount : inv.balanceAmount)}</span>
      </div>
      {children}
    </PCard>
  );
}

function Upcoming({ items }: { items: UpcomingInstallment[] }) {
  // Instalments of several fee heads usually share a due date: show one row per date.
  const byDate = new Map<string, UpcomingInstallment[]>();
  for (const it of items) byDate.set(it.dueDate, [...(byDate.get(it.dueDate) ?? []), it]);
  const groups = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
  return (
    <section aria-labelledby="upcoming">
      <SectionTitle id="upcoming" icon={CalendarClock}>
        Upcoming instalments
      </SectionTitle>
      <ol className="flex flex-col gap-2.5">
        {groups.map(([date, list]) => {
          const total = list.reduce((s, i) => s + Number(i.netAmount), 0);
          const d = daysUntil(date);
          return (
            <PCard as="li" key={date} className="flex items-center gap-3 p-4">
              <span className="flex w-12 shrink-0 flex-col items-center rounded-xl bg-[#e3f1f2] py-1.5 text-[#0b6b78] dark:bg-[#0b6b78]/25 dark:text-[#7dd0da]" aria-hidden>
                <span className="text-lg font-bold leading-none tabular-nums">{date.slice(8, 10).replace(/^0/, '')}</span>
                <span className="text-[11px] font-semibold uppercase">{shortDate(date).split(' ')[1]}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold tabular-nums">{inr(total)}</span>
                <span className="block truncate text-xs text-stone-500 dark:text-stone-400">
                  {list.map((i) => `${i.feeHead} ${inr(i.netAmount)}`).join(' + ')}
                </span>
              </span>
              <span className="shrink-0 text-right text-xs text-stone-500 dark:text-stone-400">
                <span className="sr-only">Due {shortDate(date)}, </span>
                {d < 0 ? 'Due' : d === 0 ? 'Today' : d <= 30 ? `In ${d} day${d === 1 ? '' : 's'}` : `Instalment ${list[0].installmentNo}`}
              </span>
            </PCard>
          );
        })}
      </ol>
      <p className="mt-2 flex items-center gap-1.5 px-1 text-xs text-stone-500 dark:text-stone-400">
        <Wallet className="h-3.5 w-3.5" aria-hidden /> Bills are raised a few days before each due date.
      </p>
    </section>
  );
}
