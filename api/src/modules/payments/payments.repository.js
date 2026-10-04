import { pool } from '../../db/pool.js';

// ---------------------------------------------------------------- access

/** Is this parent user a parent/guardian of the student? */
export async function isGuardianOf(db, parentUserId, studentId) {
  const { rows } = await db.query(
    `SELECT 1
       FROM student_profiles sp
      WHERE sp.id = $2 AND sp.deleted_at IS NULL
        AND (sp.parent_id = $1
             OR EXISTS (SELECT 1 FROM student_guardians g WHERE g.student_id = sp.id AND g.guardian_user_id = $1))`,
    [parentUserId, studentId],
  );
  return rows.length > 0;
}

/** Is this user the student themself (student portal login)? */
export async function isStudentSelf(db, userId, studentId) {
  const { rows } = await db.query(
    `SELECT 1 FROM student_profiles WHERE id = $2 AND user_id = $1 AND deleted_at IS NULL`,
    [userId, studentId],
  );
  return rows.length > 0;
}

/** Sample orders of the demo school (scripts/seed-demo-payments.js): never sent to Razorpay. */
export const isDemoGatewayOrder = (gatewayOrderId) => String(gatewayOrderId ?? '').startsWith('order_DEMO');

// ---------------------------------------------------------------- create order

export async function getInvoicesForOrder(db, invoiceIds) {
  const { rows } = await db.query(
    `SELECT i.id, i.invoice_number, i.period_label, i.due_date, i.status, i.tenant_id, i.branch_id, i.student_id,
            i.balance_amount::text AS balance,
            concat_ws(' ', su.first_name, su.last_name) AS student_name, sp.admission_number,
            t.name AS school_name, t.status AS tenant_status, b.name AS branch_name
       FROM fee_invoices i
       JOIN student_profiles sp ON sp.id = i.student_id
       JOIN users su            ON su.id = sp.user_id
       JOIN tenants t           ON t.id = i.tenant_id
       JOIN branches b          ON b.id = i.branch_id
      WHERE i.id = ANY ($1)
      ORDER BY i.due_date, i.issue_date, i.invoice_number`,
    [invoiceIds],
  );
  return rows;
}

