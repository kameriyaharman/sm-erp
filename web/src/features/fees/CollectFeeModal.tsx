'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Banknote,
  Building2,
  CircleCheck,
  CreditCard,
  FilePlus2,
  Landmark,
  LoaderCircle,
  ReceiptText,
  Smartphone,
  TriangleAlert,
  X,
} from 'lucide-react';
import { ApiError, type FeesApi, type PaymentMode, type Receipt, type StudentDues, type StudentFeeRow } from './api';
import { buttonClass, cx } from '@/components/ui';
import { formatDate, formatInr, fromPaise, parseRupeeInput, toPaise, todayIso } from './format';

/* ============================================================================
 * Collect fee modal
 * Loads the student's open invoices, lets the cashier choose which to settle,
 * previews how the amount will be applied (oldest due first, same rule as the
 * server), and records the payment with an idempotency key so a double click or
 * a retried request can never charge twice.
 * ========================================================================== */

const PAYMENT_MODES: { value: PaymentMode; label: string; icon: typeof Banknote; reference?: { label: string; required: boolean; placeholder: string } }[] = [
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'upi', label: 'UPI', icon: Smartphone, reference: { label: 'UPI reference / UTR', required: false, placeholder: 'e.g. 426817339012' } },
  { value: 'card', label: 'Card', icon: CreditCard, reference: { label: 'Card transaction ID', required: false, placeholder: 'POS slip number' } },
  { value: 'bank_transfer', label: 'Bank transfer', icon: Building2, reference: { label: 'UTR number', required: false, placeholder: 'NEFT / RTGS / IMPS reference' } },
  { value: 'cheque', label: 'Cheque', icon: Landmark, reference: { label: 'Cheque number', required: true, placeholder: '6-digit cheque number' } },
];

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

interface CollectFeeModalProps {
  api: FeesApi;
  student: StudentFeeRow;
  onClose: () => void;
  onCollected: (receipt: Receipt) => void;
}

