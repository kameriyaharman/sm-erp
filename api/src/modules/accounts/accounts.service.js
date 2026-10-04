import { randomUUID } from 'node:crypto';
import { pool, withTransaction } from '../../db/pool.js';
import { fromPaise, toPaise } from '../../utils/money.js';
import { logger } from '../../utils/logger.js';
import { assertStaffAccess, conflict, pageMeta, resolveWriteBranch, unprocessable } from '../shared/access.js';
import { insertExpense } from '../expenses/expenses.repository.js';
import {
  dailyRollup, incomeExpenseSummary, openingOn, plainRupees, toCsv, withRunningBalance,
} from './daybook.helpers.js';
import * as repo from './accounts.repository.js';

/**
 * Accounts and the day book. Branch = the caller's branch (branch_admin), or `branchId` /
 * the head office (super_admin), via resolveWriteBranch. All arithmetic is integer paise.
 */

const kindOf = (type) => (type === 'cash' ? 'cash' : 'bank');

async function branchContext(auth, branchId) {
  const scope = await resolveWriteBranch(auth, branchId);
  const ctx = await repo.getBranchContext(pool, scope.branchId);
  return { ...scope, ctx };
}

function mapBranch(ctx) {
  return {
    id: ctx.id,
    name: ctx.branch_name,
    schoolName: ctx.school_name,
    address: [ctx.address_line1, ctx.address_line2, ctx.city, ctx.state, ctx.postal_code].filter(Boolean).join(', ') || null,
    phone: ctx.phone,
  };
}

function mapAccount(a) {
  return {
    id: a.id,
    name: a.name,
    type: a.account_type,
    details: a.details,
    isDefault: Boolean(a.default_for),
    defaultFor: a.default_for,
    isActive: a.is_active,
    openingBalance: a.opening_balance,
    openingDate: a.opening_date,
    ...(a.balance !== undefined && { balance: a.balance }),
    ...(a.entries !== undefined && { entries: a.entries, firstEntryDate: a.first_entry ?? null, lastEntryDate: a.last_entry ?? null }),
  };
}

const FEE_SOURCES = new Set(['fee_receipt', 'fee_refund', 'fee_cancel']);

function mapEntry(e, extra = {}) {
  return {
    id: e.id,
    date: e.entry_date,
    postedAt: e.posted_at,
    voucherNo: e.voucher_no,
    direction: e.direction,
    category: e.category,
    amount: e.amount,
    party: e.party,
    description: e.description,
    paymentMode: e.payment_mode,
    reference: e.reference,
    account: { id: e.account_id, name: e.account_name, type: e.account_type },
    source: e.source,
    online: Boolean(e.payment_order_id),
    links: {
      feeReceiptId: e.fee_receipt_id,
      studentId: e.student_id,
      expenseId: e.expense_id,
      transferId: e.transfer_id,
      paymentOrderId: e.payment_order_id,
      reversesEntryId: e.reverses_entry_id,
    },
    canDelete: !FEE_SOURCES.has(e.source) && !e.deleted_at,
    createdBy: e.created_by_name ? { name: e.created_by_name } : null,
    ...(e.deleted_at && { deleted: { at: e.deleted_at, by: e.deleted_by_name, reason: e.delete_reason } }),
    ...extra,
  };
}

function movementTotals(rows, date) {
  const accounts = rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.account_type,
    isDefault: Boolean(r.default_for),
    isActive: r.is_active,
    openingBalance: toPaise(r.opening_balance),
    openingDate: r.opening_date,
    before: toPaise(r.before),
    in: toPaise(r.total_in),
    out: toPaise(r.total_out),
  }));
  return accounts.map((a) => {
    const opening = openingOn(date, [a]);
    return { ...a, opening, closing: opening + a.in - a.out };
  });
}

const money = (paise) => fromPaise(paise);
const accountSummary = (a) => ({
  account: { id: a.id, name: a.name, type: a.type, isDefault: a.isDefault, isActive: a.isActive },
  opening: money(a.opening),
  in: money(a.in),
  out: money(a.out),
  closing: money(a.closing),
});

async function loadAccountInBranch(db, auth, accountId, branchId, { lock = false } = {}) {
  const account = await repo.getAccount(db, accountId, { lock });
  // Another branch's account is "not found", even for an owner who can see both branches.
  assertStaffAccess(auth, account?.branch_id === branchId ? account : null, 'Account not found', 'ACCOUNT_NOT_FOUND');
  return account;
}

