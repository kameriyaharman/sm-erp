import { query } from '../../db/pool.js';

const OPEN = `('unpaid', 'partially_paid')`;

// =====================================================================
// Student fee ledger (table view)
// =====================================================================

const LIST_SORTS = {
  pending: 'pending DESC, student_name ASC',
  name: 'student_name ASC',
  admission: 'admission_number ASC',
};

const LIST_STATUS_FILTERS = {
  all: 'TRUE',
  pending: 'pending > 0',
  overdue: 'overdue > 0',
  paid: 'pending <= 0 AND total_fee > 0',
};

/**
 * One row per student: total fee for the year (invoiced + not yet invoiced),
 * paid, pending, overdue. Academic year defaults to each branch's current year.
 */
export async function listStudentFees({ scope, filters }) {
  const { academicYearId, classId, sectionId, search, status, sort, page, limit } = filters;
  const like = search ? `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;

  const { rows } = await query(
    `WITH scoped AS (
       SELECT sp.id, sp.branch_id, sp.admission_number, sp.roll_number,
              sp.class_id, sp.section_id, sp.user_id, ay.id AS academic_year_id, ay.name AS academic_year
         FROM student_profiles sp
         JOIN academic_years ay
           ON ay.branch_id = sp.branch_id
          AND CASE WHEN $3::uuid IS NULL THEN ay.is_current ELSE ay.id = $3 END
         JOIN users u ON u.id = sp.user_id
        WHERE sp.deleted_at IS NULL
          AND ($1::uuid   IS NULL OR sp.tenant_id = $1)
          AND ($2::uuid[] IS NULL OR sp.branch_id = ANY ($2))
          AND ($4::uuid   IS NULL OR sp.class_id = $4)
          AND ($5::uuid   IS NULL OR sp.section_id = $5)
          AND ($6::text   IS NULL
               OR concat_ws(' ', u.first_name, u.last_name) ILIKE $6
               OR sp.admission_number ILIKE $6)
     ),
     unbilled AS (
       SELECT a.student_id, sum(a.net_amount) AS amount
         FROM student_fee_allocations a
         JOIN scoped s ON s.id = a.student_id AND s.academic_year_id = a.academic_year_id
        WHERE a.is_active
          AND NOT EXISTS (SELECT 1 FROM fee_invoice_items it WHERE it.allocation_id = a.id)
        GROUP BY a.student_id
     ),
     billed AS (
       SELECT i.student_id,
              sum(i.net_amount)                                                AS invoiced,
              sum(i.paid_amount)                                               AS paid,
              sum(i.balance_amount) FILTER (WHERE i.status IN ${OPEN})         AS open_balance,
              sum(i.balance_amount) FILTER (WHERE i.status IN ${OPEN}
                                              AND i.due_date < CURRENT_DATE)   AS overdue,
              count(*) FILTER (WHERE i.status IN ${OPEN})                      AS open_invoices
         FROM fee_invoices i
         JOIN scoped s ON s.id = i.student_id AND s.academic_year_id = i.academic_year_id
        WHERE i.status <> 'cancelled'
        GROUP BY i.student_id
     ),
     ledger AS (
       SELECT s.*,
              concat_ws(' ', u.first_name, u.last_name)                        AS student_name,
              COALESCE(b.invoiced, 0) + COALESCE(ub.amount, 0)                 AS total_fee,
              COALESCE(b.paid, 0)                                              AS paid,
              COALESCE(b.open_balance, 0) + COALESCE(ub.amount, 0)             AS pending,
              COALESCE(b.overdue, 0)                                           AS overdue,
              COALESCE(ub.amount, 0)                                           AS unbilled,
              COALESCE(b.open_invoices, 0)::int                                AS open_invoices
         FROM scoped s
         JOIN users u          ON u.id = s.user_id
         LEFT JOIN billed b    ON b.student_id = s.id
         LEFT JOIN unbilled ub ON ub.student_id = s.id
     )
     SELECT l.id AS student_id, l.branch_id, l.student_name, l.admission_number, l.roll_number,
            l.academic_year_id, l.academic_year,
            c.id AS class_id, c.name AS class_name, sec.id AS section_id, sec.name AS section_name,
            l.total_fee::text, l.paid::text, l.pending::text, l.overdue::text, l.unbilled::text,
            l.open_invoices,
            count(*) OVER ()             AS total_count,
            (sum(l.total_fee) OVER ())::text AS sum_total,
            (sum(l.paid) OVER ())::text      AS sum_paid,
            (sum(l.pending) OVER ())::text   AS sum_pending
       FROM ledger l
       LEFT JOIN classes c    ON c.id = l.class_id
       LEFT JOIN sections sec ON sec.id = l.section_id
      WHERE ${LIST_STATUS_FILTERS[status]}
      ORDER BY ${LIST_SORTS[sort]}
      LIMIT $7 OFFSET $8`,
    [scope.tenantId, scope.branchIds, academicYearId ?? null, classId ?? null, sectionId ?? null, like, limit, (page - 1) * limit],
  );
  return rows;
}

// =====================================================================
// Student + dues (modal)
// =====================================================================

/** Locks the student row: serialises billing and payments per student. */
export async function getStudentForUpdate(db, studentId) {
  const { rows } = await db.query(
    `SELECT sp.id, sp.tenant_id, sp.branch_id, sp.academic_year_id, sp.admission_number,
            b.code AS branch_code
       FROM student_profiles sp
       JOIN branches b ON b.id = sp.branch_id
      WHERE sp.id = $1 AND sp.deleted_at IS NULL
      FOR UPDATE OF sp`,
    [studentId],
  );
  return rows[0] ?? null;
}

export async function getStudentSummary(db, studentId) {
  const { rows } = await db.query(
    `SELECT sp.id, sp.tenant_id, sp.branch_id, sp.admission_number, sp.roll_number,
            concat_ws(' ', u.first_name, u.last_name) AS student_name,
            c.name AS class_name, s.name AS section_name,
            concat_ws(' ', pu.first_name, pu.last_name) AS parent_name, pu.phone AS parent_phone
       FROM student_profiles sp
       JOIN users u        ON u.id = sp.user_id
       LEFT JOIN classes c ON c.id = sp.class_id
       LEFT JOIN sections s ON s.id = sp.section_id
       LEFT JOIN users pu  ON pu.id = sp.parent_id
      WHERE sp.id = $1 AND sp.deleted_at IS NULL`,
    [studentId],
  );
  return rows[0] ?? null;
}

export async function resolveAcademicYear(db, { branchId, academicYearId, fallbackId }) {
  const { rows } = await db.query(
    `SELECT id, name FROM academic_years
      WHERE branch_id = $1
        AND CASE WHEN $2::uuid IS NOT NULL THEN id = $2
                 WHEN $3::uuid IS NOT NULL THEN id = $3
                 ELSE is_current END
      LIMIT 1`,
    [branchId, academicYearId ?? null, fallbackId ?? null],
  );
  return rows[0] ?? null;
}

const INVOICE_COLUMNS = `
  i.id, i.invoice_number, i.period_label, i.issue_date, i.due_date, i.academic_year_id,
  i.gross_amount::text, i.concession_amount::text, i.fine_amount::text, i.net_amount::text,
  i.paid_amount::text, i.balance_amount::text, i.status, i.fully_paid_at`;

export async function listOpenInvoices(db, studentId) {
  const { rows } = await db.query(
    `SELECT ${INVOICE_COLUMNS},
            (SELECT string_agg(DISTINCT fh.name, ', ' ORDER BY fh.name)
               FROM fee_invoice_items it JOIN fee_heads fh ON fh.id = it.fee_head_id
              WHERE it.invoice_id = i.id) AS heads
       FROM fee_invoices i
      WHERE i.student_id = $1 AND i.status IN ${OPEN}
      ORDER BY i.due_date, i.issue_date, i.invoice_number`,
    [studentId],
  );
  return rows;
}

/** Locked, oldest-due-first open invoices for a payment. */
export async function lockOpenInvoices(db, studentId, invoiceIds) {
  const { rows } = await db.query(
    `SELECT i.id, i.invoice_number, i.academic_year_id, i.balance_amount::text, i.status
       FROM fee_invoices i
      WHERE i.student_id = $1
        AND i.status IN ${OPEN}
        AND ($2::uuid[] IS NULL OR i.id = ANY ($2))
      ORDER BY i.due_date, i.issue_date, i.invoice_number
      FOR UPDATE`,
    [studentId, invoiceIds ?? null],
  );
  return rows;
}

export async function getUnbilledAllocations(db, { studentId, academicYearId, allocationIds, billUpTo, lock = false }) {
  const { rows } = await db.query(
    `SELECT a.id, a.fee_head_id, fh.name AS fee_head, a.installment_no, a.due_date,
            a.base_amount::text, a.concession_amount::text, a.net_amount::text
       FROM student_fee_allocations a
       JOIN fee_heads fh ON fh.id = a.fee_head_id
      WHERE a.student_id = $1
        AND a.academic_year_id = $2
        AND a.is_active
        AND NOT EXISTS (SELECT 1 FROM fee_invoice_items it WHERE it.allocation_id = a.id)
        AND ($3::uuid[] IS NULL OR a.id = ANY ($3))
        AND ($4::date   IS NULL OR a.due_date <= $4)
      ORDER BY a.due_date, fh.display_order, fh.name
      ${lock ? 'FOR UPDATE OF a' : ''}`,
    [studentId, academicYearId, allocationIds ?? null, billUpTo ?? null],
  );
  return rows;
}

export async function findFeeHeads(db, branchId, feeHeadIds) {
  const { rows } = await db.query(
    `SELECT id, name FROM fee_heads WHERE branch_id = $1 AND id = ANY ($2) AND status = 'active'`,
    [branchId, feeHeadIds],
  );
  return rows;
}

// =====================================================================
// Numbering
// =====================================================================

/** Next gap-free number for (branch, type, year). Rolls back with the transaction. */
export async function nextDocumentNumber(db, { branchId, docType, periodKey }) {
  const { rows } = await db.query(
    `INSERT INTO document_sequences (branch_id, doc_type, period_key, last_value)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (branch_id, doc_type, period_key)
     DO UPDATE SET last_value = document_sequences.last_value + 1
     RETURNING last_value`,
    [branchId, docType, periodKey],
  );
  return rows[0].last_value;
}

// =====================================================================
// Writes
// =====================================================================

export async function insertInvoice(db, invoice) {
  const { rows } = await db.query(
    `INSERT INTO fee_invoices
            (tenant_id, branch_id, student_id, academic_year_id, invoice_number,
             period_label, issue_date, due_date, generated_by, notes, charge_batch_id)
     VALUES ($1, $2, $3, $4, $5, $6, LEAST(CURRENT_DATE, $7::date), $7, $8, $9, $10)
     RETURNING id`,
    [
      invoice.tenantId, invoice.branchId, invoice.studentId, invoice.academicYearId, invoice.invoiceNumber,
      invoice.periodLabel ?? null, invoice.dueDate, invoice.generatedBy, invoice.notes ?? null, invoice.chargeBatchId ?? null,
    ],
  );
  return rows[0].id;
}

export async function insertInvoiceItems(db, { tenantId, branchId, invoiceId, items }) {
  // One round trip for all lines; the rollup trigger updates invoice totals.
  await db.query(
    `INSERT INTO fee_invoice_items
            (tenant_id, branch_id, invoice_id, allocation_id, fee_head_id, description, amount, concession_amount)
     SELECT $1, $2, $3, x.allocation_id, x.fee_head_id, x.description, x.amount, x.concession_amount
       FROM jsonb_to_recordset($4::jsonb)
            AS x(allocation_id uuid, fee_head_id uuid, description text, amount numeric, concession_amount numeric)`,
    [tenantId, branchId, invoiceId, JSON.stringify(items)],
  );
}

export async function getInvoiceWithItems(db, invoiceId) {
  const { rows } = await db.query(
    `SELECT ${INVOICE_COLUMNS}, i.tenant_id, i.branch_id, i.student_id, i.notes,
            COALESCE(json_agg(json_build_object(
                'id', it.id, 'feeHeadId', it.fee_head_id, 'feeHead', fh.name,
                'description', it.description, 'allocationId', it.allocation_id,
                'amount', it.amount::text, 'concessionAmount', it.concession_amount::text,
                'netAmount', it.net_amount::text)
              ORDER BY it.created_at, fh.name) FILTER (WHERE it.id IS NOT NULL), '[]') AS items
       FROM fee_invoices i
       LEFT JOIN fee_invoice_items it ON it.invoice_id = i.id
       LEFT JOIN fee_heads fh         ON fh.id = it.fee_head_id
      WHERE i.id = $1
      GROUP BY i.id`,
    [invoiceId],
  );
  return rows[0] ?? null;
}

export async function findReceiptByIdempotencyKey(db, tenantId, key) {
  const { rows } = await db.query(
    `SELECT id FROM fee_receipts WHERE tenant_id = $1 AND idempotency_key = $2`,
    [tenantId, key],
  );
  return rows[0]?.id ?? null;
}

export async function insertReceipt(db, receipt) {
  const { rows } = await db.query(
    `INSERT INTO fee_receipts
            (tenant_id, branch_id, student_id, academic_year_id, receipt_number, amount, payment_mode,
             instrument_number, instrument_date, bank_name, remarks, collected_by, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
    [
      receipt.tenantId, receipt.branchId, receipt.studentId, receipt.academicYearId, receipt.receiptNumber,
      receipt.amount, receipt.paymentMode, receipt.instrumentNumber ?? null, receipt.instrumentDate ?? null,
      receipt.bankName ?? null, receipt.remarks ?? null, receipt.collectedBy, receipt.idempotencyKey,
    ],
  );
  return rows[0].id;
}