export default function CollectFeeModal({ api, student, onClose, onCollected }: CollectFeeModalProps) {
  const titleId = useId();
  const descId = useId();
  const fieldId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  // One key per modal session: a retry of the same intent (network drop, double click) reuses it.
  const idempotencyKey = useMemo(newIdempotencyKey, []);

  const [dues, setDues] = useState<StudentDues | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [amount, setAmount] = useState('');
  const [amountTouched, setAmountTouched] = useState(false);
  const [mode, setMode] = useState<PaymentMode>('cash');
  const [reference, setReference] = useState('');
  const [bankName, setBankName] = useState('');
  const [chequeDate, setChequeDate] = useState(todayIso());
  const [remarks, setRemarks] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const busy = submitting || creatingInvoice;

  // ---------------------------------------------------------------- load dues
  useEffect(() => {
    const controller = new AbortController();
    setLoadError(null);
    api
      .getStudentDues(student.studentId, controller.signal)
      .then((data) => {
        setDues(data);
        setSelected(new Set(data.openInvoices.map((inv) => inv.id)));
      })
      .catch((err: unknown) => {
        if ((err as Error).name !== 'AbortError') setLoadError((err as Error).message);
      });
    return () => controller.abort();
  }, [api, student.studentId, reloadKey]);

  // ---------------------------------------------------------------- derived
  const selectedInvoices = useMemo(
    () => (dues?.openInvoices ?? []).filter((inv) => selected.has(inv.id)),
    [dues, selected],
  );
  const selectedDue = selectedInvoices.reduce((sum, inv) => sum + toPaise(inv.balanceAmount), 0);

  // Keep the amount in step with the selection until the cashier edits it.
  useEffect(() => {
    if (!amountTouched) setAmount(selectedDue > 0 ? fromPaise(selectedDue) : '');
  }, [selectedDue, amountTouched]);

  const parsed = parseRupeeInput(amount);
  const amountPaise = 'paise' in parsed ? parsed.paise : 0;
  const modeConfig = PAYMENT_MODES.find((m) => m.value === mode)!;

  const errors: Record<string, string> = {};
  if (selectedInvoices.length === 0) errors.invoices = 'Select at least one invoice';
  if ('error' in parsed) errors.amount = parsed.error;
  else if (amountPaise > selectedDue) errors.amount = `Amount can't be more than ${formatInr(fromPaise(selectedDue))} due on the selected invoices`;
  if (modeConfig.reference?.required && !reference.trim()) errors.reference = `${modeConfig.reference.label} is required`;
  if (mode === 'cheque' && !bankName.trim()) errors.bankName = 'Bank name is required';
  const isValid = Object.keys(errors).length === 0;

  // Same rule as the server: oldest due first.
  const allocationPreview = useMemo(() => {
    let remaining = amountPaise;
    return selectedInvoices.map((inv) => {
      const balance = toPaise(inv.balanceAmount);
      const applied = Math.max(0, Math.min(remaining, balance));
      remaining -= applied;
      return { inv, applied, left: balance - applied };
    });
  }, [selectedInvoices, amountPaise]);

  // ---------------------------------------------------------------- dialog behaviour
  const requestClose = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, []);

  useEffect(() => {
    if (receipt) dialogRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    else if (dues) amountRef.current?.focus();
    else dialogRef.current?.focus();
  }, [dues, receipt]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      requestClose();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // ---------------------------------------------------------------- actions
  function toggleInvoice(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function createInvoiceForRemaining() {
    setCreatingInvoice(true);
    setServerError(null);
    try {
      await api.createInvoice({ studentId: student.studentId });
      setAmountTouched(false);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setServerError((err as Error).message);
    } finally {
      setCreatingInvoice(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setShowErrors(true);
    if (!isValid || busy) return;

    setSubmitting(true);
    setServerError(null);
    try {
      const result = await api.collectPayment(
        {
          studentId: student.studentId,
          amount: fromPaise(amountPaise),
          paymentMode: mode,
          invoiceIds: selectedInvoices.map((inv) => inv.id),
          instrumentNumber: reference.trim() || undefined,
          instrumentDate: mode === 'cheque' ? chequeDate : undefined,
          bankName: mode === 'cheque' ? bankName.trim() : undefined,
          remarks: remarks.trim() || undefined,
        },
        idempotencyKey,
      );
      setReceipt(result);
      onCollected(result);
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'AMOUNT_EXCEEDS_DUE' || err.code === 'INVOICES_NOT_PAYABLE' || err.code === 'NOTHING_DUE')) {
        // Someone else collected in the meantime: refresh dues so the numbers are current.
        setServerError(`${err.message} The dues below have been refreshed.`);
        setAmountTouched(false);
        setReloadKey((k) => k + 1);
      } else {
        setServerError((err as Error).message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ---------------------------------------------------------------- render
  const classLabel = [student.class?.name, student.section?.name].filter(Boolean).join(' ');
  const inputClass =
    'block w-full rounded-lg border bg-surface px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-[3px] focus:ring-indigo-500/20 dark:text-slate-100 dark:placeholder:text-slate-500';
  const borderFor = (field: string) =>
    showErrors && errors[field]
      ? 'border-red-400 focus:border-red-500 dark:border-red-500/70'
      : 'border-line-strong focus:border-indigo-500 dark:focus:border-indigo-400';

  const dialog = (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="fixed inset-0 bg-ink-950/45 backdrop-blur-[1px]" aria-hidden onClick={requestClose} />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="relative flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl sm:max-h-[calc(100vh-3rem)] sm:rounded-2xl border border-line bg-surface shadow-pop outline-none"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-slate-900 dark:text-slate-50">
              {receipt ? 'Payment recorded' : 'Collect fee'}
            </h2>
            <p id={descId} className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">
              {student.studentName}
              {classLabel && `, ${classLabel}`}
              <span className="tabular-nums">{`, ${student.admissionNumber}`}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={requestClose}
            disabled={busy}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-40 dark:hover:bg-white/5 dark:hover:text-slate-200 dark:focus-visible:ring-slate-300"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {receipt ? (
          <ReceiptView receipt={receipt} onDone={onClose} />
        ) : loadError ? (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <TriangleAlert className="h-6 w-6 text-red-600 dark:text-red-400" aria-hidden />
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Couldn&apos;t load this student&apos;s dues</p>
            <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">{loadError}</p>
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className={cx(buttonClass({ variant: 'secondary', size: 'sm' }), 'mt-1')}
            >
              Try again
            </button>
          </div>
        ) : !dues ? (
          <div className="flex items-center justify-center gap-2 px-6 py-16 text-sm text-slate-500 dark:text-slate-400" role="status">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
            Loading dues
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
              {/* Not yet invoiced */}
              {toPaise(dues.notYetInvoiced.amount) > 0 && (
                <div className="flex items-start gap-3 rounded-lg border border-line bg-surface-muted p-4">
                  <FilePlus2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium text-slate-900 dark:text-slate-100">
                      {formatInr(dues.notYetInvoiced.amount)} not invoiced yet
                    </p>
                    <p className="mt-0.5 text-slate-500 dark:text-slate-400">
                      {summariseAllocations(dues.notYetInvoiced.allocations)}. Create an invoice to collect it now.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={createInvoiceForRemaining}
                    disabled={busy}
                    className={buttonClass({ variant: 'secondary', size: 'sm' })}
                  >
                    {creatingInvoice && <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                    Create invoice
                  </button>
                </div>
              )}

              {/* Invoices */}
              <fieldset>
                <legend className="text-sm font-medium text-slate-900 dark:text-slate-100">Invoices to settle</legend>
                {dues.openInvoices.length === 0 ? (
                  <p className="mt-2 rounded-lg border border-dashed border-line-strong px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                    No open invoices. {toPaise(dues.notYetInvoiced.amount) > 0 ? 'Create an invoice above to collect the remaining fees.' : 'This student has nothing due.'}
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line">
                    {dues.openInvoices.map((inv) => {
                      const checked = selected.has(inv.id);
                      const preview = allocationPreview.find((p) => p.inv.id === inv.id);
                      const overdue = inv.dueDate < todayIso();
                      const id = `${fieldId}-inv-${inv.id}`;
                      return (
                        <li key={inv.id}>
                          <label htmlFor={id} className="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50/70 dark:hover:bg-white/[0.025]">
                            <input
                              id={id}
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleInvoice(inv.id)}
                              className="h-4 w-4 rounded"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium tabular-nums text-slate-900 dark:text-slate-100">{inv.invoiceNumber}</span>
                              <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                                {[inv.periodLabel, inv.feeHeads].filter(Boolean).join(', ') || 'Fee invoice'}
                                <span aria-hidden>, </span>
                                <span className={overdue ? 'font-medium text-red-700 dark:text-red-400' : ''}>
                                  {overdue ? 'Overdue since' : 'Due'} {formatDate(inv.dueDate)}
                                </span>
                              </span>
                            </span>
                            <span className="text-right">
                              <span className="block text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatInr(inv.balanceAmount)}</span>
                              {toPaise(inv.paidAmount) > 0 && (
                                <span className="block text-xs tabular-nums text-slate-500 dark:text-slate-400">of {formatInr(inv.netAmount)}</span>
                              )}
                            </span>
                          </label>
                          {checked && preview && amountPaise > 0 && preview.applied > 0 && (
                            <p className="-mt-1 pb-2.5 pl-11 pr-4 text-xs text-slate-500 dark:text-slate-400">
                              <span className="tabular-nums">{formatInr(fromPaise(preview.applied))}</span> applied
                              {preview.left === 0 ? (
                                <span className="font-medium text-emerald-700 dark:text-emerald-400">, fully paid</span>
                              ) : (
                                <span className="tabular-nums">, {formatInr(fromPaise(preview.left))} still due</span>
                              )}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {showErrors && errors.invoices && dues.openInvoices.length > 0 && (
                  <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{errors.invoices}</p>
                )}
              </fieldset>

              {dues.openInvoices.length > 0 && (
                <>
                  {/* Amount */}
                  <div>
                    <div className="flex items-baseline justify-between">
                      <label htmlFor={`${fieldId}-amount`} className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        Amount received
                      </label>
                      {amountTouched && selectedDue > 0 && amountPaise !== selectedDue && (
                        <button
                          type="button"
                          onClick={() => setAmountTouched(false)}
                          className="text-xs font-medium text-slate-600 underline-offset-2 hover:underline dark:text-slate-300"
                        >
                          Use full amount ({formatInr(fromPaise(selectedDue))})
                        </button>
                      )}
                    </div>
                    <div className="relative mt-1.5">
                      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-base text-slate-400" aria-hidden>
                        ₹
                      </span>
                      <input
                        ref={amountRef}
                        id={`${fieldId}-amount`}
                        inputMode="decimal"
                        autoComplete="off"
                        value={amount}
                        onChange={(e) => {
                          setAmount(e.target.value);
                          setAmountTouched(true);
                        }}
                        aria-invalid={showErrors && !!errors.amount}
                        aria-describedby={`${fieldId}-amount-hint`}
                        className={`${inputClass} ${borderFor('amount')} py-2.5 pl-8 text-lg font-semibold tabular-nums`}
                      />
                    </div>
                    <p id={`${fieldId}-amount-hint`} className={`mt-1.5 text-xs ${showErrors && errors.amount ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}>
                      {showErrors && errors.amount
                        ? errors.amount
                        : `Selected invoices total ${formatInr(fromPaise(selectedDue))}. Part payments are applied to the oldest due first.`}
                    </p>
                  </div>

                  {/* Payment mode */}
                  <fieldset>
                    <legend className="text-sm font-medium text-slate-900 dark:text-slate-100">Payment method</legend>
                    <div className="mt-2 grid grid-cols-5 gap-2" role="radiogroup">
                      {PAYMENT_MODES.map((option) => {
                        const ModeIcon = option.icon;
                        const active = mode === option.value;
                        return (
                          <label
                            key={option.value}
                            className={[
                              'flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-xs font-medium transition-colors focus-within:ring-[3px] focus-within:ring-indigo-500/25',
                              active
                                ? 'border-indigo-500 bg-indigo-50 text-indigo-800 ring-1 ring-inset ring-indigo-500 dark:border-indigo-400 dark:bg-indigo-400/15 dark:text-indigo-100 dark:ring-indigo-400'
                                : 'border-line-strong text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-white/5',
                            ].join(' ')}
                          >
                            <input
                              type="radio"
                              name={`${fieldId}-mode`}
                              value={option.value}
                              checked={active}
                              onChange={() => setMode(option.value)}
                              className="sr-only"
                            />
                            <ModeIcon className="h-4 w-4" aria-hidden />
                            {option.label}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>

                  {/* Reference fields */}
                  {modeConfig.reference && (
                    <div className={`grid gap-4 ${mode === 'cheque' ? 'grid-cols-3' : 'grid-cols-1'}`}>
                      <Field id={`${fieldId}-ref`} label={modeConfig.reference.label} optional={!modeConfig.reference.required} error={showErrors ? errors.reference : undefined}>
                        <input
                          id={`${fieldId}-ref`}
                          value={reference}
                          onChange={(e) => setReference(e.target.value)}
                          placeholder={modeConfig.reference.placeholder}
                          maxLength={50}
                          aria-invalid={showErrors && !!errors.reference}
                          className={`${inputClass} ${borderFor('reference')} tabular-nums`}
                        />
                      </Field>
                      {mode === 'cheque' && (
                        <>
                          <Field id={`${fieldId}-bank`} label="Bank name" error={showErrors ? errors.bankName : undefined}>
                            <input
                              id={`${fieldId}-bank`}
                              value={bankName}
                              onChange={(e) => setBankName(e.target.value)}
                              placeholder="e.g. HDFC Bank"
                              maxLength={100}
                              aria-invalid={showErrors && !!errors.bankName}
                              className={`${inputClass} ${borderFor('bankName')}`}
                            />
                          </Field>
                          <Field id={`${fieldId}-chqdate`} label="Cheque date">
                            <input
                              id={`${fieldId}-chqdate`}
                              type="date"
                              value={chequeDate}
                              onChange={(e) => setChequeDate(e.target.value)}
                              className={`${inputClass} border-line-strong focus:border-indigo-500`}
                            />
                          </Field>
                        </>
                      )}
                    </div>
                  )}

                  <Field id={`${fieldId}-remarks`} label="Note" optional>
                    <textarea
                      id={`${fieldId}-remarks`}
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      rows={2}
                      maxLength={255}
                      placeholder="Shown on the receipt, e.g. paid by father at counter"
                      className={`${inputClass} resize-none border-line-strong focus:border-indigo-500`}
                    />
                  </Field>
                </>
              )}

              {serverError && (
                <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  {serverError}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 border-t border-line bg-surface-muted/60 px-6 py-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">A receipt number is issued when you confirm.</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={requestClose}
                  disabled={busy}
                  className="h-10 rounded-lg px-3.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy || dues.openInvoices.length === 0}
                  className="inline-flex h-10 min-w-[10rem] items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-400"
                >
                  {submitting ? (
                    <>
                      <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                      Recording payment
                    </>
                  ) : (
                    <span className="tabular-nums">Collect {amountPaise > 0 ? formatInr(fromPaise(amountPaise)) : 'fee'}</span>
                  )}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );

  return typeof document === 'undefined' ? null : createPortal(dialog, document.body);
}

/* ============================================================================ */

function Field({ id, label, optional, error, children }: { id: string; label: string; optional?: boolean; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="flex items-baseline gap-1.5 text-sm font-medium text-slate-900 dark:text-slate-100">
        {label}
        {optional && <span className="text-xs font-normal text-slate-400">optional</span>}
      </label>
      <div className="mt-1.5">{children}</div>
      {error && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

function ReceiptView({ receipt, onDone }: { receipt: Receipt; onDone: () => void }) {
  const modeLabel = PAYMENT_MODES.find((m) => m.value === receipt.paymentMode)?.label ?? receipt.paymentMode;
  return (
    <div className="flex flex-col">
      <div className="space-y-5 px-6 py-6">
        <div className="flex items-center gap-4" role="status">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-500/10">
            <CircleCheck className="h-6 w-6 text-emerald-600 dark:text-emerald-400" aria-hidden />
          </span>
          <div>
            <p className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">{formatInr(receipt.amount)}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Received by {modeLabel.toLowerCase()}
              {receipt.instrumentNumber && <span className="tabular-nums">, ref {receipt.instrumentNumber}</span>}
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-4 rounded-xl border border-line p-4 text-sm">
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">Receipt number</dt>
            <dd className="mt-0.5 flex items-center gap-1.5 font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              <ReceiptText className="h-4 w-4 text-slate-400" aria-hidden />
              {receipt.receiptNumber}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">Recorded</dt>
            <dd className="mt-0.5 text-slate-900 dark:text-slate-100">
              {new Date(receipt.receivedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
              {receipt.collectedBy && <span className="text-slate-500 dark:text-slate-400"> by {receipt.collectedBy}</span>}
            </dd>
          </div>
        </dl>

        <div>
          <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">Applied to</h3>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
            {receipt.appliedTo.map((line) => (
              <li key={line.invoiceId} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium tabular-nums text-slate-900 dark:text-slate-100">{line.invoiceNumber}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    {line.invoiceStatus === 'paid' ? 'Fully paid' : `${formatInr(line.invoiceBalance)} still due`}
                  </span>
                </span>
                <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatInr(line.amountApplied)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="flex justify-end border-t border-line bg-surface-muted/60 px-6 py-4">
        <button
          type="button"
          data-autofocus
          onClick={onDone}
          className="h-10 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400"
        >
          Done
        </button>
      </div>
    </div>
  );
}

function summariseAllocations(allocations: StudentDues['notYetInvoiced']['allocations']): string {
  if (allocations.length === 0) return '';
  const heads = [...new Set(allocations.map((a) => a.feeHead))].join(' and ');
  const first = allocations[0].dueDate;
  return `${heads}, ${allocations.length} installment${allocations.length === 1 ? '' : 's'} from ${formatDate(first)}`;
}
