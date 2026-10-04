import { pool, withTransaction } from '../../db/pool.js';
import { fromPaise, toPaise } from '../../utils/money.js';
import { assertStaffAccess, pageMeta, resolveWriteBranch, staffScope, unprocessable } from '../shared/access.js';
import * as accountsRepo from '../accounts/accounts.repository.js';
import { monthRange, monthsBetween } from '../shared/school-ops.helpers.js';
import * as repo from './expenses.repository.js';

function mapExpense(e) {
  return {
    id: e.id,
    category: e.category,
    description: e.description,
    amount: e.amount,
    expenseDate: e.expense_date,
    paymentMode: e.payment_mode,
    vendor: e.vendor,
    reference: e.reference,
    createdBy: { name: e.created_by_name || null },
    createdAt: e.created_at,
    // Day book posting (see docs/accounts.md): every expense is an "out" entry with a voucher.
    voucherNo: e.voucher_no ?? null,
    account: e.account_id ? { id: e.account_id, name: e.account_name } : null,
  };
}

export async function listExpenses(auth, { branchId, ...filters }) {
  const scope = await staffScope(auth, { branchId });
  const { rows, totals } = await repo.listExpenses({ scope, ...filters });
  const total = totals.reduce((n, t) => n + t.n, 0);
  const totalAmount = fromPaise(totals.reduce((sum, t) => sum + toPaise(t.amount), 0));
  return {
    data: rows.map(mapExpense),
    meta: pageMeta(filters, total, {
      totalAmount,
      byCategory: totals.map((t) => ({ category: t.category, amount: t.amount })),
    }),
  };
}

/**
 * Records an expense. The expenses trigger posts it to the day book in the same transaction
 * (account = `accountId`, else the branch's Cash account for cash, else its Bank account).
 */
export async function createExpense(auth, input) {
  const { tenantId, branchId } = await resolveWriteBranch(auth, input.branchId);
  const id = await withTransaction(async (db) => {
    const ctx = await accountsRepo.getBranchContext(db, branchId);
    if (input.expenseDate > ctx.today) throw unprocessable('FUTURE_DATE', 'The date cannot be in the future', { expenseDate: input.expenseDate });
    const accountId =
      input.accountId ??
      (await accountsRepo.defaultAccountId(db, { tenantId, branchId, kind: input.paymentMode === 'cash' ? 'cash' : 'bank', date: input.expenseDate }));
    const account = await accountsRepo.getAccount(db, accountId);
    assertStaffAccess(auth, account?.branch_id === branchId ? account : null, 'Account not found', 'ACCOUNT_NOT_FOUND');
    if (!account.is_active) throw unprocessable('ACCOUNT_INACTIVE', `“${account.name}” is inactive`);
    if ((input.paymentMode === 'cash') !== (account.account_type === 'cash')) {
      throw unprocessable('MODE_ACCOUNT_MISMATCH', input.paymentMode === 'cash' ? `Cash must be paid from a cash account, not “${account.name}”` : `This payment cannot come from the cash account “${account.name}”`);
    }
    if (input.expenseDate < account.opening_date) {
      throw unprocessable('BEFORE_OPENING_DATE', `“${account.name}” starts on ${account.opening_date}; pick a later date`, { openingDate: account.opening_date });
    }
    return repo.insertExpense(db, { ...input, accountId, amount: fromPaise(input.amount), tenantId, branchId, createdBy: auth.userId });
  });
  return mapExpense(await repo.getExpense(pool, id));
}

export async function deleteExpense(auth, id, { reason } = {}) {
  const row = await repo.getExpense(pool, id);
  assertStaffAccess(auth, row, 'Expense not found', 'EXPENSE_NOT_FOUND');
  await repo.softDelete(pool, id, { userId: auth.userId, reason: reason ?? 'Deleted from the Expenses page' });
}

/** Month totals for the current academic year up to this month, zero-filled, oldest first (last `months`). */
export async function monthlyExpenses(auth, { months, branchId }) {
  const scope = await staffScope(auth, { branchId });
  const window = await repo.currentYearWindow(scope);
  if (!window?.start_date) return [];
  const today = window.today;
  const list = monthsBetween(window.start_date, today).slice(-months);
  if (list.length === 0) return [];
  const totals = await repo.monthlyTotals(scope, `${list[0]}-01`, monthRange(list.at(-1)).to);
  return list.map((month) => ({ month, amount: totals.get(month) ?? '0.00' }));
}