export async function getPayerContact(db, userId) {
  const { rows } = await db.query(
    `SELECT concat_ws(' ', first_name, last_name) AS name, phone, email FROM users WHERE id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function findOrderByIdempotencyKey(db, tenantId, key) {
  const { rows } = await db.query(`SELECT id FROM payment_orders WHERE tenant_id = $1 AND idempotency_key = $2`, [tenantId, key]);
  return rows[0]?.id ?? null;
}

export async function insertOrder(db, order) {
  if (!order.items?.length) throw new Error('insertOrder: an order needs at least one invoice line');
  await db.query(
    `INSERT INTO payment_orders
            (id, tenant_id, branch_id, student_id, gateway, gateway_order_id, receipt_ref, amount, currency,
             idempotency_key, created_by, expires_at, gateway_key_id, gateway_mode)
     VALUES ($1, $2, $3, $4, 'razorpay', $5, $6, $7, 'INR', $8, $9, now() + make_interval(mins => $10), $11, $12)`,
    [order.id, order.tenantId, order.branchId, order.studentId, order.gatewayOrderId, order.receiptRef,
      order.amount, order.idempotencyKey ?? null, order.createdBy, order.ttlMinutes, order.gatewayKeyId ?? null, order.gatewayMode ?? null],
  );
  const { rowCount } = await db.query(
    `INSERT INTO payment_order_items (order_id, invoice_id, branch_id, amount)
     SELECT $1, x.invoice_id, $2, x.amount
       FROM jsonb_to_recordset($3::jsonb) AS x(invoice_id uuid, amount numeric)`,
    [order.id, order.branchId, JSON.stringify(order.items)],
  );
  if (rowCount !== order.items.length) throw new Error('insertOrder: invoice lines were not saved');
}

export async function getOrder(db, orderId) {
  const { rows } = await db.query(
    `SELECT o.*, o.amount::text AS amount, r.receipt_number, r.status AS receipt_status, r.cancelled_at AS receipt_cancelled_at,
            COALESCE(json_agg(json_build_object(
                'invoiceId', it.invoice_id, 'invoiceNumber', i.invoice_number, 'periodLabel', i.period_label,
                'amount', it.amount::text, 'invoiceStatus', i.status, 'invoiceBalance', i.balance_amount::text)
              ORDER BY i.due_date, i.invoice_number) FILTER (WHERE it.invoice_id IS NOT NULL), '[]') AS items
       FROM payment_orders o
       LEFT JOIN payment_order_items it ON it.order_id = o.id
       LEFT JOIN fee_invoices i         ON i.id = it.invoice_id
       LEFT JOIN fee_receipts r         ON r.id = o.receipt_id
      WHERE o.id = $1
      GROUP BY o.id, r.receipt_number, r.status, r.cancelled_at`,
    [orderId],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------- webhook (all inside one transaction)

/**
 * Returns the new row id, or null if this event id was already recorded (duplicate delivery).
 * Events on a school's URL are unique per school; the legacy (platform) URL keeps one row per event id.
 */
export async function recordWebhookEvent(db, event) {
  const conflict = event.tenantId
    ? 'ON CONFLICT (gateway, tenant_id, event_id) WHERE tenant_id IS NOT NULL DO NOTHING'
    : 'ON CONFLICT (gateway, event_id) WHERE tenant_id IS NULL DO NOTHING';
  const { rows } = await db.query(
    `INSERT INTO payment_webhook_events
            (gateway, tenant_id, event_id, event_type, gateway_order_id, gateway_payment_id, outcome, payload)
     VALUES ('razorpay', $1, $2, $3, $4, $5, 'received', $6)
     ${conflict}
     RETURNING id`,
    [event.tenantId ?? null, event.eventId, event.eventType, event.orderId ?? null, event.paymentId ?? null, event.payload],
  );
  return rows[0]?.id ?? null;
}

export async function setWebhookOutcome(db, id, outcome, detail, paymentOrderId) {
  await db.query(
    `UPDATE payment_webhook_events SET outcome = $2, detail = left($3, 500), payment_order_id = $4 WHERE id = $1`,
    [id, outcome, detail ?? null, paymentOrderId ?? null],
  );
}

/**
 * Locks the order a webhook refers to, but only inside the webhook's scope (see webhookScope):
 * a school's URL only reaches that school's orders made with the signing account; the legacy URL
 * only reaches platform-account orders.
 */
export async function lockOrderByGatewayId(db, gatewayOrderId, scope) {
  const { rows } = scope.tenantId
    ? await db.query(
      `SELECT o.*, o.amount::text AS amount
         FROM payment_orders o
        WHERE o.gateway = 'razorpay' AND o.gateway_order_id = $1 AND o.tenant_id = $2 AND o.gateway_key_id = $3
        FOR UPDATE OF o`,
      [gatewayOrderId, scope.tenantId, scope.keyId],
    )
    : await db.query(
      `SELECT o.*, o.amount::text AS amount
         FROM payment_orders o
        WHERE o.gateway = 'razorpay' AND o.gateway_order_id = $1 AND (o.gateway_key_id IS NULL OR o.gateway_key_id = $2)
        FOR UPDATE OF o`,
      [gatewayOrderId, scope.platformKeyId ?? null],
    );
  return rows[0] ?? null;
}

export async function markOrderFailed(db, orderId, { paymentId, reason }) {
  await db.query(
    `UPDATE payment_orders SET status = 'failed', failure_reason = left($2, 300)
      WHERE id = $1 AND status IN ('created', 'failed') AND gateway_payment_id IS NULL`,
    [orderId, `${reason} [${paymentId}]`],
  );
}

/** Order items with the invoices' CURRENT balance, invoices locked so nobody else can pay them concurrently. */
export async function lockOrderInvoices(db, orderId) {
  const { rows } = await db.query(
    `SELECT it.invoice_id, it.amount::text AS planned, i.balance_amount::text AS balance, i.status, i.invoice_number,
            i.academic_year_id
       FROM payment_order_items it
       JOIN fee_invoices i ON i.id = it.invoice_id
      WHERE it.order_id = $1
      ORDER BY i.due_date, i.issue_date, i.invoice_number
      FOR UPDATE OF i`,
    [orderId],
  );
  return rows;
}

export async function insertGatewayTransactions(db, { order, receiptId, paymentMode, payment, lines }) {
  await db.query(
    `INSERT INTO fee_transactions
            (tenant_id, branch_id, invoice_id, student_id, receipt_id, txn_type, amount, payment_mode, status,
             completed_at, gateway, gateway_order_id, gateway_payment_id, gateway_status, gateway_fee, gateway_response,
             idempotency_key, remarks)
     SELECT $1, $2, x.invoice_id, $3, $4, 'payment', x.amount, $5::payment_mode, 'success',
            to_timestamp($6), 'razorpay', $7, $8::text, $9, $10, $11::jsonb,
            'rzp:' || $8::text || ':' || x.invoice_id, 'Online payment via Razorpay'
       FROM jsonb_to_recordset($12::jsonb) AS x(invoice_id uuid, amount numeric)`,
    [
      order.tenant_id, order.branch_id, order.student_id, receiptId, paymentMode,
      payment.created_at ?? Math.floor(Date.now() / 1000), order.gateway_order_id, payment.id, payment.status,
      payment.fee != null ? payment.fee / 100 : null, JSON.stringify(sanitizePayment(payment)), JSON.stringify(lines),
    ],
  );
}

export async function markOrderPaid(db, orderId, { paymentId, receiptId, reviewReason }) {
  await db.query(
    `UPDATE payment_orders
        SET status = CASE WHEN $4::text IS NULL THEN 'paid' ELSE 'needs_review' END::payment_order_status,
            paid_at = now(), gateway_payment_id = $2, receipt_id = $3, review_reason = $4
      WHERE id = $1`,
    [orderId, paymentId, receiptId, reviewReason ?? null],
  );
}

export async function flagOrderForReview(db, orderId, reason) {
  await db.query(
    `UPDATE payment_orders SET status = 'needs_review', review_reason = left($2, 500) WHERE id = $1`,
    [orderId, reason],
  );
}

/** Keep what reconciliation needs; drop contact details we don't need to store twice. */
function sanitizePayment(p) {
  return {
    id: p.id, order_id: p.order_id, amount: p.amount, currency: p.currency, status: p.status, method: p.method,
    captured: p.captured, bank: p.bank ?? null, wallet: p.wallet ?? null, vpa: p.vpa ?? null, card_id: p.card_id ?? null,
    fee: p.fee ?? null, tax: p.tax ?? null, acquirer_data: p.acquirer_data ?? null, created_at: p.created_at,
  };
}

// ---------------------------------------------------------------- receipt (for PDF)

export async function getReceiptDocument(receiptId) {
  const { rows } = await pool.query(
    `SELECT r.id, r.tenant_id, r.branch_id, r.student_id, r.receipt_number, r.amount::text AS amount, r.payment_mode,
            r.instrument_number, r.received_at, r.remarks,
            r.status, r.cancelled_at, r.cancel_reason,
            NULLIF(concat_ws(' ', xu.first_name, xu.last_name), '') AS cancelled_by_name,
            t.name AS school_name, t.timezone, b.name AS branch_name, b.address_line1, b.address_line2, b.city, b.state,
            b.postal_code, b.phone AS branch_phone, b.email AS branch_email, b.affiliation_no,
            concat_ws(' ', su.first_name, su.last_name) AS student_name, sp.admission_number, sp.roll_number,
            c.name AS class_name, sec.name AS section_name, ay.name AS academic_year,
            concat_ws(' ', pu.first_name, pu.last_name) AS parent_name,
            concat_ws(' ', cu.first_name, cu.last_name) AS collected_by,
            (SELECT o.gateway_order_id FROM payment_orders o WHERE o.receipt_id = r.id LIMIT 1) AS gateway_order_id,
            (SELECT t2.gateway_payment_id FROM fee_transactions t2 WHERE t2.receipt_id = r.id LIMIT 1) AS gateway_payment_id,
            (SELECT t2.gateway_response->>'method' FROM fee_transactions t2 WHERE t2.receipt_id = r.id LIMIT 1) AS gateway_method,
            (SELECT json_agg(json_build_object(
                     'invoiceNumber', i.invoice_number, 'periodLabel', i.period_label,
                     'heads', (SELECT string_agg(DISTINCT fh.name, ', ') FROM fee_invoice_items ii
                                 JOIN fee_heads fh ON fh.id = ii.fee_head_id WHERE ii.invoice_id = i.id),
                     'applied', t3.amount::text,
                     -- balance as it stood right after THIS receipt, so a reprint later stays true
                     'balanceAfter', (i.net_amount - COALESCE((
                         SELECT sum(CASE WHEN x.txn_type = 'payment' THEN x.amount ELSE -x.amount END)
                           FROM fee_transactions x
                          WHERE x.invoice_id = i.id AND x.status = 'success' AND x.created_at <= t3.created_at), 0))::text)
                   ORDER BY i.due_date, i.invoice_number)
               FROM fee_transactions t3 JOIN fee_invoices i ON i.id = t3.invoice_id
              WHERE t3.receipt_id = r.id AND t3.txn_type = 'payment') AS lines
       FROM fee_receipts r
       JOIN tenants t           ON t.id = r.tenant_id
       JOIN branches b          ON b.id = r.branch_id
       JOIN student_profiles sp ON sp.id = r.student_id
       JOIN users su            ON su.id = sp.user_id
       LEFT JOIN classes c      ON c.id = sp.class_id
       LEFT JOIN sections sec   ON sec.id = sp.section_id
       LEFT JOIN academic_years ay ON ay.id = r.academic_year_id
       LEFT JOIN users pu       ON pu.id = sp.parent_id
       LEFT JOIN users cu       ON cu.id = r.collected_by
       LEFT JOIN users xu       ON xu.id = r.cancelled_by
      WHERE r.id = $1`,
    [receiptId],
  );
  return rows[0] ?? null;
}
