'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, Notice, Page, PageHeader, Pagination, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { qs, useApi } from '@/lib/useApi';
import { apiSend } from '@/lib/session';
import { formatDate, formatInr, formatMonth, titleCase } from '@/lib/format';
import Link from 'next/link';
import { ConfirmModal, errorText, fieldErrors, monthRange, todayLocal, useFlash } from './shared';
import { DateRangeFilter, FilterBar, FilterSearch, FilteredEmpty, SelectFilter, chip, describeRange, useUrlFilters } from '@/components/filters';
import type { Expense, ExpensesMeta, Paged, Wrapped } from './types';
// Categories come from the day book: every expense is an "out" entry there (see docs/accounts.md).
import { EXPENSE_CATEGORIES, EXPENSE_MODES, categoryColor, categoryLabel, type ExpenseCategory } from '@/features/accounts/types';

/** An expense row as the API now sends it: + its day-book voucher and account. */
type ExpenseRow = Omit<Expense, 'category'> & { category: string; voucherNo?: string | null; account?: { id: string; name: string } | null };

/** /expenses?from=…&to=…&category=…&paymentMode=…&search=… (default: this month). */
export default function ExpensesPage() {
  const params = useSearchParams();
  const flash = useFlash();
  const today = todayLocal();
  const month = monthRange(today.slice(0, 7));
  const f = useUrlFilters({ search: '', category: '', paymentMode: '', from: month.from, to: month.to });
  const { search, category, paymentMode, from, to } = f.values;
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<ExpenseRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (params.get('new') === '1') setAdding(true);
  }, [params]);

  const badRange = Boolean(from && to && from > to);
  const { data, error, loading, reload } = useApi<Paged<ExpenseRow, Omit<ExpensesMeta, 'byCategory'> & { byCategory: Array<{ category: string; amount: string }> }>>(
    badRange ? null : `/expenses${qs({ from, to, category, paymentMode, search, page: f.page, limit: 25 })}`,
  );

  const periodLabel = from || to ? describeRange(from, to, today) : 'All time';
  const total = data ? Number(data.meta.totalAmount) : 0;
  const modeText = (m: string) => (m === 'upi' ? 'UPI' : titleCase(m));
  const chips = [
    chip('search', 'Search', search, `“${search}”`, () => f.set({ search: '' })),
    chip('category', 'Category', category, category ? categoryLabel(category) : '', () => f.set({ category: '' })),
    chip('paymentMode', 'Paid by', paymentMode, paymentMode ? modeText(paymentMode) : '', () => f.set({ paymentMode: '' })),
    (from !== month.from || to !== month.to) && { key: 'date', label: `Period: ${periodLabel}`, onRemove: () => f.set({ from: month.from, to: month.to }) },
  ];
  const filtered = chips.some(Boolean);

  async function doDelete() {
    if (!deleting) return;
    setBusy(true);
    setDeleteError(null);
    try {
      await apiSend('DELETE', `/expenses/${deleting.id}`);
      flash.show('success', `Deleted “${deleting.description}” (${formatInr(deleting.amount)}).`);
      setDeleting(null);
      reload();
    } catch (err) {
      setDeleteError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page wide>
      <PageHeader
        title="Expenses"
        description={
          <>
            Salaries, bills and purchases paid by the school. Each one is also an “out” entry in the{' '}
            <Link href="/accounts" className="font-medium text-indigo-700 hover:underline dark:text-indigo-300">
              Day book
            </Link>
            .
          </>
        }
        actions={
          <Button icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setAdding(true)}>
            Add expense
          </Button>
        }
      />
      {flash.node}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <Card className="min-w-0 xl:col-span-4" title={`Spent · ${periodLabel}`}>
          {loading && !data ? (
            <Spinner />
          ) : data ? (
            <div>
              <p className="text-3xl font-semibold tabular-nums tracking-tight">{formatInr(data.meta.totalAmount)}</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {data.meta.total} expense{data.meta.total === 1 ? '' : 's'}
                {category ? ` in ${categoryLabel(category)}` : ''}
                {paymentMode ? ` paid by ${modeText(paymentMode)}` : ''}
                {search ? ` matching “${search}”` : ''}
              </p>
              {data.meta.byCategory.length > 0 ? (
                <ul className="mt-5 space-y-3" aria-label="Spending by category">
                  {data.meta.byCategory.map((c) => {
                    const pct = total > 0 ? (Number(c.amount) / total) * 100 : 0;
                    return (
                      <li key={c.category}>
                        <button type="button" onClick={() => f.set({ category: category === c.category ? '' : c.category })} className="w-full text-left" aria-pressed={category === c.category}>
                          <span className="mb-1 flex items-center justify-between gap-3 text-sm">
                            <span className="flex items-center gap-2">
                              <span className={`h-2.5 w-2.5 rounded-sm ${categoryColor(c.category)}`} aria-hidden />
                              {categoryLabel(c.category)}
                            </span>
                            <span className="tabular-nums">
                              {formatInr(c.amount)} <span className="text-xs text-slate-500">({pct.toFixed(0)}%)</span>
                            </span>
                          </span>
                          <span className="block h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                            <span className={`block h-full rounded-full ${categoryColor(c.category)}`} style={{ width: `${Math.max(pct, 1)}%` }} />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-slate-500">Nothing spent in this period.</p>
              )}
            </div>
          ) : null}
        </Card>

        <Card className="min-w-0 xl:col-span-8" padded={false}>
          <FilterBar
            search={<FilterSearch value={search} onChange={(v) => f.set({ search: v })} placeholder="Description, vendor, bill or voucher no." />}
            chips={chips}
            onClear={f.clear}
          >
            <DateRangeFilter label="Period" from={from} to={to} today={today} max={today} onChange={(r) => f.set(r)} />
            <SelectFilter
              label="Category"
              name="category"
              value={category}
              allLabel="All categories"
              options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: categoryLabel(c) }))}
              onChange={(v) => f.set({ category: v })}
            />
            <SelectFilter label="Paid by" name="paymentMode" value={paymentMode} allLabel="Any mode" options={EXPENSE_MODES.map((m) => ({ value: m, label: modeText(m) }))} onChange={(v) => f.set({ paymentMode: v })} />
          </FilterBar>
          {badRange ? (
            <EmptyState title="Check the dates" description="“From” must be on or before “To”." />
          ) : loading && !data ? (
            <Spinner label="Loading expenses…" />
          ) : error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : !data?.data.length ? (
            filtered ? (
              <FilteredEmpty what="expenses" chips={chips} onClear={f.clear} />
            ) : (
              <EmptyState title="No expenses in this period" description="Record salaries, bills and purchases to see where money goes." action={<Button onClick={() => setAdding(true)}>Add expense</Button>} />
            )
          ) : (
            <div className={loading ? 'opacity-60' : undefined}>
              <Table>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Description</Th>
                    <Th>Category</Th>
                    <Th>Paid by</Th>
                    <Th align="right">Amount</Th>
                    <Th align="right">
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((x) => (
                    <tr key={x.id}>
                      <Td className="whitespace-nowrap">{formatDate(x.expenseDate)}</Td>
                      <Td>
                        <p className="min-w-[12rem] font-medium">{x.description}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{[x.vendor, x.reference].filter(Boolean).join(', ') || `Added by ${x.createdBy?.name ?? 'staff'}`}</p>
                        {x.voucherNo && (
                          <p className="text-xs text-slate-400 dark:text-slate-500">
                            <span className="font-mono">{x.voucherNo}</span>
                            {x.account ? ` · ${x.account.name}` : ''}
                          </p>
                        )}
                      </Td>
                      <Td>
                        <Badge>
                          <span className={`h-2 w-2 rounded-sm ${categoryColor(x.category)}`} aria-hidden />
                          {categoryLabel(x.category)}
                        </Badge>
                      </Td>
                      <Td className="whitespace-nowrap">{x.paymentMode === 'upi' ? 'UPI' : titleCase(x.paymentMode)}</Td>
                      <Td align="right" className="whitespace-nowrap font-semibold">
                        {formatInr(x.amount)}
                      </Td>
                      <Td align="right">
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteError(null);
                            setDeleting(x);
                          }}
                          aria-label={`Delete ${x.description}`}
                          className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onChange={f.setPage} />
            </div>
          )}
        </Card>
      </div>

      <AddExpenseModal
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={(x) => {
          setAdding(false);
          flash.show('success', `Recorded ${formatInr(x.amount)} for “${x.description}”.`);
          // Show the new expense: widen the period when it falls outside it.
          if ((from && x.expenseDate < from) || (to && x.expenseDate > to)) {
            const m = monthRange(x.expenseDate.slice(0, 7));
            f.set({ from: m.from, to: m.to });
          } else reload();
        }}
      />
      <ConfirmModal open={!!deleting} title="Delete this expense?" confirmLabel="Delete" busy={busy} error={deleteError} onConfirm={doDelete} onClose={() => setDeleting(null)}>
        {deleting && (
          <p>
            <strong>{deleting.description}</strong>, {formatInr(deleting.amount)} on {formatDate(deleting.expenseDate)}, will be removed from the books and the day book (its voucher stays in the audit trail).
          </p>
        )}
      </ConfirmModal>
    </Page>
  );
}