async function loadAccount(db, auth, accountId, { lock = false } = {}) {
  const account = await repo.getAccount(db, accountId, { lock });
  assertStaffAccess(auth, account, 'Account not found', 'ACCOUNT_NOT_FOUND');
  return account;
}

/** Mode and account must agree: cash goes in the cash box, everything else through a bank / UPI account. */
function assertModeFits(account, paymentMode) {
  const wantsCash = paymentMode === 'cash';
  if (wantsCash !== (account.account_type === 'cash')) {
    throw unprocessable(
      'MODE_ACCOUNT_MISMATCH',
      wantsCash ? `Cash must go to a cash account, not “${account.name}”` : `A ${paymentMode.replace('_', ' ')} payment cannot go to the cash account “${account.name}”`,
      { accountId: account.id, paymentMode },
    );
  }
}

function assertDateInBook(account, date, today) {
  if (date > today) throw unprocessable('FUTURE_DATE', 'The date cannot be in the future', { date });
  if (date < account.opening_date) {
    throw unprocessable('BEFORE_OPENING_DATE', `“${account.name}” starts on ${account.opening_date}; pick a later date or move its opening date back`, {
      accountId: account.id,
      openingDate: account.opening_date,
    });
  }
}

// =====================================================================
// Accounts
// =====================================================================

export async function listAccounts(auth, { branchId }) {
  const { ctx } = await branchContext(auth, branchId);
  const rows = await repo.listAccounts(pool, ctx.id);
  const total = rows.filter((r) => r.is_active).reduce((s, r) => s + toPaise(r.balance), 0);
  return { data: rows.map(mapAccount), meta: { branch: mapBranch(ctx), today: ctx.today, totalBalance: money(total) } };
}

export async function createAccount(auth, input) {
  const { tenantId, branchId } = await resolveWriteBranch(auth, input.branchId);
  const id = await withTransaction(async (db) => {
    const kind = kindOf(input.type);
    if (input.isDefault) await repo.clearDefault(db, branchId, kind);
    try {
      return await repo.insertAccount(db, {
        tenantId,
        branchId,
        name: input.name,
        type: input.type,
        details: input.details,
        defaultFor: input.isDefault ? kind : null,
        openingBalance: fromPaise(input.openingBalance),
        openingDate: input.openingDate,
        createdBy: auth.userId,
      });
    } catch (err) {
      if (err.code === '23505') throw conflict('ACCOUNT_EXISTS', `An account named “${input.name}” already exists`);
      throw err;
    }
  });
  logger.info('Account created', { accountId: id, by: auth.userId });
  return mapAccount(await repo.getAccount(pool, id));
}

export async function updateAccount(auth, id, input) {
  await withTransaction(async (db) => {
    const account = await loadAccount(db, auth, id, { lock: true });
    if (input.openingDate && account.first_entry && input.openingDate > account.first_entry) {
      throw unprocessable('OPENING_AFTER_ENTRIES', `This account has entries from ${account.first_entry}; the opening date must be on or before that`, {
        firstEntryDate: account.first_entry,
      });
    }
    if (input.isActive === false && account.default_for) {
      throw unprocessable('DEFAULT_ACCOUNT', 'Make another account the default before deactivating this one');
    }
    if (input.isDefault && !(input.isActive ?? account.is_active)) {
      throw unprocessable('ACCOUNT_INACTIVE', 'An inactive account cannot be the default');
    }
    let defaultFor;
    if (input.isDefault && !account.default_for) {
      defaultFor = kindOf(account.account_type);
      await repo.clearDefault(db, account.branch_id, defaultFor);
    }
    try {
      await repo.updateAccount(db, id, {
        name: input.name,
        details: input.details === undefined ? undefined : input.details ?? null,
        openingBalance: input.openingBalance === undefined ? undefined : fromPaise(input.openingBalance),
        openingDate: input.openingDate,
        isActive: input.isActive,
        defaultFor,
      });
    } catch (err) {
      if (err.code === '23505') throw conflict('ACCOUNT_EXISTS', `An account named “${input.name}” already exists`);
      throw err;
    }
  });
  return mapAccount(await repo.getAccount(pool, id));
}

// =====================================================================
// Day book
// =====================================================================

