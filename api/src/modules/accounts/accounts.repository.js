/**
 * SQL for accounts and the day book (ledger_entries). Money columns leave as numeric
 * strings; the service converts them to paise. Every query is limited to one branch.
 */

export async function getBranchContext(db, branchId) {
  const { rows } = await db.query(
    `SELECT b.id, b.tenant_id, b.name AS branch_name, b.code, b.address_line1, b.address_line2, b.city, b.state, b.postal_code, b.phone,
            t.name AS school_name, t.timezone, (now() AT TIME ZONE t.timezone)::date AS today
       FROM branches b JOIN tenants t ON t.id = b.tenant_id
      WHERE b.id = $1`,
    [branchId],
  );
  return rows[0] ?? null;
}

const ACCOUNT_COLUMNS = `a.id, a.tenant_id, a.branch_id, a.name, a.account_type, a.details, a.default_for, a.opening_balance::text,
       a.opening_date, a.is_active, a.created_at`;

/** Accounts of a branch with their current balance (opening + every live entry). */
export async function listAccounts(db, branchId) {
  const { rows } = await db.query(
    `SELECT ${ACCOUNT_COLUMNS},
            (a.opening_balance + COALESCE(m.net, 0))::text AS balance,
            COALESCE(m.entries, 0)::int AS entries,
            m.first_entry, m.last_entry
       FROM accounts a
       LEFT JOIN LATERAL (
            SELECT sum(CASE WHEN le.direction = 'in' THEN le.amount ELSE -le.amount END) AS net,
                   count(*) AS entries, min(le.entry_date) AS first_entry, max(le.entry_date) AS last_entry
              FROM ledger_entries le
             WHERE le.account_id = a.id AND le.deleted_at IS NULL
       ) m ON true
      WHERE a.branch_id = $1
      ORDER BY a.is_active DESC, (a.default_for IS NULL), a.account_type, a.name`,
    [branchId],
  );
  return rows;
}

export async function getAccount(db, id, { lock = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${ACCOUNT_COLUMNS},
            (SELECT min(le.entry_date) FROM ledger_entries le WHERE le.account_id = a.id AND le.deleted_at IS NULL) AS first_entry
       FROM accounts a WHERE a.id = $1 ${lock ? 'FOR UPDATE OF a' : ''}`,
    [id],
  );
  return rows[0] ?? null;
}

export async function insertAccount(db, a) {
  const { rows } = await db.query(
    `INSERT INTO accounts (tenant_id, branch_id, name, account_type, details, default_for, opening_balance, opening_date, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [a.tenantId, a.branchId, a.name, a.type, a.details ?? null, a.defaultFor ?? null, a.openingBalance, a.openingDate, a.createdBy],
  );
  return rows[0].id;
}

export async function clearDefault(db, branchId, kind) {
  await db.query(`UPDATE accounts SET default_for = NULL WHERE branch_id = $1 AND default_for = $2`, [branchId, kind]);
}

export async function updateAccount(db, id, patch) {
  const sets = [];
  const params = [id];
  const add = (column, value) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };
  if (patch.name !== undefined) add('name', patch.name);
  if (patch.details !== undefined) add('details', patch.details);
  if (patch.openingBalance !== undefined) add('opening_balance', patch.openingBalance);
  if (patch.openingDate !== undefined) add('opening_date', patch.openingDate);
  if (patch.isActive !== undefined) add('is_active', patch.isActive);
  if (patch.defaultFor !== undefined) add('default_for', patch.defaultFor);
  if (sets.length === 0) return;
  await db.query(`UPDATE accounts SET ${sets.join(', ')} WHERE id = $1`, params);
}

/** The branch's default cash/bank account (created on first use, like the automatic postings). */
export async function defaultAccountId(db, { tenantId, branchId, kind, date }) {
  const { rows } = await db.query(`SELECT ledger_default_account($1, $2, $3, $4::date) AS id`, [tenantId, branchId, kind, date]);
  return rows[0].id;
}

