import { query } from '../../db/pool.js';

const FILTER = `
  e.deleted_at IS NULL
  AND ($1::uuid IS NULL OR e.tenant_id = $1) AND ($2::uuid[] IS NULL OR e.branch_id = ANY ($2))
  AND ($3::date IS NULL OR e.expense_date >= $3) AND ($4::date IS NULL OR e.expense_date <= $4)
  AND ($5::text IS NULL OR e.category = $5)`;

const SELECT = `
  SELECT e.id, e.tenant_id, e.branch_id, e.category, e.description, e.amount::text AS amount, e.expense_date, e.payment_mode,
         e.vendor, e.reference, e.created_at, concat_ws(' ', u.first_name, u.last_name) AS created_by_name
    FROM expenses e
    LEFT JOIN users u ON u.id = e.created_by`;

export async function listExpenses({ scope, from, to, category, page, limit }) {
  const params = [scope.tenantId, scope.branchIds, from ?? null, to ?? null, category ?? null];
  const [{ rows }, { rows: totals }] = await Promise.all([
    query(`${SELECT} WHERE ${FILTER} ORDER BY e.expense_date DESC, e.created_at DESC LIMIT $6 OFFSET $7`, [...params, limit, (page - 1) * limit]),
    query(
      `SELECT e.category, count(*)::int AS n, sum(e.amount)::numeric(14,2)::text AS amount
         FROM expenses e WHERE ${FILTER} GROUP BY e.category ORDER BY sum(e.amount) DESC`,
      params,
    ),
  ]);
  return { rows, totals };
}

export async function getExpense(db, id) {
  const { rows } = await db.query(`${SELECT} WHERE e.id = $1 AND e.deleted_at IS NULL`, [id]);
  return rows[0] ?? null;
}

export async function insertExpense(db, e) {
  const { rows } = await db.query(
    `INSERT INTO expenses (tenant_id, branch_id, category, description, amount, expense_date, payment_mode, vendor, reference, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [e.tenantId, e.branchId, e.category, e.description, e.amount, e.expenseDate, e.paymentMode, e.vendor ?? null, e.reference ?? null, e.createdBy],
  );
  return rows[0].id;
}

export async function softDelete(db, id) {
  await db.query(`UPDATE expenses SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, [id]);
}

/** Start of the earliest current academic year in scope, and today's month (tenant time). */
export async function currentYearWindow(scope) {
  const { rows } = await query(
    `SELECT min(ay.start_date) AS start_date,
            (now() AT TIME ZONE COALESCE(min(t.timezone), 'Asia/Kolkata'))::date AS today
       FROM academic_years ay
       JOIN tenants t ON t.id = ay.tenant_id
      WHERE ay.is_current AND ($1::uuid IS NULL OR ay.tenant_id = $1) AND ($2::uuid[] IS NULL OR ay.branch_id = ANY ($2))`,
    [scope.tenantId, scope.branchIds],
  );
  return rows[0];
}

export async function monthlyTotals(scope, from, to) {
  const { rows } = await query(
    `SELECT to_char(e.expense_date, 'YYYY-MM') AS month, sum(e.amount)::numeric(14,2)::text AS amount
       FROM expenses e
      WHERE ${FILTER}
      GROUP BY 1`,
    [scope.tenantId, scope.branchIds, from, to, null],
  );
  return new Map(rows.map((r) => [r.month, r.amount]));
}
