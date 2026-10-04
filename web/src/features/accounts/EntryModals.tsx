'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowRight, Landmark, Lock, Wallet } from 'lucide-react';
import { Badge, Button, Input, Modal, Notice, Select, Textarea } from '@/components/ui';
import { apiSend } from '@/lib/session';
import { formatDate, formatInr } from '@/lib/format';
import { errorText, fieldErrors } from '@/features/admin/shared';
import {
  categoryLabel, EXPENSE_CATEGORIES, EXPENSE_MODES, MANUAL_INCOME_CATEGORIES, modeLabel, PAYMENT_MODES,
  type Account, type LedgerEntry,
} from './types';
import { paise } from './util';

const RUPEES = /^\d+(\.\d{1,2})?$/;
const cleanAmount = (s: string) => s.replace(/[,₹\s]/g, '');

/** Accounts a payment mode can use: cash -> cash accounts; anything else -> bank / UPI accounts. */
export function accountsForMode(accounts: Account[], mode: string) {
  return accounts.filter((a) => a.isActive && (mode === 'cash') === (a.type === 'cash'));
}

export function AccountIcon({ type, className = 'h-4 w-4' }: { type: Account['type']; className?: string }) {
  return type === 'cash' ? <Wallet className={className} aria-hidden /> : <Landmark className={className} aria-hidden />;
}

// ------------------------------------------------------------------ income / expense

interface EntryForm {
  category: string;
  amount: string;
  date: string;
  paymentMode: string;
  accountId: string;
  party: string;
  description: string;
  reference: string;
}

export function EntryModal({
  direction,
  open,
  accounts,
  today,
  defaultDate,
  onClose,
  onSaved,
}: {
  direction: 'in' | 'out';
  open: boolean;
  accounts: Account[];
  today: string;
  defaultDate: string;
  onClose: () => void;
  onSaved: (e: LedgerEntry) => void;
}) {
  const isIn = direction === 'in';
  const empty = (): EntryForm => ({
    category: '', amount: '', date: defaultDate > today ? today : defaultDate, paymentMode: 'cash', accountId: '', party: '', description: '', reference: '',
  });
  const [form, setForm] = useState<EntryForm>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setForm(empty());
      setErrors({});
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const usable = useMemo(() => accountsForMode(accounts, form.paymentMode), [accounts, form.paymentMode]);
  // Keep the account consistent with the mode: default account of the right kind.
  useEffect(() => {
    if (!open) return;
    if (!usable.some((a) => a.id === form.accountId)) {
      const pick = usable.find((a) => a.isDefault) ?? usable[0];
      setForm((f) => ({ ...f, accountId: pick?.id ?? '' }));
    }
  }, [open, usable, form.accountId]);

  const set = (k: keyof EntryForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const account = accounts.find((a) => a.id === form.accountId);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const e: Record<string, string> = {};
    const amount = cleanAmount(form.amount);
    if (!form.category) e.category = 'Choose a category';
    if (!RUPEES.test(amount) || Number(amount) <= 0) e.amount = 'Enter an amount in rupees, e.g. 2500';
    if (!form.date) e.date = 'Required';
    else if (form.date > today) e.date = 'Cannot be in the future';
    else if (account && form.date < account.openingDate) e.date = `${account.name} starts on ${formatDate(account.openingDate)}`;
    if (form.description.trim().length < 3) e.description = 'At least 3 characters';
    if (!form.accountId) e.accountId = form.paymentMode === 'cash' ? 'Add a cash account first' : 'Add a bank account first';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<{ data: LedgerEntry }>('POST', '/ledger', {
        direction,
        category: form.category,
        amount,
        date: form.date,
        accountId: form.accountId,
        paymentMode: form.paymentMode,
        party: form.party.trim() || undefined,
        description: form.description.trim(),
        reference: form.reference.trim() || undefined,
      });
      onSaved(res.data);
    } catch (err) {
      const fe = fieldErrors(err);
      if (fe.date === undefined && /opening|future/i.test(errorText(err))) fe.date = errorText(err);
      setErrors(fe);
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const modes = isIn ? PAYMENT_MODES : EXPENSE_MODES;
  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={isIn ? 'Add income' : 'Add expense'}
      description={isIn ? 'Money received other than fees (fees are recorded from Fee collection).' : 'Also appears on the Expenses page.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="entry-form" loading={busy}>
            {isIn ? 'Save income' : 'Save expense'}
          </Button>
        </>
      }
    >
      <form id="entry-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Select label="Category" value={form.category} onChange={set('category')} error={errors.category}>
          <option value="">Choose…</option>
          {(isIn ? MANUAL_INCOME_CATEGORIES : EXPENSE_CATEGORIES).map((c) => (
            <option key={c} value={c}>
              {categoryLabel(c)}
            </option>
          ))}
        </Select>
        <Input label="Amount (₹)" inputMode="decimal" value={form.amount} onChange={set('amount')} error={errors.amount} placeholder="2500" />
        <Input
          label="Description"
          value={form.description}
          onChange={set('description')}
          error={errors.description}
          maxLength={255}
          placeholder={isIn ? 'e.g. Admission forms sold (20 × ₹500)' : 'e.g. Electricity bill, September'}
          className="sm:col-span-2"
        />
        <Input label={isIn ? 'Received from' : 'Paid to'} value={form.party} onChange={set('party')} error={errors.party} maxLength={150} placeholder="Optional" />
        <Input label="Date" type="date" value={form.date} max={today} onChange={set('date')} error={errors.date} />
        <Select label="Payment mode" value={form.paymentMode} onChange={set('paymentMode')} error={errors.paymentMode}>
          {modes.map((m) => (
            <option key={m} value={m}>
              {modeLabel(m)}
            </option>
          ))}
        </Select>
        <Select label={isIn ? 'Into account' : 'From account'} value={form.accountId} onChange={set('accountId')} error={errors.accountId}>
          {usable.length === 0 && <option value="">No {form.paymentMode === 'cash' ? 'cash' : 'bank'} account</option>}
          {usable.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.isDefault ? ' (default)' : ''}
            </option>
          ))}
        </Select>
        <Input
          label="Reference (cheque, UTR, bill no.)"
          value={form.reference}
          onChange={set('reference')}
          error={errors.reference}
          maxLength={100}
          placeholder="Optional"
          className="sm:col-span-2"
        />
        {error && (
          <div className="sm:col-span-2">
            <Notice tone="error">{error}</Notice>
          </div>
        )}
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ transfer