export async function insertPaymentTransactions(db, { tenantId, branchId, studentId, receiptId, paymentMode, instrument, collectedBy, lines }) {
  // status = success fires the rollup trigger, which updates paid_amount/status on each invoice.
  await db.query(
    `INSERT INTO fee_transactions
            (tenant_id, branch_id, invoice_id, student_id, receipt_id, txn_type, amount, payment_mode,
             status, completed_at, instrument_number, instrument_date, bank_name, collected_by)
     SELECT $1, $2, x.invoice_id, $3, $4, 'payment', x.amount, $5::payment_mode,
            'success', now(), $6, $7::date, $8, $9
       FROM jsonb_to_recordset($10::jsonb) AS x(invoice_id uuid, amount numeric)`,
    [
      tenantId, branchId, studentId, receiptId, paymentMode,
      instrument.number ?? null, instrument.date ?? null, instrument.bank ?? null, collectedBy,
      JSON.stringify(lines),
    ],
  );
}

export async function getReceipt(db, receiptId) {
  const { rows } = await db.query(
    `SELECT r.id, r.tenant_id, r.branch_id, r.student_id, r.receipt_number, r.amount::text, r.payment_mode,
            r.instrument_number, r.instrument_date, r.bank_name, r.remarks, r.received_at,
            r.status, r.cancelled_at, r.cancel_reason,
            NULLIF(concat_ws(' ', xu.first_name, xu.last_name), '') AS cancelled_by_name,
            concat_ws(' ', cu.first_name, cu.last_name) AS collected_by_name,
            json_agg(json_build_object(
                'invoiceId', i.id, 'invoiceNumber', i.invoice_number, 'periodLabel', i.period_label,
                'amountApplied', t.amount::text, 'invoiceBalance', i.balance_amount::text,
                'invoiceStatus', i.status)
              ORDER BY i.due_date, i.invoice_number) AS applied_to
       FROM fee_receipts r
       JOIN fee_transactions t ON t.receipt_id = r.id AND t.txn_type = 'payment'
       JOIN fee_invoices i     ON i.id = t.invoice_id
       LEFT JOIN users cu      ON cu.id = r.collected_by
       LEFT JOIN users xu      ON xu.id = r.cancelled_by
      WHERE r.id = $1
      GROUP BY r.id, cu.first_name, cu.last_name, xu.first_name, xu.last_name`,
    [receiptId],
  );
  return rows[0] ?? null;
}

