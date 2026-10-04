import { pool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { assertBranchAccess, resolveBranchScope } from '../../middleware/scope.js';
import { resolveGateway } from './gateway.js';
import { isDemoGatewayOrder } from './payments.repository.js';

/**
 * Admin console for online payments (Fees -> Online payments): every gateway order with its
 * student, status and Razorpay ids, plus summary tiles. "expired" is derived: an order still
 * 'created' after its expiry (the payer closed Checkout or never paid).
 */

const SHOWN_STATUS = `CASE WHEN o.status = 'created' AND o.expires_at < now() THEN 'expired' ELSE o.status::text END`;

function mapRow(r) {
  return {
    id: r.id,
    status: r.shown_status,
    amount: r.amount,
    currency: r.currency,
    mode: r.gateway_mode,
    createdAt: r.created_at,
    paidAt: r.paid_at,
    expiresAt: r.expires_at,
    gatewayOrderId: r.gateway_order_id,
    gatewayPaymentId: r.gateway_payment_id,
    isDemo: isDemoGatewayOrder(r.gateway_order_id),
    receipt: r.receipt_id ? { id: r.receipt_id, number: r.receipt_number, amount: r.receipt_amount } : null,
    reason: r.shown_status === 'needs_review' ? r.review_reason : r.shown_status === 'failed' ? r.failure_reason : null,
    student: {
      id: r.student_id,
      name: r.student_name,
      admissionNumber: r.admission_number,
      classLabel: [r.class_name, r.section_name].filter(Boolean).join(' '),
    },
    branch: { id: r.branch_id, name: r.branch_name },
    paidBy: r.creator_name ? { name: r.creator_name, role: r.creator_role } : null,
  };
}

const BASE_SELECT = `
  SELECT o.id, ${SHOWN_STATUS} AS shown_status, o.amount::text AS amount, o.currency, o.gateway_mode, o.created_at, o.paid_at,
         o.expires_at, o.gateway_order_id, o.gateway_payment_id, o.receipt_id, o.review_reason, o.failure_reason, o.branch_id,
         r.receipt_number, r.amount::text AS receipt_amount,
         sp.id AS student_id, concat_ws(' ', su.first_name, su.last_name) AS student_name, sp.admission_number,
         c.name AS class_name, sec.name AS section_name, b.name AS branch_name,
         NULLIF(concat_ws(' ', cu.first_name, cu.last_name), '') AS creator_name, cu.role AS creator_role
    FROM payment_orders o
    JOIN tenants t            ON t.id = o.tenant_id
    JOIN branches b           ON b.id = o.branch_id
    JOIN student_profiles sp  ON sp.id = o.student_id
    JOIN users su             ON su.id = sp.user_id
    LEFT JOIN classes c       ON c.id = sp.class_id
    LEFT JOIN sections sec    ON sec.id = sp.section_id
    LEFT JOIN fee_receipts r  ON r.id = o.receipt_id
    LEFT JOIN users cu        ON cu.id = o.created_by`;

/** WHERE for the list and its totals: $1 tenant, $2 branches, $3 status ... $8 section (shared by both queries). */
const LIST_FILTER = `
      WHERE ($1::uuid IS NULL OR o.tenant_id = $1) AND ($2::uuid[] IS NULL OR o.branch_id = ANY ($2))
        AND ($3::text IS NULL OR ${SHOWN_STATUS} = $3)
        AND ($4::date IS NULL OR (o.created_at AT TIME ZONE t.timezone)::date >= $4)
        AND ($5::date IS NULL OR (o.created_at AT TIME ZONE t.timezone)::date <= $5)
        AND ($6::text IS NULL OR concat_ws(' ', su.first_name, su.last_name) ILIKE $6 OR sp.admission_number ILIKE $6
             OR o.gateway_order_id ILIKE $6 OR o.gateway_payment_id ILIKE $6 OR r.receipt_number ILIKE $6)
        AND ($7::uuid IS NULL OR sp.class_id = $7)
        AND ($8::uuid IS NULL OR sp.section_id = $8)`;

export async function listOnlinePayments(auth, q) {
  const scope = await resolveBranchScope(auth, { branchId: q.branchId });
  const search = q.search ? `%${q.search.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
  const params = [scope.tenantId, scope.branchIds, q.status ?? null, q.from ?? null, q.to ?? null, search, q.classId ?? null, q.sectionId ?? null];
  const { rows } = await pool.query(
    `${BASE_SELECT}
     ${LIST_FILTER}
      ORDER BY o.created_at DESC, o.id
      LIMIT $9 OFFSET $10`,
    [...params, q.limit, (q.page - 1) * q.limit],
  );
  // Totals over every order matching the filters (not just this page).
  const { rows: [totals] } = await pool.query(
    `SELECT count(*)::int AS total,
            count(r.id)::int AS receipts,
            COALESCE(sum(r.amount), 0)::text AS collected,
            COALESCE(sum(o.amount), 0)::text AS amount
       FROM payment_orders o
       JOIN tenants t           ON t.id = o.tenant_id
       JOIN student_profiles sp ON sp.id = o.student_id
       JOIN users su            ON su.id = sp.user_id
       LEFT JOIN fee_receipts r ON r.id = o.receipt_id
     ${LIST_FILTER}`,
    params,
  );
  return {
    data: rows.map(mapRow),
    meta: {
      page: q.page,
      limit: q.limit,
      total: totals.total,
      totalPages: Math.ceil(totals.total / q.limit),
      totals: { orders: totals.total, amount: totals.amount, receipts: totals.receipts, collected: totals.collected },
    },
  };
}

/** Tiles: collected online today / this month (by receipt), failed this month, needs review, in progress. */
export async function onlinePaymentsSummary(auth, q) {
  const scope = await resolveBranchScope(auth, { branchId: q.branchId });
  const { rows: [s] } = await pool.query(
    `WITH x AS (
       SELECT o.status, o.expires_at, o.created_at, r.amount AS receipt_amount, r.received_at,
              (now() AT TIME ZONE t.timezone)::date AS today, t.timezone
         FROM payment_orders o
         JOIN tenants t ON t.id = o.tenant_id
         LEFT JOIN fee_receipts r ON r.id = o.receipt_id
        WHERE ($1::uuid IS NULL OR o.tenant_id = $1) AND ($2::uuid[] IS NULL OR o.branch_id = ANY ($2))
     )
     SELECT COALESCE(sum(receipt_amount) FILTER (WHERE (received_at AT TIME ZONE timezone)::date = today), 0)::text AS today_amount,
            count(receipt_amount) FILTER (WHERE (received_at AT TIME ZONE timezone)::date = today)::int AS today_count,
            COALESCE(sum(receipt_amount) FILTER (WHERE date_trunc('month', received_at AT TIME ZONE timezone) = date_trunc('month', today::timestamp)), 0)::text AS month_amount,
            count(receipt_amount) FILTER (WHERE date_trunc('month', received_at AT TIME ZONE timezone) = date_trunc('month', today::timestamp))::int AS month_count,
            count(*) FILTER (WHERE status = 'failed' AND date_trunc('month', created_at AT TIME ZONE timezone) = date_trunc('month', today::timestamp))::int AS failed_month,
            count(*) FILTER (WHERE status = 'needs_review')::int AS needs_review,
            count(*) FILTER (WHERE status = 'created' AND expires_at >= now())::int AS in_progress
       FROM x`,
    [scope.tenantId, scope.branchIds],
  );

  // Is online payment on for the caller? (branch admin: their branch; owner: the school-wide account)
  let gateway = { source: 'none', enabled: false, mode: null };
  if (auth.tenantId) {
    const gw = await resolveGateway(pool, { tenantId: auth.tenantId, branchId: q.branchId ?? auth.branchId ?? null });
    gateway = { source: gw.source, enabled: Boolean(gw.enabled), mode: gw.mode ?? null };
  }

  return {
    today: { amount: s.today_amount, count: s.today_count },
    month: { amount: s.month_amount, count: s.month_count },
    failedThisMonth: s.failed_month,
    needsReview: s.needs_review,
    inProgress: s.in_progress,
    gateway,
  };
}

export async function getOnlinePayment(auth, id) {
  const { rows: [row] } = await pool.query(`${BASE_SELECT} WHERE o.id = $1`, [id]);
  if (!row) throw AppError.notFound('Payment not found', 'ORDER_NOT_FOUND');
  const { rows: [meta] } = await pool.query(`SELECT tenant_id, branch_id FROM payment_orders WHERE id = $1`, [id]);
  assertBranchAccess(auth, { tenantId: meta.tenant_id, branchId: meta.branch_id }, 'Payment not found');

  const [items, events] = await Promise.all([
    pool.query(
      `SELECT it.invoice_id, i.invoice_number, i.period_label, it.amount::text AS amount, i.status, i.balance_amount::text AS balance
         FROM payment_order_items it JOIN fee_invoices i ON i.id = it.invoice_id
        WHERE it.order_id = $1 ORDER BY i.due_date, i.invoice_number`,
      [id],
    ).then((r) => r.rows),
    pool.query(
      `SELECT e.event_type, e.outcome, e.detail, e.received_at, e.gateway_payment_id, e.event_id,
              e.payload #>> '{payload,payment,entity,method}' AS method
         FROM payment_webhook_events e
        WHERE e.payment_order_id = $1
        ORDER BY e.received_at`,
      [id],
    ).then((r) => r.rows),
  ]);

  return {
    ...mapRow(row),
    reviewReason: row.review_reason,
    failureReason: row.failure_reason,
    items: items.map((i) => ({
      invoiceId: i.invoice_id, invoiceNumber: i.invoice_number, periodLabel: i.period_label, amount: i.amount, invoiceStatus: i.status, invoiceBalance: i.balance,
    })),
    events: events.map((e) => ({
      type: e.event_type,
      source: e.event_id.startsWith('reconcile:') ? 'reconcile' : 'webhook',
      outcome: e.outcome,
      detail: e.detail,
      paymentId: e.gateway_payment_id,
      method: e.method,
      at: e.received_at,
    })),
    canReconcile: !isDemoGatewayOrder(row.gateway_order_id) && row.shown_status !== 'paid',
  };
}
