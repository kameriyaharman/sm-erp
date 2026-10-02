import { pool } from '../../db/pool.js';
import { fromPaise, toPaise } from '../../utils/money.js';
import { assertStaffAccess, pageMeta, resolveWriteBranch, staffScope } from '../shared/access.js';
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

export async function createExpense(auth, input) {
  const { tenantId, branchId } = await resolveWriteBranch(auth, input.branchId);
  const id = await repo.insertExpense(pool, { ...input, amount: fromPaise(input.amount), tenantId, branchId, createdBy: auth.userId });
  return mapExpense(await repo.getExpense(pool, id));
}

export async function deleteExpense(auth, id) {
  const row = await repo.getExpense(pool, id);
  assertStaffAccess(auth, row, 'Expense not found', 'EXPENSE_NOT_FOUND');
  await repo.softDelete(pool, id);
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