// =====================================================================
// Analytics
// =====================================================================

/** All analytics share one scoped CTE: invoices of the chosen (or current) academic year. */
const SCOPED_INVOICES = `
  WITH years AS (
    SELECT ay.id, ay.branch_id
      FROM academic_years ay
      JOIN branches b ON b.id = ay.branch_id AND b.deleted_at IS NULL
     WHERE ($1::uuid   IS NULL OR b.tenant_id = $1)
       AND ($2::uuid[] IS NULL OR ay.branch_id = ANY ($2))
       AND CASE WHEN $3::uuid IS NULL THEN ay.is_current ELSE ay.id = $3 END
  ),
  inv AS (
    SELECT i.*
      FROM fee_invoices i
      JOIN years y ON y.id = i.academic_year_id
     WHERE i.status <> 'cancelled'
  )`;

export async function feeAnalytics({ scope, academicYearId }) {
  const params = [scope.tenantId, scope.branchIds, academicYearId ?? null];

  const [summary, byStatus, byMonth, byClass, byHead, byMode] = await Promise.all([
    query(
      `${SCOPED_INVOICES},
       unbilled AS (
         SELECT COALESCE(sum(a.net_amount), 0) AS amount
           FROM student_fee_allocations a
           JOIN years y ON y.id = a.academic_year_id
          WHERE a.is_active
            AND NOT EXISTS (SELECT 1 FROM fee_invoice_items it WHERE it.allocation_id = a.id)
       )
       SELECT COALESCE(sum(net_amount), 0)::text                                         AS invoiced,
              COALESCE(sum(paid_amount), 0)::text                                        AS collected,
              COALESCE(sum(balance_amount) FILTER (WHERE status IN ${OPEN}), 0)::text    AS pending,
              COALESCE(sum(balance_amount) FILTER (WHERE status IN ${OPEN}
                                                     AND due_date < CURRENT_DATE), 0)::text AS overdue,
              (SELECT amount FROM unbilled)::text                                         AS not_yet_invoiced,
              count(DISTINCT student_id) FILTER (WHERE status IN ${OPEN})::int            AS students_with_dues,
              count(DISTINCT student_id) FILTER (WHERE status IN ${OPEN}
                                                  AND due_date < CURRENT_DATE)::int       AS students_overdue
         FROM inv`,
      params,
    ),
    query(
      `${SCOPED_INVOICES}
       SELECT status, count(*)::int AS invoices,
              sum(net_amount)::text AS amount, sum(paid_amount)::text AS paid, sum(balance_amount)::text AS balance
         FROM inv GROUP BY status ORDER BY status`,
      params,
    ),
    query(
      `${SCOPED_INVOICES},
       billed AS (
         SELECT date_trunc('month', due_date)::date AS month, sum(net_amount) AS amount
           FROM inv GROUP BY 1
       ),
       collected AS (
         SELECT date_trunc('month', t.completed_at AT TIME ZONE tn.timezone)::date AS month,
                sum(CASE WHEN t.txn_type = 'payment' THEN t.amount ELSE -t.amount END) AS amount
           FROM fee_transactions t
           JOIN inv ON inv.id = t.invoice_id
           JOIN tenants tn ON tn.id = t.tenant_id
           LEFT JOIN fee_transactions orig ON orig.id = t.refund_of_id
           LEFT JOIN fee_receipts rr       ON rr.id = COALESCE(orig.receipt_id, t.receipt_id)
          WHERE t.status = 'success'
            -- a cancelled receipt is void: neither its payment nor its reversal counts in any month
            AND rr.status IS DISTINCT FROM 'cancelled'
          GROUP BY 1
       )
       SELECT to_char(m.month, 'YYYY-MM') AS month,
              COALESCE(b.amount, 0)::numeric(12,2)::text AS invoiced,
              COALESCE(c.amount, 0)::numeric(12,2)::text AS collected
         FROM (SELECT month FROM billed UNION SELECT month FROM collected) m
         LEFT JOIN billed b    ON b.month = m.month
         LEFT JOIN collected c ON c.month = m.month
        ORDER BY m.month`,
      params,
    ),
    query(
      `${SCOPED_INVOICES}
       SELECT c.id AS class_id, c.name AS class_name, c.display_order,
              count(DISTINCT inv.student_id)::int AS students,
              sum(inv.net_amount)::text  AS invoiced,
              sum(inv.paid_amount)::text AS collected,
              COALESCE(sum(inv.balance_amount) FILTER (WHERE inv.status IN ${OPEN}), 0)::text AS pending
         FROM inv
         JOIN student_profiles sp ON sp.id = inv.student_id
         LEFT JOIN classes c      ON c.id = sp.class_id
        GROUP BY c.id, c.name, c.display_order
        ORDER BY c.display_order NULLS LAST, c.name`,
      params,
    ),
    query(
      `${SCOPED_INVOICES}
       SELECT fh.id AS fee_head_id, fh.name AS fee_head,
              sum(it.net_amount)::text AS invoiced
         FROM inv
         JOIN fee_invoice_items it ON it.invoice_id = inv.id
         JOIN fee_heads fh         ON fh.id = it.fee_head_id
        GROUP BY fh.id, fh.name
        ORDER BY sum(it.net_amount) DESC`,
      params,
    ),
    query(
      `${SCOPED_INVOICES}
       SELECT t.payment_mode, count(DISTINCT COALESCE(t.receipt_id, t.id))::int AS payments,
              sum(t.amount)::text AS amount
         FROM fee_transactions t
         JOIN inv ON inv.id = t.invoice_id
        WHERE t.status = 'success' AND t.txn_type = 'payment'
          AND NOT EXISTS (SELECT 1 FROM fee_receipts rr WHERE rr.id = t.receipt_id AND rr.status = 'cancelled')
        GROUP BY t.payment_mode
        ORDER BY sum(t.amount) DESC`,
      params,
    ),
  ]);

  return {
    summary: summary.rows[0],
    byStatus: byStatus.rows,
    byMonth: byMonth.rows,
    byClass: byClass.rows,
    byFeeHead: byHead.rows,
    byPaymentMode: byMode.rows,
  };
}