export async function nextVoucher(db, branchId, date) {
  const { rows } = await db.query(`SELECT ledger_next_voucher($1, $2::date) AS voucher`, [branchId, date]);
  return rows[0].voucher;
}

/**
 * Per account of the branch (or one account): opening balance + date, net of live entries
 * dated before `from`, and money in / out between `from` and `to`.
 */
export async function accountMovements(db, { branchId, accountId, from, to }) {
  const { rows } = await db.query(
    `SELECT a.id, a.name, a.account_type, a.default_for, a.is_active, a.opening_balance::text, a.opening_date,
            COALESCE(sum(CASE WHEN le.direction = 'in' THEN le.amount ELSE -le.amount END) FILTER (WHERE le.entry_date < $3), 0)::text AS before,
            COALESCE(sum(le.amount) FILTER (WHERE le.direction = 'in'  AND le.entry_date >= $3), 0)::text AS total_in,
            COALESCE(sum(le.amount) FILTER (WHERE le.direction = 'out' AND le.entry_date >= $3), 0)::text AS total_out
       FROM accounts a
       LEFT JOIN ledger_entries le ON le.account_id = a.id AND le.deleted_at IS NULL AND le.entry_date <= $4
      WHERE a.branch_id = $1 AND ($2::uuid IS NULL OR a.id = $2)
      GROUP BY a.id
      ORDER BY (a.default_for IS NULL), a.account_type, a.name`,
    [branchId, accountId ?? null, from, to],
  );
  return rows;
}

const ENTRY_SELECT = `
  SELECT le.id, le.entry_date, le.posted_at, le.direction, le.category, le.amount::text, le.party, le.description,
         le.payment_mode, le.reference, le.voucher_no, le.source, le.fee_receipt_id, le.expense_id, le.transfer_id,
         le.fee_transaction_id, le.reverses_entry_id, le.created_at, le.deleted_at, le.delete_reason,
         a.id AS account_id, a.name AS account_name, a.account_type,
         fr.student_id,
         (SELECT o.id FROM payment_orders o WHERE o.receipt_id = le.fee_receipt_id AND le.source = 'fee_receipt' LIMIT 1) AS payment_order_id,
         NULLIF(concat_ws(' ', cu.first_name, cu.last_name), '') AS created_by_name,
         NULLIF(concat_ws(' ', du.first_name, du.last_name), '') AS deleted_by_name
    FROM ledger_entries le
    JOIN accounts a       ON a.id = le.account_id
    LEFT JOIN fee_receipts fr ON fr.id = le.fee_receipt_id
    LEFT JOIN users cu    ON cu.id = le.created_by
    LEFT JOIN users du    ON du.id = le.deleted_by`;

/** Live entries of one day (or a range), in day-book order. */
export async function entriesBetween(db, { branchId, accountId, from, to }) {
  const { rows } = await db.query(
    `${ENTRY_SELECT}
      WHERE le.branch_id = $1 AND le.deleted_at IS NULL AND le.entry_date BETWEEN $3 AND $4
        AND ($2::uuid IS NULL OR le.account_id = $2)
      ORDER BY le.entry_date, le.posted_at, le.created_at, le.id`,
    [branchId, accountId ?? null, from, to],
  );
  return rows;
}

/** In / out / count per day for a range. */
export async function dailyTotals(db, { branchId, accountId, from, to }) {
  const { rows } = await db.query(
    `SELECT le.entry_date AS date,
            COALESCE(sum(le.amount) FILTER (WHERE le.direction = 'in'), 0)::text  AS total_in,
            COALESCE(sum(le.amount) FILTER (WHERE le.direction = 'out'), 0)::text AS total_out,
            count(*)::int AS entries
       FROM ledger_entries le
      WHERE le.branch_id = $1 AND le.deleted_at IS NULL AND le.entry_date BETWEEN $3 AND $4
        AND ($2::uuid IS NULL OR le.account_id = $2)
      GROUP BY le.entry_date`,
    [branchId, accountId ?? null, from, to],
  );
  return rows;
}