export async function dayBook(auth, { date, accountId, branchId }) {
  const { ctx } = await branchContext(auth, branchId);
  const day = date ?? ctx.today;
  if (accountId) await loadAccountInBranch(pool, auth, accountId, ctx.id);
  const [movements, rows] = await Promise.all([
    repo.accountMovements(pool, { branchId: ctx.id, accountId, from: day, to: day }),
    repo.entriesBetween(pool, { branchId: ctx.id, accountId, from: day, to: day }),
  ]);
  const accounts = movementTotals(movements, day);
  const opening = accounts.reduce((s, a) => s + a.opening, 0);
  const book = withRunningBalance(opening, rows.map((r) => ({ row: r, direction: r.direction, amount: toPaise(r.amount) })));
  return {
    data: {
      date: day,
      today: ctx.today,
      branch: mapBranch(ctx),
      accountId: accountId ?? null,
      opening: money(book.opening),
      totalIn: money(book.totalIn),
      totalOut: money(book.totalOut),
      closing: money(book.closing),
      entries: book.entries.map((e) => mapEntry(e.row, { in: money(e.in), out: money(e.out), balance: money(e.balance) })),
      // Accounts not opened yet on this day (or inactive and idle) are left out.
      byAccount: accounts.filter((a) => a.in || a.out || (a.openingDate <= day && (a.isActive || a.opening))).map(accountSummary),
    },
  };
}

export async function dayBookRange(auth, { from, to, accountId, branchId }) {
  const { ctx } = await branchContext(auth, branchId);
  if (accountId) await loadAccountInBranch(pool, auth, accountId, ctx.id);
  const [movements, totals] = await Promise.all([
    repo.accountMovements(pool, { branchId: ctx.id, accountId, from, to }),
    repo.dailyTotals(pool, { branchId: ctx.id, accountId, from, to }),
  ]);
  const accounts = movementTotals(movements, from);
  const openedOn = new Map();
  for (const a of accounts) {
    if (a.openingDate > from && a.openingDate <= to) openedOn.set(a.openingDate, (openedOn.get(a.openingDate) ?? 0) + a.openingBalance);
  }
  const rollup = dailyRollup({
    from,
    to,
    opening: accounts.reduce((s, a) => s + a.opening, 0),
    totals: new Map(totals.map((t) => [t.date, { in: toPaise(t.total_in), out: toPaise(t.total_out), count: t.entries }])),
    openedOn,
  });
  return {
    data: {
      from,
      to,
      today: ctx.today,
      branch: mapBranch(ctx),
      accountId: accountId ?? null,
      opening: money(rollup.opening),
      totalIn: money(rollup.totalIn),
      totalOut: money(rollup.totalOut),
      closing: money(rollup.closing),
      days: rollup.days.map((d) => ({ date: d.date, opening: money(d.opening), in: money(d.in), out: money(d.out), closing: money(d.closing), entries: d.entries })),
      byAccount: accounts.map((a) => {
        const closing = a.opening + (a.openingDate > from && a.openingDate <= to ? a.openingBalance : 0) + a.in - a.out;
        return accountSummary({ ...a, closing });
      }),
    },
  };
}

export async function listLedger(auth, { branchId, ...filters }) {
  const { ctx } = await branchContext(auth, branchId);
  if (filters.accountId) await loadAccountInBranch(pool, auth, filters.accountId, ctx.id);
  const { rows, totals } = await repo.listLedger(pool, { ...filters, branchId: ctx.id });
  return {
    data: rows.map((r) => mapEntry(r)),
    meta: pageMeta(filters, totals.n, { totalIn: totals.total_in, totalOut: totals.total_out, branch: mapBranch(ctx) }),
  };
}

const CATEGORY_LABEL = (c) => c.replace(/_/g, ' ').replace(/\b\w/g, (x) => x.toUpperCase());