// =====================================================================
// Receipts: list + cancellation (migration 016)
// =====================================================================

const RECEIPT_LIST_COLUMNS = `
  r.id, r.receipt_number, r.amount::text AS amount, r.payment_mode, r.instrument_number, r.received_at, r.remarks,
  r.status, r.cancelled_at, r.cancel_reason,
  NULLIF(concat_ws(' ', cu.first_name, cu.last_name), '') AS collected_by_name,
  NULLIF(concat_ws(' ', xu.first_name, xu.last_name), '') AS cancelled_by_name,
  (EXISTS (SELECT 1 FROM payment_orders o WHERE o.receipt_id = r.id)
   OR EXISTS (SELECT 1 FROM fee_transactions g WHERE g.receipt_id = r.id AND g.gateway IS NOT NULL)) AS online,
  (SELECT g.gateway_payment_id FROM fee_transactions g
    WHERE g.receipt_id = r.id AND g.gateway_payment_id IS NOT NULL LIMIT 1) AS gateway_payment_id,
  COALESCE((SELECT json_agg(json_build_object('invoiceId', i.id, 'invoiceNumber', i.invoice_number,
                                              'periodLabel', i.period_label, 'amount', t.amount::text)
                            ORDER BY i.due_date, i.invoice_number)
              FROM fee_transactions t JOIN fee_invoices i ON i.id = t.invoice_id
             WHERE t.receipt_id = r.id AND t.txn_type = 'payment'), '[]'::json) AS applied_to`;