export function TransferModal({
  open,
  accounts,
  today,
  defaultDate,
  onClose,
  onSaved,
}: {
  open: boolean;
  accounts: Account[];
  today: string;
  defaultDate: string;
  onClose: () => void;
  onSaved: (r: { voucherNo: string; amount: string; out: LedgerEntry; in: LedgerEntry }) => void;
}) {
  const active = accounts.filter((a) => a.isActive);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const cash = active.find((a) => a.defaultFor === 'cash') ?? active.find((a) => a.type === 'cash');
    const bank = active.find((a) => a.defaultFor === 'bank') ?? active.find((a) => a.type !== 'cash');
    setFrom(cash?.id ?? active[0]?.id ?? '');
    setTo(bank?.id ?? active[1]?.id ?? '');
    setAmount('');
    setDate(defaultDate > today ? today : defaultDate);
    setDescription('');
    setReference('');
    setErrors({});
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fromAcc = active.find((a) => a.id === from);
  const toAcc = active.find((a) => a.id === to);
  const kind = fromAcc && toAcc ? (fromAcc.type === 'cash' && toAcc.type !== 'cash' ? 'Cash deposit' : fromAcc.type !== 'cash' && toAcc.type === 'cash' ? 'Cash withdrawal' : 'Transfer') : 'Transfer';
  const overdraw = fromAcc?.balance !== undefined && RUPEES.test(cleanAmount(amount)) && paise(cleanAmount(amount)) > paise(fromAcc.balance);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const e: Record<string, string> = {};
    const amt = cleanAmount(amount);
    if (!from) e.fromAccountId = 'Choose an account';
    if (!to) e.toAccountId = 'Choose an account';
    if (from && to && from === to) e.toAccountId = 'Choose a different account';
    if (!RUPEES.test(amt) || Number(amt) <= 0) e.amount = 'Enter an amount in rupees';
    if (!date) e.date = 'Required';
    else if (date > today) e.date = 'Cannot be in the future';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<{ data: { voucherNo: string; amount: string; out: LedgerEntry; in: LedgerEntry } }>('POST', '/accounts/transfer', {
        fromAccountId: from,
        toAccountId: to,
        amount: amt,
        date,
        description: description.trim() || undefined,
        reference: reference.trim() || undefined,
      });
      onSaved(res.data);
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
      title="Transfer between accounts"
      description="Cash deposited in the bank, cash withdrawn, or bank to bank. Not income or expense."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="transfer-form" loading={busy}>
            Save {kind.toLowerCase()}
          </Button>
        </>
      }
    >
      <form id="transfer-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-start">
        <Select label="From" value={from} onChange={(e) => setFrom(e.target.value)} error={errors.fromAccountId}>
          {active.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <ArrowRight className="mx-auto hidden h-5 w-5 text-slate-400 sm:mt-8 sm:block" aria-hidden />
        <Select label="To" value={to} onChange={(e) => setTo(e.target.value)} error={errors.toAccountId}>
          {active.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <div className="grid gap-4 sm:col-span-3 sm:grid-cols-2">
          <Input
            label="Amount (₹)"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            error={errors.amount}
            hint={fromAcc?.balance !== undefined ? `${fromAcc.name} balance today: ${formatInr(fromAcc.balance)}` : undefined}
            placeholder="50000"
          />
          <Input label="Date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} error={errors.date} />
          <Input label="Description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={255} placeholder={`Default: ${kind}`} />
          <Input label="Reference (deposit slip, cheque)" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} placeholder="Optional" />
        </div>
        {overdraw && (
          <div className="sm:col-span-3">
            <Notice tone="warn">This is more than {fromAcc?.name} holds today. Check the amount before saving.</Notice>
          </div>
        )}
        {error && (
          <div className="sm:col-span-3">
            <Notice tone="error">{error}</Notice>
          </div>
        )}
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ delete

export function DeleteEntryModal({ entry, onClose, onDeleted }: { entry: LedgerEntry | null; onClose: () => void; onDeleted: (e: LedgerEntry) => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setReason('');
    setError(null);
    setFieldError(null);
  }, [entry]);
  if (!entry) return null;
  const isTransfer = entry.source === 'transfer';
  const isExpense = entry.source === 'expense';

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (reason.trim().length < 3) {
      setFieldError('Say why, in a few words (at least 3 characters)');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiSend('DELETE', `/ledger/${entry!.id}`, { reason: reason.trim() });
      onDeleted(entry!);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      size="sm"
      onClose={busy ? () => undefined : onClose}
      title={isTransfer ? 'Delete this transfer?' : 'Delete this entry?'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" type="submit" form="delete-entry-form" loading={busy}>
            Delete
          </Button>
        </>
      }
    >
      <form id="delete-entry-form" onSubmit={submit} noValidate className="space-y-3 text-sm">
        <div className="rounded-lg border border-line bg-surface-muted/60 p-3">
          <p className="font-medium">{entry.description}</p>
          <p className="mt-0.5 text-slate-500 dark:text-slate-400">
            {entry.voucherNo} · {formatDate(entry.date)} · {entry.direction === 'in' ? 'In' : 'Out'} {formatInr(entry.amount)} · {entry.account.name}
          </p>
        </div>
        <p className="text-slate-600 dark:text-slate-300">
          {isTransfer
            ? 'Both sides of the transfer are removed. '
            : isExpense
              ? 'It is also removed from the Expenses page. '
              : ''}
          The voucher number is kept in the audit trail with your reason.
        </p>
        <Textarea label="Reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} error={fieldError} maxLength={255} placeholder="e.g. Entered twice" />
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ account add / edit

export function AccountModal({
  open,
  account,
  today,
  onClose,
  onSaved,
}: {
  open: boolean;
  account: Account | null;
  today: string;
  onClose: () => void;
  onSaved: (a: Account) => void;
}) {
  const editing = Boolean(account);
  const [name, setName] = useState('');
  const [type, setType] = useState<Account['type']>('bank');
  const [details, setDetails] = useState('');
  const [opening, setOpening] = useState('0');
  const [openingDate, setOpeningDate] = useState(today);
  const [isActive, setIsActive] = useState(true);
  const [makeDefault, setMakeDefault] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(account?.name ?? '');
    setType(account?.type ?? 'bank');
    setDetails(account?.details ?? '');
    setOpening(account ? String(Number(account.openingBalance)) : '0');
    setOpeningDate(account?.openingDate ?? today);
    setIsActive(account?.isActive ?? true);
    setMakeDefault(false);
    setErrors({});
    setError(null);
  }, [open, account, today]);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const e: Record<string, string> = {};
    const ob = cleanAmount(opening);
    if (name.trim().length < 2) e.name = 'At least 2 characters';
    if (!RUPEES.test(ob)) e.openingBalance = 'Enter an amount in rupees (0 if none)';
    if (!openingDate) e.openingDate = 'Required';
    else if (account?.firstEntryDate && openingDate > account.firstEntryDate) e.openingDate = `Entries start on ${formatDate(account.firstEntryDate)}; pick that day or earlier`;
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setError(null);
    try {
      const res = account
        ? await apiSend<{ data: Account }>('PATCH', `/accounts/${account.id}`, {
            name: name.trim(),
            details: details.trim() || null,
            openingBalance: ob,
            openingDate,
            ...(isActive !== account.isActive && { isActive }),
            ...(makeDefault && { isDefault: true }),
          })
        : await apiSend<{ data: Account }>('POST', '/accounts', {
            name: name.trim(),
            type,
            details: details.trim() || undefined,
            openingBalance: ob,
            openingDate,
            isDefault: makeDefault,
          });
      onSaved(res.data);
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
      title={editing ? `Edit ${account?.name}` : 'Add account'}
      description="The opening balance is what the account held at the start of the opening date."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="account-form" loading={busy}>
            {editing ? 'Save changes' : 'Add account'}
          </Button>
        </>
      }
    >
      <form id="account-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} maxLength={100} placeholder="e.g. SBI Current A/c" />
        <Select label="Type" value={type} onChange={(e) => setType(e.target.value as Account['type'])} disabled={editing} hint={editing ? 'The type cannot change once created.' : undefined}>
          <option value="cash">Cash</option>
          <option value="bank">Bank account</option>
          <option value="upi">UPI / wallet</option>
        </Select>
        <Input label="Details" value={details} onChange={(e) => setDetails(e.target.value)} maxLength={150} placeholder="Bank, branch, last 4 digits" className="sm:col-span-2" />
        <Input label="Opening balance (₹)" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} error={errors.openingBalance} />
        <Input label="As of" type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} error={errors.openingDate} />
        <div className="space-y-2 sm:col-span-2">
          {!(account?.isDefault) && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />
              <span>
                Make this the default {(account?.type ?? type) === 'cash' ? 'cash' : 'bank'} account
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  Fee receipts and expenses paid {(account?.type ?? type) === 'cash' ? 'in cash' : 'by UPI, card, cheque or transfer'} post here automatically.
                </span>
              </span>
            </label>
          )}
          {editing && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={isActive} disabled={account?.isDefault} onChange={(e) => setIsActive(e.target.checked)} />
              <span>
                Active
                {account?.isDefault && <span className="block text-xs text-slate-500 dark:text-slate-400">The default account stays active. Make another one the default first.</span>}
              </span>
            </label>
          )}
        </div>
        {error && (
          <div className="sm:col-span-2">
            <Notice tone="error">{error}</Notice>
          </div>
        )}
      </form>
    </Modal>
  );
}

/** Small "posted automatically" marker for fee entries. */
export function AutoBadge({ entry }: { entry: LedgerEntry }) {
  if (entry.source === 'fee_receipt') return <Badge tone="indigo">{entry.online ? 'Online fee' : 'Fee receipt'}</Badge>;
  if (entry.source === 'fee_refund' || entry.source === 'fee_cancel') return <Badge tone="amber">{entry.source === 'fee_cancel' ? 'Receipt cancelled' : 'Refund'}</Badge>;
  if (entry.source === 'transfer') return <Badge>Transfer</Badge>;
  return null;
}

export function LockedHint() {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-slate-400" title="Posted from fee collection. Cancel or refund the receipt there.">
      <Lock className="h-3.5 w-3.5" aria-hidden />
      <span className="sr-only">Posted from fee collection</span>
    </span>
  );
}