export async function exportCsv(auth, { from, to, accountId, branchId }) {
  const { ctx } = await branchContext(auth, branchId);
  let accountName = 'All accounts';
  if (accountId) accountName = (await loadAccountInBranch(pool, auth, accountId, ctx.id)).name;
  const [movements, rows] = await Promise.all([
    repo.accountMovements(pool, { branchId: ctx.id, accountId, from, to }),
    repo.entriesBetween(pool, { branchId: ctx.id, accountId, from, to }),
  ]);
  const accounts = movementTotals(movements, from);
  // Accounts whose book starts inside the range join with their opening balance on that day.
  const openings = accounts.filter((a) => a.openingDate > from && a.openingDate <= to);
  const opening = accounts.reduce((s, a) => s + a.opening, 0);

  const lines = [['Date', 'Voucher No', 'Account', 'Category', 'Particulars', 'Party', 'Payment Mode', 'Reference', 'In', 'Out', 'Balance']];
  lines.push([from, '', accountName, '', 'Opening balance', '', '', '', '', '', plainRupees(opening)]);
  let balance = opening;
  let totalIn = 0;
  let totalOut = 0;
  const pending = [...openings].sort((a, b) => (a.openingDate < b.openingDate ? -1 : 1));
  const flushOpenings = (beforeDate) => {
    while (pending.length && pending[0].openingDate <= beforeDate) {
      const a = pending.shift();
      balance += a.openingBalance;
      lines.push([a.openingDate, '', a.name, '', `Opening balance of ${a.name}`, '', '', '', '', '', plainRupees(balance)]);
    }
  };
  for (const r of rows) {
    flushOpenings(r.entry_date);
    const amt = toPaise(r.amount);
    const isIn = r.direction === 'in';
    balance += isIn ? amt : -amt;
    if (isIn) totalIn += amt;
    else totalOut += amt;
    lines.push([
      r.entry_date, r.voucher_no ?? '', r.account_name, CATEGORY_LABEL(r.category), r.description, r.party ?? '',
      CATEGORY_LABEL(r.payment_mode), r.reference ?? '', isIn ? plainRupees(amt) : '', isIn ? '' : plainRupees(amt), plainRupees(balance),
    ]);
  }
  flushOpenings(to);
  lines.push([to, '', accountName, '', 'Total / closing balance', '', '', '', plainRupees(totalIn), plainRupees(totalOut), plainRupees(balance)]);
  const code = String(ctx.code).toLowerCase().replace(/[^a-z0-9-]/g, '');
  return { filename: `daybook-${code}-${from}-to-${to}.csv`, body: `﻿${toCsv(lines)}` };
}