/** Every receipt of a student (cancelled ones too), newest first. */
export async function listStudentReceipts(db, studentId) {
  const { rows } = await db.query(
    `SELECT ${RECEIPT_LIST_COLUMNS}
       FROM fee_receipts r
       LEFT JOIN users cu ON cu.id = r.collected_by
       LEFT JOIN users xu ON xu.id = r.cancelled_by
      WHERE r.student_id = $1
      ORDER BY r.received_at DESC, r.receipt_number DESC`,
    [studentId],
  );
  return rows;
}

/** Unlocked look-up (to learn the student, whose row is locked first). */
export async function findReceiptHead(db, receiptId) {
  const { rows } = await db.query(
    `SELECT id, tenant_id, branch_id, student_id, receipt_number, status FROM fee_receipts WHERE id = $1`,
    [receiptId],
  );
  return rows[0] ?? null;
}

export async function lockReceipt(db, receiptId) {
  const { rows } = await db.query(
    `SELECT r.id, r.tenant_id, r.branch_id, r.student_id, r.receipt_number, r.amount::text AS amount, r.payment_mode,
            r.status, r.cancelled_at,
            (SELECT o.id FROM payment_orders o WHERE o.receipt_id = r.id LIMIT 1) AS order_id,
            (SELECT g.gateway_payment_id FROM fee_transactions g
              WHERE g.receipt_id = r.id AND g.gateway_payment_id IS NOT NULL LIMIT 1) AS gateway_payment_id,
            (SELECT g.gateway FROM fee_transactions g WHERE g.receipt_id = r.id AND g.gateway IS NOT NULL LIMIT 1) AS gateway
       FROM fee_receipts r
      WHERE r.id = $1
      FOR UPDATE OF r`,
    [receiptId],
  );
  return rows[0] ?? null;
}

