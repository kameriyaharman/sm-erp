'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Ban, FileDown, FilePlus2, Globe, ReceiptText, TriangleAlert } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, Notice, Spinner, Table, Td, Textarea, Th, cx } from '@/components/ui';
import { apiSend, openPdf } from '@/lib/session';
import { formatDate, formatDateTime, formatInr, titleCase } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { errorText, fieldErrors } from '@/features/admin/shared';
import type { CancelReceiptResult, Invoice, ReceiptListItem, StudentDues, UnbilledAllocation } from './api';
import { fromPaise, toPaise } from './format';

/* ============================================================================
 * One student's fee account (Student profile → Fees, and "Receipts & bills" on Fee collection):
 *   open invoices · upcoming instalments with "Generate bill" · every receipt with
 *   "Cancel receipt" (cancelled receipts stay listed with a badge) and its PDF.
 * ========================================================================== */

const MODE_LABEL: Record<string, string> = {
  cash: 'Cash', upi: 'UPI', card: 'Card', cheque: 'Cheque', demand_draft: 'Demand draft', bank_transfer: 'Bank transfer',
  net_banking: 'Net banking', wallet: 'Wallet', other: 'Online',
};

type FlashFn = (tone: 'success' | 'error' | 'info' | 'warn', text: ReactNode) => void;