function ledgerFilter(f) {
  const params = [f.branchId, f.from ?? null, f.to ?? null, f.direction ?? null, f.category ?? null, f.accountId ?? null, f.source ?? null,
    f.search ? `%${f.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null, f.includeDeleted === true];
  const where = `le.branch_id = $1
        AND ($9::boolean OR le.deleted_at IS NULL)
        AND ($2::date IS NULL OR le.entry_date >= $2) AND ($3::date IS NULL OR le.entry_date <= $3)
        AND ($4::text IS NULL OR le.direction = $4) AND ($5::text IS NULL OR le.category = $5)
        AND ($6::uuid IS NULL OR le.account_id = $6) AND ($7::text IS NULL OR le.source = $7)
        AND ($8::text IS NULL OR le.party ILIKE $8 OR le.description ILIKE $8 OR le.voucher_no ILIKE $8 OR le.reference ILIKE $8)`;
  return { params, where };
}

export async function listLedger(db, filters) {
  const { params, where } = ledgerFilter(filters);
  const [{ rows }, { rows: [totals] }] = await Promise.all([
    db.query(
      `${ENTRY_SELECT} WHERE ${where}
        ORDER BY le.entry_date DESC, le.posted_at DESC, le.created_at DESC, le.id
        LIMIT $10 OFFSET $11`,
      [...params, filters.limit, (filters.page - 1) * filters.limit],
    ),
    db.query(
      `SELECT count(*)::int AS n,
              COALESCE(sum(le.amount) FILTER (WHERE le.direction = 'in'  AND le.deleted_at IS NULL), 0)::text AS total_in,
              COALESCE(sum(le.amount) FILTER (WHERE le.direction = 'out' AND le.deleted_at IS NULL), 0)::text AS total_out
         FROM ledger_entries le WHERE ${where}`,
      params,
    ),
  ]);
  return { rows, totals };
}

export async function categoryTotals(db, { branchId, from, to }) {
  const { rows } = await db.query(
    `SELECT le.direction, le.category, sum(le.amount)::text AS amount, count(*)::int AS entries
       FROM ledger_entries le
      WHERE le.branch_id = $1 AND le.deleted_at IS NULL AND le.entry_date BETWEEN $2 AND $3
      GROUP BY le.direction, le.category`,
    [branchId, from, to],
  );
  return rows;
}

export async function getEntry(db, id, { lock = false } = {}) {
  const { rows } = await db.query(`${ENTRY_SELECT} WHERE le.id = $1 ${lock ? 'FOR UPDATE OF le' : ''}`, [id]);
  return rows[0] ?? null;
}

export async function getEntryForExpense(db, expenseId) {
  const { rows } = await db.query(`${ENTRY_SELECT} WHERE le.expense_id = $1 AND le.source = 'expense'`, [expenseId]);
  return rows[0] ?? null;
}

/** Branch / tenant of an entry, for the scope check before anything else. */
export async function entryOwner(db, id) {
  const { rows } = await db.query(`SELECT id, tenant_id, branch_id FROM ledger_entries WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function insertEntry(db, e) {
  const { rows } = await db.query(
    `INSERT INTO ledger_entries (tenant_id, branch_id, entry_date, direction, account_id, category, amount, party, description,
                                 payment_mode, reference, voucher_no, source, transfer_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
    [e.tenantId, e.branchId, e.date, e.direction, e.accountId, e.category, e.amount, e.party ?? null, e.description,
      e.paymentMode, e.reference ?? null, e.voucherNo, e.source, e.transferId ?? null, e.createdBy],
  );
  return rows[0].id;
}

export async function softDeleteEntries(db, { ids, userId, reason }) {
  await db.query(
    `UPDATE ledger_entries SET deleted_at = now(), deleted_by = $2, delete_reason = $3 WHERE id = ANY ($1) AND deleted_at IS NULL`,
    [ids, userId, reason],
  );
}

export async function transferLegs(db, transferId) {
  const { rows } = await db.query(`SELECT id FROM ledger_entries WHERE transfer_id = $1 FOR UPDATE`, [transferId]);
  return rows.map((r) => r.id);
}