/**
 * The receipt's payment lines with what is still un-refunded of each, their invoices locked
 * (same lock order as a payment: student, then invoices).
 */
export async function lockReceiptPaymentLines(db, receiptId) {
  const { rows } = await db.query(
    `SELECT t.id, t.invoice_id, t.amount::text AS amount, t.payment_mode,
            (t.amount - COALESCE((SELECT sum(x.amount) FROM fee_transactions x
                                   WHERE x.refund_of_id = t.id AND x.txn_type = 'refund' AND x.status = 'success'), 0))::text AS refundable,
            i.invoice_number
       FROM fee_transactions t
       JOIN fee_invoices i ON i.id = t.invoice_id
      WHERE t.receipt_id = $1 AND t.txn_type = 'payment' AND t.status = 'success'
      ORDER BY i.due_date, i.invoice_number, t.id
      FOR UPDATE OF i`,
    [receiptId],
  );
  return rows;
}

export async function markReceiptCancelled(db, { receiptId, userId, reason }) {
  await db.query(
    `UPDATE fee_receipts SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3 WHERE id = $1`,
    [receiptId, userId, reason],
  );
}

/** One reversing refund per payment line: the sanctioned way to undo a successful transaction (002). */
export async function insertReversals(db, { tenantId, branchId, studentId, receiptId, receiptNumber, reason, userId, lines }) {
  await db.query(
    `INSERT INTO fee_transactions
            (tenant_id, branch_id, invoice_id, student_id, txn_type, refund_of_id, amount, payment_mode,
             status, completed_at, collected_by, idempotency_key, remarks)
     SELECT $1, $2, x.invoice_id, $3, 'refund', x.payment_id, x.amount, x.payment_mode::payment_mode,
            'success', now(), $4, 'rcpt-cancel:' || $5::text || ':' || x.payment_id, $6
       FROM jsonb_to_recordset($7::jsonb) AS x(payment_id uuid, invoice_id uuid, amount numeric, payment_mode text)`,
    [tenantId, branchId, studentId, userId, receiptId, `Receipt ${receiptNumber} cancelled: ${reason}`.slice(0, 1000), JSON.stringify(lines)],
  );
}