export default function StudentFeeAccount({
  studentId,
  studentName,
  canManage,
  reloadKey = 0,
  invoiceActions,
  onChanged,
  flash,
}: {
  studentId: string;
  studentName: string;
  /** Current student: bills can be generated. Receipts can always be cancelled by an admin. */
  canManage: boolean;
  /** Bump to reload (after Collect fee / Add charge elsewhere on the page). */
  reloadKey?: number;
  /** Extra buttons in the "Open invoices" header (Collect fee, Add charge …). */
  invoiceActions?: ReactNode;
  /** Something changed money-wise: the parent refreshes its totals. */
  onChanged?: () => void;
  flash: FlashFn;
}) {
  const { data, error, loading, reload } = useApi<{ data: StudentDues }>(`/fees/students/${studentId}/dues`);
  useEffect(() => {
    if (reloadKey > 0) reload();
  }, [reloadKey, reload]);
  const d = data?.data;

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [billOpen, setBillOpen] = useState(false);
  const [cancelling, setCancelling] = useState<ReceiptListItem | null>(null);

  // Drop selections that are no longer upcoming (billed elsewhere).
  useEffect(() => {
    if (!d) return;
    const ids = new Set(d.notYetInvoiced.allocations.map((a) => a.id));
    setPicked((p) => new Set([...p].filter((id) => ids.has(id))));
  }, [d]);

  const refresh = () => {
    reload();
    onChanged?.();
  };

  if (loading && !d) return <Spinner label="Loading fees…" />;
  if (error || !d) return <ErrorState message={error ?? 'Could not load fees'} onRetry={reload} />;

  const allocations = d.notYetInvoiced.allocations;
  const receipts = d.receipts ?? [];
  const selected = allocations.filter((a) => picked.has(a.id));

  return (
    <div className="space-y-6" data-fee-account>
      <Card title="Open invoices" padded={false} actions={invoiceActions}>
        {!d.openInvoices.length ? (
          <EmptyState title={allocations.length ? 'No bills due yet' : 'No open invoices'} description={allocations.length ? 'Upcoming instalments are listed below. Generate a bill to collect one early or let the parent pay it online.' : 'Nothing is due right now.'} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Invoice</Th>
                <Th>Period</Th>
                <Th>Due date</Th>
                <Th align="right">Amount</Th>
                <Th align="right">Paid</Th>
                <Th align="right">Balance</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {d.openInvoices.map((inv) => {
                const overdue = inv.dueDate < new Date().toISOString().slice(0, 10);
                return (
                  <tr key={inv.id} data-open-invoice={inv.invoiceNumber}>
                    <Td className="whitespace-nowrap font-medium tabular-nums">{inv.invoiceNumber}</Td>
                    <Td className="whitespace-nowrap">{inv.periodLabel ?? inv.feeHeads ?? '-'}</Td>
                    <Td className="whitespace-nowrap">{formatDate(inv.dueDate)}</Td>
                    <Td align="right">{formatInr(inv.netAmount)}</Td>
                    <Td align="right">{formatInr(inv.paidAmount)}</Td>
                    <Td align="right" className="font-semibold">
                      {formatInr(inv.balanceAmount)}
                    </Td>
                    <Td>
                      <Badge tone={overdue ? 'red' : inv.status === 'partially_paid' ? 'amber' : 'gray'}>{overdue ? 'Overdue' : titleCase(inv.status)}</Badge>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {allocations.length > 0 && (
        <Card
          title={`Upcoming instalments, ${formatInr(d.notYetInvoiced.amount)}`}
          description="Not billed yet. Generate a bill to collect early or so the parent can pay it online in advance."
          padded={false}
          actions={
            canManage ? (
              <Button
                size="sm"
                icon={<FilePlus2 className="h-3.5 w-3.5" aria-hidden />}
                disabled={selected.length === 0}
                onClick={() => setBillOpen(true)}
                data-generate-bill
              >
                {selected.length ? `Generate bill (${selected.length})` : 'Generate bill'}
              </Button>
            ) : undefined
          }
        >
          <UpcomingTable allocations={allocations} picked={picked} setPicked={setPicked} selectable={canManage} />
        </Card>
      )}

      <Card title="Receipts" description="Every payment, newest first. A cancelled receipt keeps its number and stays here." padded={false}>
        {receipts.length === 0 ? (
          <EmptyState icon={<ReceiptText className="h-7 w-7" aria-hidden />} title="No payments yet" description="Receipts appear here when fees are collected at the counter or paid online." />
        ) : (
          <ul className="divide-y divide-line" data-receipts>
            {receipts.map((r) => (
              <ReceiptRow key={r.id} r={r} onCancel={() => setCancelling(r)} onError={(m) => flash('error', m)} />
            ))}
          </ul>
        )}
      </Card>

      <GenerateBillModal
        open={billOpen}
        studentId={studentId}
        studentName={studentName}
        allocations={selected}
        onClose={() => setBillOpen(false)}
        onDone={(inv) => {
          setBillOpen(false);
          setPicked(new Set());
          flash('success', `Bill ${inv.invoiceNumber} of ${formatInr(inv.netAmount)} created for ${studentName}. It can now be collected or paid online.`);
          refresh();
        }}
      />
      <CancelReceiptModal
        receipt={cancelling}
        onClose={() => setCancelling(null)}
        onDone={(res) => {
          setCancelling(null);
          const inv = res.invoices.map((i) => `${i.invoiceNumber} is ${i.status === 'unpaid' ? 'unpaid' : titleCase(i.status).toLowerCase()} again`).join(', ');
          flash(
            res.onlineRefund ? 'warn' : 'success',
            <span data-cancel-flash>
              Receipt {res.receipt.receiptNumber} cancelled. {inv ? `${inv}.` : ''}
              {res.ledgerEntry ? ` Day book: ${formatInr(res.ledgerEntry.amount)} out of ${res.ledgerEntry.account} (${res.ledgerEntry.voucherNo}).` : ''}
              {res.onlineRefund ? <strong className="block pt-1">{res.onlineRefund.message}</strong> : null}
            </span>,
          );
          refresh();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------- upcoming

function UpcomingTable({
  allocations,
  picked,
  setPicked,
  selectable,
}: {
  allocations: UnbilledAllocation[];
  picked: Set<string>;
  setPicked: (fn: (p: Set<string>) => Set<string>) => void;
  selectable: boolean;
}) {
  const all = allocations.length > 0 && allocations.every((a) => picked.has(a.id));
  const toggle = (ids: string[], on: boolean) =>
    setPicked((p) => {
      const n = new Set(p);
      ids.forEach((id) => (on ? n.add(id) : n.delete(id)));
      return n;
    });
  return (
    <Table>
      <thead>
        <tr>
          {selectable && (
            <Th className="w-10">
              <input
                type="checkbox"
                aria-label="Select all upcoming instalments"
                checked={all}
                onChange={(e) => toggle(allocations.map((a) => a.id), e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
            </Th>
          )}
          <Th>Fee head</Th>
          <Th align="right">Instalment</Th>
          <Th>Due date</Th>
          <Th align="right">Amount</Th>
        </tr>
      </thead>
      <tbody>
        {allocations.map((a) => (
          <tr key={a.id} className={cx(picked.has(a.id) && 'bg-indigo-50/60 dark:bg-indigo-400/[0.06]')}>
            {selectable && (
              <Td className="w-10">
                <input
                  type="checkbox"
                  aria-label={`${a.feeHead}, instalment ${a.installmentNo}, due ${formatDate(a.dueDate)}`}
                  checked={picked.has(a.id)}
                  onChange={(e) => toggle([a.id], e.target.checked)}
                  data-allocation={`${a.installmentNo}:${a.feeHead}`}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
              </Td>
            )}
            <Td>{a.feeHead}</Td>
            <Td align="right">{a.installmentNo}</Td>
            <Td className="whitespace-nowrap">{formatDate(a.dueDate)}</Td>
            <Td align="right">{formatInr(a.netAmount)}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function instalmentLabel(list: UnbilledAllocation[]): string {
  const nos = [...new Set(list.map((a) => a.installmentNo))].sort((a, b) => a - b);
  if (nos.length === 0) return '';
  if (nos.length === 1) return `Instalment ${nos[0]}`;
  return nos.every((n, i) => i === 0 || n === nos[i - 1] + 1) ? `Instalments ${nos[0]}–${nos[nos.length - 1]}` : `Instalments ${nos.join(', ')}`;
}

function GenerateBillModal({
  open,
  studentId,
  studentName,
  allocations,
  onClose,
  onDone,
}: {
  open: boolean;
  studentId: string;
  studentName: string;
  allocations: UnbilledAllocation[];
  onClose: () => void;
  onDone: (inv: Invoice) => void;
}) {
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const total = allocations.reduce((s, a) => s + toPaise(a.netAmount), 0);
  const due = useMemo(() => [...allocations].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]?.dueDate, [allocations]);

  useEffect(() => {
    if (!open) return;
    setLabel(instalmentLabel(allocations));
    setError(null);
    setErrors({});
    // allocations are fixed while the dialog is open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await apiSend<{ data: Invoice }>('POST', '/fees/invoices', {
        studentId,
        allocationIds: allocations.map((a) => a.id),
        ...(label.trim() ? { periodLabel: label.trim().slice(0, 50) } : {}),
      });
      onDone(r.data);
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={`Generate a bill for ${studentName}`}
      description="Bills the selected instalments now, exactly as set in the class fees (concessions included)."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={allocations.length === 0} data-generate-confirm>
            Generate bill of {formatInr(fromPaise(total))}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ul className="divide-y divide-line rounded-lg border border-line text-sm">
          {allocations.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0">
                <span className="font-medium">{a.feeHead}</span>
                <span className="text-slate-500 dark:text-slate-400"> · instalment {a.installmentNo} · due {formatDate(a.dueDate)}</span>
              </span>
              <span className="shrink-0 tabular-nums">{formatInr(a.netAmount)}</span>
            </li>
          ))}
          <li className="flex items-center justify-between gap-3 bg-surface-muted/60 px-3 py-2 font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{formatInr(fromPaise(total))}</span>
          </li>
        </ul>
        <Input label="Period on the bill" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={50} placeholder="e.g. Q3 (Oct–Dec)" error={errors.periodLabel} />
        <p className="text-13 text-slate-500 dark:text-slate-400">
          Due {due ? formatDate(due) : '-'} (the earliest instalment). The bill shows in Fee collection and in the parent app, where it can be paid online.
        </p>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------- receipts

function ReceiptRow({ r, onCancel, onError }: { r: ReceiptListItem; onCancel: () => void; onError: (m: string) => void }) {
  const cancelled = r.status === 'cancelled';
  const [pdfBusy, setPdfBusy] = useState(false);
  const towards = r.appliedTo.map((a) => a.periodLabel || a.invoiceNumber).join(', ');
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5" data-receipt={r.receiptNumber} data-status={r.status}>
      <span
        className={cx(
          'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
          cancelled ? 'bg-red-50 text-red-600 dark:bg-red-400/10 dark:text-red-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300',
        )}
        aria-hidden
      >
        {cancelled ? <Ban className="h-[18px] w-[18px]" /> : <ReceiptText className="h-[18px] w-[18px]" />}
      </span>
      <div className="min-w-0 flex-1 basis-56">
        <p className="flex flex-wrap items-center gap-2">
          <span className={cx('text-[15px] font-semibold tabular-nums', cancelled && 'text-slate-400 line-through decoration-red-400/70 dark:text-slate-500')}>{formatInr(r.amount)}</span>
          {cancelled ? <Badge tone="red">Cancelled</Badge> : <Badge tone="green">Paid</Badge>}
          {r.online && (
            <Badge tone="indigo">
              <Globe className="h-3 w-3" aria-hidden /> Online
            </Badge>
          )}
        </p>
        <p className="mt-0.5 text-13 text-slate-500 dark:text-slate-400">
          <span className="font-medium tabular-nums text-slate-700 dark:text-slate-300">{r.receiptNumber}</span> · {formatDateTime(r.receivedAt)} · {MODE_LABEL[r.paymentMode] ?? r.paymentMode}
          {r.collectedBy ? ` · by ${r.collectedBy}` : ''}
        </p>
        {towards && <p className="mt-0.5 truncate text-13 text-slate-500 dark:text-slate-400">For {towards}</p>}
        {cancelled && (
          <p className="mt-1.5 rounded-md bg-red-50/80 px-2.5 py-1.5 text-13 text-red-900 dark:bg-red-400/10 dark:text-red-100" data-cancel-note>
            Cancelled {r.cancelledAt ? formatDateTime(r.cancelledAt) : ''}
            {r.cancelledBy ? ` by ${r.cancelledBy}` : ''}: “{r.cancelReason}”
            {r.online && <span className="block font-medium">Refund {formatInr(r.amount)} in the Razorpay Dashboard{r.gatewayPaymentId ? ` (${r.gatewayPaymentId})` : ''} if not done yet.</span>}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 pl-[52px] sm:pl-0">
        <Button
          size="sm"
          variant="secondary"
          loading={pdfBusy}
          icon={<FileDown className="h-3.5 w-3.5" aria-hidden />}
          aria-label={`Open receipt ${r.receiptNumber} as PDF`}
          onClick={async () => {
            setPdfBusy(true);
            try {
              await openPdf(`/finance/receipts/${r.id}/pdf`, `${r.receiptNumber.replace(/\//g, '-')}.pdf`);
            } catch (err) {
              onError(errorText(err));
            } finally {
              setPdfBusy(false);
            }
          }}
        >
          PDF
        </Button>
        {!cancelled && (
          <Button size="sm" variant="ghost" className="!text-red-700 hover:!bg-red-50 dark:!text-red-300 dark:hover:!bg-red-400/10" onClick={onCancel} data-cancel-receipt={r.receiptNumber}>
            Cancel receipt
          </Button>
        )}
      </div>
    </li>
  );
}

const REASONS = ['Cheque bounced', 'Entered by mistake', 'Wrong student', 'Refunded to parent'];

function CancelReceiptModal({ receipt: r, onClose, onDone }: { receipt: ReceiptListItem | null; onClose: () => void; onDone: (res: CancelReceiptResult) => void }) {
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    setReason('');
    setAck(false);
    setError(null);
    setTouched(false);
  }, [r?.id]);

  if (!r) return null;
  const reasonError = reason.trim().length < 5 ? 'Give a reason of at least 5 characters' : null;
  const blocked = Boolean(reasonError) || (r.online && !ack);

  async function submit() {
    setTouched(true);
    if (blocked || !r) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<{ data: CancelReceiptResult }>('POST', `/fees/receipts/${r.id}/cancel`, {
        reason: reason.trim(),
        ...(r.online ? { acknowledgeOnlineRefund: true } : {}),
      });
      onDone(res.data);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      title={`Cancel receipt ${r.receiptNumber}?`}
      description={`${formatInr(r.amount)} · ${formatDateTime(r.receivedAt)} · ${MODE_LABEL[r.paymentMode] ?? r.paymentMode}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Keep receipt
          </Button>
          <Button variant="danger" onClick={submit} loading={busy} data-cancel-confirm>
            Cancel receipt
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm text-slate-700 dark:text-slate-300">
        {r.online && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-3.5 py-3 text-red-900 dark:border-red-400/40 dark:bg-red-400/10 dark:text-red-100" role="alert" data-online-warning>
            <p className="flex items-center gap-2 font-semibold">
              <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden /> Paid online. This does not refund the parent.
            </p>
            <p className="mt-1">
              Cancelling only cancels the record in SM ERP. The {formatInr(r.amount)} stays in the school&apos;s Razorpay account until you refund it in the{' '}
              <strong>Razorpay Dashboard → Payments{r.gatewayPaymentId ? ` → ${r.gatewayPaymentId}` : ''} → Refund</strong>.
            </p>
            <label className="mt-2.5 flex items-start gap-2 font-medium">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-red-300 text-red-600 focus:ring-red-500" data-online-ack />
              I will refund this payment in the Razorpay Dashboard myself.
            </label>
            {touched && !ack && <p className="mt-1 text-xs">Tick this to go ahead.</p>}
          </div>
        )}
        <div>
          <p className="font-medium text-slate-900 dark:text-slate-100">What happens</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5">
            <li>
              {r.appliedTo.length === 1 ? 'Invoice' : 'Invoices'} {r.appliedTo.map((a) => a.invoiceNumber).join(', ')} {r.appliedTo.length === 1 ? 'becomes' : 'become'} payable again
              ({formatInr(r.amount)} back to pending).
            </li>
            <li>The day book records {formatInr(r.amount)} going out, dated today.</li>
            <li>The receipt stays in the list marked Cancelled; its number is never reused. This cannot be undone.</li>
          </ul>
        </div>
        <div>
          <Textarea
            label="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={255}
            rows={2}
            placeholder="e.g. Cheque bounced, entered by mistake"
            error={touched ? reasonError : null}
            data-cancel-reason
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {REASONS.map((x) => (
              <button
                key={x}
                type="button"
                onClick={() => setReason(x)}
                className="rounded-full border border-line px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-white/[0.04]"
              >
                {x}
              </button>
            ))}
          </div>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}