interface ExpenseForm {
  category: ExpenseCategory | '';
  description: string;
  amount: string;
  expenseDate: string;
  paymentMode: string;
  vendor: string;
  reference: string;
}

function AddExpenseModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (x: ExpenseRow) => void }) {
  const empty = (): ExpenseForm => ({ category: '', description: '', amount: '', expenseDate: todayLocal(), paymentMode: 'bank_transfer', vendor: '', reference: '' });
  const [form, setForm] = useState<ExpenseForm>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setForm(empty());
      setErrors({});
      setError(null);
    }
  }, [open]);
  const set = (k: keyof ExpenseForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const e: Record<string, string> = {};
    const amount = form.amount.replace(/[,₹\s]/g, '');
    if (!form.category) e.category = 'Choose a category';
    if (form.description.trim().length < 3) e.description = 'At least 3 characters';
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) e.amount = 'Enter an amount in rupees, e.g. 12500';
    if (!form.expenseDate) e.expenseDate = 'Required';
    else if (form.expenseDate > todayLocal()) e.expenseDate = 'Cannot be in the future';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<Wrapped<ExpenseRow>>('POST', '/expenses', {
        category: form.category,
        description: form.description.trim(),
        amount,
        expenseDate: form.expenseDate,
        paymentMode: form.paymentMode,
        vendor: form.vendor.trim() || undefined,
        reference: form.reference.trim() || undefined,
      });
      onCreated(res.data);
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
      title="Add expense"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="expense-form" loading={busy}>
            Save expense
          </Button>
        </>
      }
    >
      <form id="expense-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Select label="Category" value={form.category} onChange={set('category')} error={errors.category} required>
          <option value="">Choose…</option>
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {categoryLabel(c)}
            </option>
          ))}
        </Select>
        <Input label="Amount (₹)" inputMode="decimal" value={form.amount} onChange={set('amount')} error={errors.amount} placeholder="12500" required />
        <Input label="Description" value={form.description} onChange={set('description')} error={errors.description} maxLength={255} placeholder="e.g. Electricity bill, September" className="sm:col-span-2" required />
        <Input label="Date paid" type="date" value={form.expenseDate} max={todayLocal()} onChange={set('expenseDate')} error={errors.expenseDate} required />
        <Select label="Payment mode" value={form.paymentMode} onChange={set('paymentMode')} error={errors.paymentMode}>
          {EXPENSE_MODES.map((m) => (
            <option key={m} value={m}>
              {m === 'upi' ? 'UPI' : titleCase(m)}
            </option>
          ))}
        </Select>
        <Input label="Vendor / paid to" value={form.vendor} onChange={set('vendor')} error={errors.vendor} placeholder="Optional" />
        <Input label="Reference (UTR, cheque, bill no.)" value={form.reference} onChange={set('reference')} error={errors.reference} placeholder="Optional" />
        {error && (
          <div className="sm:col-span-2">
            <Notice tone="error">{error}</Notice>
          </div>
        )}
      </form>
    </Modal>
  );
}