export async function getCancelLedgerEntry(db, receiptId) {
  const { rows } = await db.query(
    `SELECT le.voucher_no, le.amount::text AS amount, le.entry_date, a.name AS account
       FROM ledger_entries le JOIN accounts a ON a.id = le.account_id
      WHERE le.fee_receipt_id = $1 AND le.source = 'fee_cancel'`,
    [receiptId],
  );
  return rows[0] ?? null;
}

export async function invoicesState(db, invoiceIds) {
  const { rows } = await db.query(
    `SELECT ${INVOICE_COLUMNS} FROM fee_invoices i WHERE i.id = ANY ($1) ORDER BY i.due_date, i.invoice_number`,
    [invoiceIds],
  );
  return rows;
}

// =====================================================================
// Bulk billing of upcoming instalments
// =====================================================================

/** Un-invoiced, active allocations of the year due on or before billUpTo, for many students. */
export async function unbilledForStudents(db, { studentIds, academicYearId, billUpTo }) {
  const { rows } = await db.query(
    `SELECT a.id, a.student_id, a.fee_head_id, fh.name AS fee_head, a.installment_no, a.due_date,
            a.base_amount::text, a.concession_amount::text, a.net_amount::text
       FROM student_fee_allocations a
       JOIN fee_heads fh ON fh.id = a.fee_head_id
      WHERE a.student_id = ANY ($1)
        AND a.academic_year_id = $2
        AND a.is_active
        AND a.due_date <= $3
        AND NOT EXISTS (SELECT 1 FROM fee_invoice_items it WHERE it.allocation_id = a.id)
      ORDER BY a.student_id, a.due_date, fh.display_order, fh.name`,
    [studentIds, academicYearId, billUpTo],
  );
  return rows;
}

/** Students of the list who already have every allocation up to billUpTo on an invoice. */
export async function studentsWithBilledAllocations(db, { studentIds, academicYearId, billUpTo }) {
  const { rows } = await db.query(
    `SELECT DISTINCT a.student_id
       FROM student_fee_allocations a
      WHERE a.student_id = ANY ($1) AND a.academic_year_id = $2 AND a.is_active AND a.due_date <= $3
        AND EXISTS (SELECT 1 FROM fee_invoice_items it WHERE it.allocation_id = a.id)`,
    [studentIds, academicYearId, billUpTo],
  );
  return rows.map((r) => r.student_id);
}

/** Open invoices of a student holding these allocations (advance-bill replay). */
export async function openInvoicesForAllocations(db, studentId, allocationIds) {
  const { rows } = await db.query(
    `SELECT DISTINCT it.invoice_id, it.allocation_id, i.status
       FROM fee_invoice_items it JOIN fee_invoices i ON i.id = it.invoice_id
      WHERE i.student_id = $1 AND it.allocation_id = ANY ($2)`,
    [studentId, allocationIds],
  );
  return rows;
}