function monthBounds(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

export async function summary(auth, { month, from, to, branchId }) {
  const { ctx } = await branchContext(auth, branchId);
  const range = from ? { from, to } : monthBounds(month ?? ctx.today.slice(0, 7));
  const [totals, movements] = await Promise.all([
    repo.categoryTotals(pool, { branchId: ctx.id, ...range }),
    repo.accountMovements(pool, { branchId: ctx.id, ...range }),
  ]);
  const s = incomeExpenseSummary(totals.map((t) => ({ direction: t.direction, category: t.category, amount: toPaise(t.amount) })));
  const transfers = totals.filter((t) => t.category === 'transfer' && t.direction === 'out').reduce((n, t) => n + toPaise(t.amount), 0);
  const accounts = movementTotals(movements, range.from).map((a) => {
    const closing = a.opening + (a.openingDate > range.from && a.openingDate <= range.to ? a.openingBalance : 0) + a.in - a.out;
    return accountSummary({ ...a, closing });
  });
  return {
    data: {
      month: from ? null : (month ?? ctx.today.slice(0, 7)),
      ...range,
      branch: mapBranch(ctx),
      income: s.income.map((i) => ({ category: i.category, amount: money(i.amount) })),
      expense: s.expense.map((i) => ({ category: i.category, amount: money(i.amount) })),
      feeRefunds: money(s.feeRefunds),
      transfers: money(transfers),
      totalIncome: money(s.totalIncome),
      totalExpense: money(s.totalExpense),
      net: money(s.net),
      byAccount: accounts,
    },
  };
}

// =====================================================================
// Writing to the book
// =====================================================================

/**
 * Manual income ("in") is a ledger entry with its own voucher. A manual expense ("out") is
 * written as an expense row (so the Expenses screen and dashboard see it); the expenses
 * trigger posts it to the ledger in the same transaction.
 */
export async function createEntry(auth, input) {
  const { tenantId, branchId } = await resolveWriteBranch(auth, input.branchId);
  const entryId = await withTransaction(async (db) => {
    const ctx = await repo.getBranchContext(db, branchId);
    let account;
    if (input.accountId) {
      account = await loadAccountInBranch(db, auth, input.accountId, branchId, { lock: true });
      if (!account.is_active) throw unprocessable('ACCOUNT_INACTIVE', `“${account.name}” is inactive`);
    } else {
      const id = await repo.defaultAccountId(db, { tenantId, branchId, kind: input.paymentMode === 'cash' ? 'cash' : 'bank', date: input.date });
      account = await repo.getAccount(db, id, { lock: true });
    }
    assertModeFits(account, input.paymentMode);
    assertDateInBook(account, input.date, ctx.today);

    if (input.direction === 'out') {
      const expenseId = await insertExpense(db, {
        tenantId,
        branchId,
        category: input.category,
        description: input.description,
        amount: fromPaise(input.amount),
        expenseDate: input.date,
        paymentMode: input.paymentMode,
        vendor: input.party,
        reference: input.reference,
        createdBy: auth.userId,
        accountId: account.id,
      });
      return (await repo.getEntryForExpense(db, expenseId)).id;
    }
    return repo.insertEntry(db, {
      tenantId,
      branchId,
      date: input.date,
      direction: 'in',
      accountId: account.id,
      category: input.category,
      amount: fromPaise(input.amount),
      party: input.party,
      description: input.description,
      paymentMode: input.paymentMode,
      reference: input.reference,
      voucherNo: await repo.nextVoucher(db, branchId, input.date),
      source: 'manual',
      createdBy: auth.userId,
    });
  });
  const entry = await repo.getEntry(pool, entryId);
  logger.info('Ledger entry recorded', { entryId, voucherNo: entry.voucher_no, direction: entry.direction, amount: entry.amount, by: auth.userId });
  return mapEntry(entry);
}

export async function deleteEntry(auth, id, { reason }) {
  await withTransaction(async (db) => {
    const owner = await repo.entryOwner(db, id);
    assertStaffAccess(auth, owner, 'Entry not found', 'ENTRY_NOT_FOUND');
    const entry = await repo.getEntry(db, id, { lock: true });
    if (entry.deleted_at) throw conflict('ALREADY_DELETED', 'This entry was already deleted');
    if (FEE_SOURCES.has(entry.source)) {
      throw conflict('FEE_ENTRY_LOCKED', 'Fee receipts and refunds are posted automatically. Cancel or refund the receipt from fee collection instead.');
    }
    if (entry.source === 'expense') {
      await db.query(
        `UPDATE expenses SET deleted_at = now(), deleted_by = $2, delete_reason = $3 WHERE id = $1 AND deleted_at IS NULL`,
        [entry.expense_id, auth.userId, reason],
      );
      return;
    }
    const ids = entry.source === 'transfer' ? await repo.transferLegs(db, entry.transfer_id) : [entry.id];
    await repo.softDeleteEntries(db, { ids, userId: auth.userId, reason });
  });
  logger.info('Ledger entry deleted', { entryId: id, by: auth.userId });
}

export async function transfer(auth, input) {
  const transferId = randomUUID();
  const out = await withTransaction(async (db) => {
    // Lock in a fixed order so two opposite transfers cannot deadlock.
    const [firstId, secondId] = [input.fromAccountId, input.toAccountId].sort();
    const first = await loadAccount(db, auth, firstId, { lock: true });
    const second = await loadAccount(db, auth, secondId, { lock: true });
    const from = first.id === input.fromAccountId ? first : second;
    const to = from === first ? second : first;
    if (from.branch_id !== to.branch_id) throw unprocessable('DIFFERENT_BRANCHES', 'Both accounts must belong to the same branch');
    for (const a of [from, to]) if (!a.is_active) throw unprocessable('ACCOUNT_INACTIVE', `“${a.name}” is inactive`);
    const ctx = await repo.getBranchContext(db, from.branch_id);
    assertDateInBook(from, input.date, ctx.today);
    assertDateInBook(to, input.date, ctx.today);

    const cashIn = to.account_type === 'cash';
    const cashOut = from.account_type === 'cash';
    const description =
      input.description ??
      (cashOut && !cashIn ? `Cash deposited into ${to.name}` : cashIn && !cashOut ? `Cash withdrawn from ${from.name}` : `Transfer from ${from.name} to ${to.name}`);
    const mode = cashIn || cashOut ? 'cash' : 'bank_transfer';
    const voucherNo = await repo.nextVoucher(db, from.branch_id, input.date);
    const common = {
      tenantId: from.tenant_id,
      branchId: from.branch_id,
      date: input.date,
      category: 'transfer',
      amount: fromPaise(input.amount),
      description,
      paymentMode: mode,
      reference: input.reference,
      voucherNo,
      source: 'transfer',
      transferId,
      createdBy: auth.userId,
    };
    const outId = await repo.insertEntry(db, { ...common, direction: 'out', accountId: from.id, party: to.name });
    const inId = await repo.insertEntry(db, { ...common, direction: 'in', accountId: to.id, party: from.name });
    return { outId, inId, voucherNo };
  });
  const [outEntry, inEntry] = await Promise.all([repo.getEntry(pool, out.outId), repo.getEntry(pool, out.inId)]);
  logger.info('Transfer recorded', { transferId, voucherNo: out.voucherNo, amount: outEntry.amount, by: auth.userId });
  return { transferId, voucherNo: out.voucherNo, amount: outEntry.amount, date: outEntry.entry_date, out: mapEntry(outEntry), in: mapEntry(inEntry) };
}
