import { randomUUID } from 'node:crypto';
import { pool, withTransaction } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { ROLES } from '../../config/roles.js';
import { assertBranchAccess } from '../../middleware/scope.js';
import { fromPaise, toPaise } from '../../utils/money.js';
import * as feesRepo from '../fees/fees.repository.js';
import { gatewayForOrder, resolveGateway } from './gateway.js';
import { getRazorpay } from './index.js';
import * as repo from './payments.repository.js';

const MIN_ORDER_PAISE = 100; // Razorpay minimum: Rs 1

/** Events that mean "money is captured for this order". order.paid arrives alongside payment.captured. */
const CAPTURE_EVENTS = new Set(['payment.captured', 'order.paid']);

const unprocessable = (code, message, details) => new AppError(422, code, message, details);

function formatReceiptNumber(branchCode, yearName, sequence) {
  return `${String(branchCode).toUpperCase()}/RCT/${yearName}/${String(sequence).padStart(5, '0')}`;
}

/** Razorpay `method` -> our payment_mode enum. */
export function paymentModeFor(method) {
  switch (method) {
    case 'upi': return 'upi';
    case 'card':
    case 'emi': return 'card';
    case 'netbanking': return 'net_banking';
    case 'wallet': return 'wallet';
    case 'bank_transfer': return 'bank_transfer';
    default: return 'other';
  }
}

/** Who may pay for this student: their parent/guardian, the student themself, or an admin of that branch. */
async function assertCanPayFor(db, auth, student) {
  if (auth.role === ROLES.PARENT || auth.role === ROLES.STUDENT) {
    const mine = auth.role === ROLES.PARENT
      ? await repo.isGuardianOf(db, auth.userId, student.student_id)
      : await repo.isStudentSelf(db, auth.userId, student.student_id);
    if (auth.tenantId !== student.tenant_id || !mine) throw AppError.notFound('Invoice not found', 'INVOICE_NOT_FOUND');
    return;
  }
  assertBranchAccess(auth, { tenantId: student.tenant_id, branchId: student.branch_id }, 'Invoice not found');
}

const isFamily = (auth) => auth.role === ROLES.PARENT || auth.role === ROLES.STUDENT;

/** Key id an order's Checkout must use: the account that created it (platform account for pre-013 orders). */
const checkoutKeyFor = (row) => row.gateway_key_id ?? getRazorpay().keyId;

// =====================================================================
// POST /finance/create-order
// =====================================================================

/**
 * Creates a gateway order for some or all of a student's open invoices.
 * Nothing is posted to the ledger here: the invoice only changes when the
 * signed payment.captured webhook arrives.
 */
export async function createOrder({ auth, input, idempotencyKey, config }) {
  if (idempotencyKey && auth.tenantId) {
    const existing = await repo.findOrderByIdempotencyKey(pool, auth.tenantId, idempotencyKey);
    if (existing) return { order: await getOrderForCheckout(auth, existing), replayed: true };
  }

  const invoices = await repo.getInvoicesForOrder(pool, input.invoiceIds);
  const found = new Set(invoices.map((i) => i.id));
  const missing = input.invoiceIds.filter((id) => !found.has(id));
  if (missing.length > 0) throw AppError.notFound('Invoice not found', 'INVOICE_NOT_FOUND');

  const studentIds = new Set(invoices.map((i) => i.student_id));
  if (studentIds.size > 1) {
    throw unprocessable('MULTIPLE_STUDENTS', 'Pay for one child at a time. These invoices belong to different students.');
  }
  const first = invoices[0];
  await assertCanPayFor(pool, auth, { tenant_id: first.tenant_id, branch_id: first.branch_id, student_id: first.student_id });

  // The school's own Razorpay account (branch override, school default, or the platform account).
  const gateway = await resolveGateway(pool, { tenantId: first.tenant_id, branchId: first.branch_id });
  if (!gateway.enabled) {
    throw new AppError(503, 'PAYMENTS_DISABLED', 'Online payment is not set up for this school yet. Please pay at the school office.');
  }

  const notOpen = invoices.filter((i) => !['unpaid', 'partially_paid'].includes(i.status) || toPaise(i.balance) <= 0);
  if (notOpen.length > 0) {
    throw unprocessable('INVOICES_NOT_PAYABLE', 'Some invoices are already paid or cancelled. Refresh and try again.', {
      invoiceIds: notOpen.map((i) => i.id),
    });
  }

  const totalDue = invoices.reduce((sum, i) => sum + toPaise(i.balance), 0);
  const amount = input.amount ?? totalDue;
  if (amount > totalDue) {
    throw unprocessable('AMOUNT_EXCEEDS_DUE', `Amount is more than the Rs. ${fromPaise(totalDue)} due on the selected invoices`, {
      maxAmount: fromPaise(totalDue),
    });
  }
  if (amount < MIN_ORDER_PAISE) throw unprocessable('AMOUNT_TOO_SMALL', 'The minimum online payment is Rs. 1');
  if (amount < totalDue && isFamily(auth)) {
    if (!gateway.allowPartial) {
      throw unprocessable('PARTIAL_NOT_ALLOWED', 'The school accepts only the full amount online. Pay the full balance, or pay a part at the school office.', {
        amount: fromPaise(totalDue),
      });
    }
    if (amount < gateway.minAmountPaise) {
      throw unprocessable('AMOUNT_TOO_SMALL', `The smallest part payment the school accepts online is Rs. ${fromPaise(gateway.minAmountPaise)}`, {
        minAmount: fromPaise(gateway.minAmountPaise),
      });
    }
  }

  // Oldest due first, same rule as the counter.
  let remaining = amount;
  const items = [];
  for (const inv of invoices) {
    if (remaining === 0) break;
    const applied = Math.min(remaining, toPaise(inv.balance));
    items.push({ invoice_id: inv.id, amount: fromPaise(applied) });
    remaining -= applied;
  }

  const orderId = randomUUID();
  // Razorpay `receipt`: unique, max 40 chars.
  const receiptRef = `sm_${orderId.replace(/-/g, '').slice(0, 30)}`;

  const gatewayOrder = await gateway.client.createOrder({
    amountPaise: amount,
    receipt: receiptRef,
    notes: {
      payment_order_id: orderId,
      tenant_id: first.tenant_id,
      student_id: first.student_id,
      admission_number: String(first.admission_number ?? ''),
      invoices: invoices.map((i) => i.invoice_number).join(', ').slice(0, 256),
    },
  });

  try {
    await withTransaction((db) =>
      repo.insertOrder(db, {
        id: orderId,
        tenantId: first.tenant_id,
        branchId: first.branch_id,
        studentId: first.student_id,
        gatewayOrderId: gatewayOrder.id,
        gatewayKeyId: gateway.keyId,
        gatewayMode: gateway.mode,
        receiptRef,
        amount: fromPaise(amount),
        idempotencyKey: idempotencyKey ?? null,
        createdBy: auth.userId,
        ttlMinutes: config.orderTtlMinutes,
        items,
      }),
    );
  } catch (err) {
    // Two retries with the same key raced: return the one that won.
    if (err.code === '23505' && err.constraint === 'uq_payorders_idempotency') {
      const winner = await repo.findOrderByIdempotencyKey(pool, first.tenant_id, idempotencyKey);
      return { order: await getOrderForCheckout(auth, winner), replayed: true };
    }
    throw err;
  }

  return { order: await getOrderForCheckout(auth, orderId), replayed: false };
}

async function getOrderForCheckout(auth, orderId) {
  const order = await getOrderStatus(auth, orderId);
  const row = await repo.getOrder(pool, orderId);
  const student = (await repo.getInvoicesForOrder(pool, row.items.map((i) => i.invoiceId)))[0];
  const payer = await repo.getPayerContact(pool, auth.userId);
  return {
    ...order,
    // Everything Razorpay Checkout.js needs.
    checkout: {
      key: checkoutKeyFor(row),
      order_id: row.gateway_order_id,
      amount: toPaise(row.amount),
      currency: row.currency,
      name: student?.school_name ?? 'School fees',
      description: `Fees for ${student?.student_name ?? 'student'} (${student?.admission_number ?? ''})`.trim(),
      prefill: { name: payer?.name ?? undefined, email: payer?.email ?? undefined, contact: payer?.phone ?? undefined },
      notes: { payment_order_id: row.id },
    },
  };
}

// =====================================================================
// GET /finance/orders/:orderId  (the app polls this after Checkout closes)
// =====================================================================

export async function getOrderStatus(auth, orderId) {
  const row = await repo.getOrder(pool, orderId);
  if (!row) throw AppError.notFound('Payment not found', 'ORDER_NOT_FOUND');
  try {
    await assertCanPayFor(pool, auth, row);
  } catch {
    throw AppError.notFound('Payment not found', 'ORDER_NOT_FOUND');
  }
  return {
    id: row.id,
    gatewayOrderId: row.gateway_order_id,
    studentId: row.student_id,
    amount: row.amount,
    currency: row.currency,
    // A parent only needs to know "done" vs "still processing"; review details stay with the office.
    status: row.status,
    paidAt: row.paid_at,
    gatewayPaymentId: row.gateway_payment_id,
    receiptId: row.receipt_id,
    receiptNumber: row.receipt_number,
    expiresAt: row.expires_at,
    mode: row.gateway_mode,
    failureReason: row.status === 'failed' ? row.failure_reason : null,
    items: row.items,
  };
}

// =====================================================================
// POST /finance/webhook/:tenantCode  (and the legacy /finance/webhook)
// =====================================================================

/**
 * Which orders a verified webhook may touch:
 *   { tenantId, keyId }   school URL: only that school's orders created with the account that signed it
 *   { platformKeyId }     legacy URL: only orders of the platform (env) account
 * A correctly signed event from one school can therefore never settle another school's order,
 * and a branch's account can't settle an order taken by another branch's account.
 */
export function webhookScope({ tenantId = null, keyId = null, platformKeyId = null }) {
  return tenantId ? { tenantId, keyId } : { tenantId: null, platformKeyId };
}

/**
 * Applies one verified Razorpay webhook. Everything happens in ONE transaction:
 * the event row, the receipt, the transactions (whose trigger updates the
 * invoices) and the order status. A crash or timeout anywhere rolls all of it
 * back and Razorpay's retry starts clean; a retry of an event we did commit is
 * stopped by the unique event id, and a *different* event for the same payment
 * is stopped by the locked order already being paid.
 *
 * Also used by reconcile, with the payment fetched from Razorpay and eventId "reconcile:<payment id>".
 *
 * @returns {{ outcome: string, detail?: string, receiptId?: string, tenantId?: string, orderId?: string }}
 */
export async function handleWebhook({ eventId, body, logger, scope }) {
  const eventType = body?.event;
  const payment = body?.payload?.payment?.entity ?? null;
  const gatewayOrderId = payment?.order_id ?? body?.payload?.order?.entity?.id ?? null;

  return withTransaction(async (db) => {
    const webhookRowId = await repo.recordWebhookEvent(db, {
      tenantId: scope.tenantId,
      eventId,
      eventType: String(eventType ?? 'unknown').slice(0, 60),
      orderId: gatewayOrderId,
      paymentId: payment?.id,
      payload: body,
    });
    if (!webhookRowId) return { outcome: 'duplicate' };

    let tenantId = scope.tenantId;
    const finish = async (outcome, detail, orderId, extra = {}) => {
      await repo.setWebhookOutcome(db, webhookRowId, outcome, detail, orderId);
      if (outcome === 'needs_review' || outcome === 'unknown_order') {
        logger?.warn('Payment webhook needs review', { eventId, outcome, detail, gatewayOrderId, paymentId: payment?.id });
      }
      return { outcome, detail, tenantId, orderId, ...extra };
    };

    if (eventType === 'payment.failed') {
      if (!payment?.id || !gatewayOrderId) return finish('ignored', 'no payment entity / order id in payload');
      const order = await repo.lockOrderByGatewayId(db, gatewayOrderId, scope);
      if (!order) return finish('unknown_order', `no local order for ${gatewayOrderId}`);
      tenantId = order.tenant_id;
      // An order stays payable after a failed attempt (the payer can retry in the same Checkout);
      // a later capture still settles it. Only an open order is marked failed.
      if (order.status === 'created' || order.status === 'failed') {
        const reason = [payment.error_description, payment.error_reason && `(${payment.error_reason})`].filter(Boolean).join(' ') || 'Payment failed';
        await repo.markOrderFailed(db, order.id, { paymentId: payment.id, reason });
        return finish('payment_failed', reason.slice(0, 200), order.id);
      }
      return finish('ignored', `payment failed on a ${order.status} order`, order.id);
    }

    if (!CAPTURE_EVENTS.has(eventType)) return finish('ignored', `event ${eventType}`);
    if (!payment?.id || !gatewayOrderId) return finish('ignored', 'no payment entity / order id in payload');
    if (payment.status !== 'captured') return finish('ignored', `payment status ${payment.status}`);

    // 1. Lock the order (within the webhook's scope). Concurrent deliveries for the same order queue here.
    const order = await repo.lockOrderByGatewayId(db, gatewayOrderId, scope);
    if (!order) return finish('unknown_order', `no local order for ${gatewayOrderId}`);
    tenantId = order.tenant_id;

    if (order.status === 'paid' || order.gateway_payment_id) {
      if (order.gateway_payment_id === payment.id) return finish('already_paid', null, order.id, { receiptId: order.receipt_id });
      // A second, different payment captured against an order we already settled: money to refund.
      await repo.flagOrderForReview(db, order.id, `Second payment ${payment.id} captured on an already settled order (first: ${order.gateway_payment_id}). Refund it.`);
      return finish('needs_review', `duplicate capture ${payment.id}`, order.id);
    }

    const capturedPaise = Number(payment.amount);
    if (payment.currency !== order.currency || capturedPaise !== toPaise(order.amount)) {
      await repo.flagOrderForReview(db, order.id, `Captured ${payment.currency} ${fromPaise(capturedPaise)} but the order is for ${order.currency} ${order.amount}`);
      return finish('needs_review', 'amount/currency mismatch', order.id);
    }

    // 2. Same lock order as the counter (student, then invoices): no deadlocks with a cashier
    //    collecting from the same family at the same moment.
    const student = await feesRepo.getStudentForUpdate(db, order.student_id);
    const invoices = await repo.lockOrderInvoices(db, order.id);

    // 3. Apply what each invoice can still take. If the office collected cash in the
    //    meantime the balance is lower, and the excess is flagged for refund, never
    //    pushed into an overpaid invoice.
    const lines = [];
    let applied = 0;
    for (const inv of invoices) {
      const open = ['unpaid', 'partially_paid'].includes(inv.status) ? Math.max(toPaise(inv.balance), 0) : 0;
      const amount = Math.min(toPaise(inv.planned), open);
      if (amount > 0) {
        lines.push({ invoice_id: inv.invoice_id, amount: fromPaise(amount) });
        applied += amount;
      }
    }
    const excess = capturedPaise - applied;
    const reviewReason = excess > 0
      ? `Rs. ${fromPaise(excess)} of ${payment.id} could not be applied (invoices already settled at the counter). Refund or adjust.`
      : null;

    if (lines.length === 0) {
      await repo.markOrderPaid(db, order.id, { paymentId: payment.id, receiptId: null, reviewReason });
      return finish('needs_review', 'nothing left to apply', order.id);
    }

    // 4. Receipt with a gap-free number (rolls back with everything else).
    const academicYearId = invoices.find((i) => i.invoice_id === lines[0].invoice_id).academic_year_id;
    const year = await feesRepo.resolveAcademicYear(db, { branchId: order.branch_id, academicYearId });
    const sequence = await feesRepo.nextDocumentNumber(db, { branchId: order.branch_id, docType: 'receipt', periodKey: year.name });
    const paymentMode = paymentModeFor(payment.method);
    const testMode = order.gateway_mode === 'test';

    const receiptId = await feesRepo.insertReceipt(db, {
      tenantId: order.tenant_id,
      branchId: order.branch_id,
      studentId: order.student_id,
      academicYearId,
      receiptNumber: formatReceiptNumber(student.branch_code, year.name, sequence),
      amount: fromPaise(applied),
      paymentMode,
      instrumentNumber: payment.id,
      instrumentDate: null,
      bankName: payment.bank ?? payment.wallet ?? null,
      remarks: `Online payment via Razorpay (${payment.method ?? 'unknown'})${testMode ? ' - TEST MODE, no real money' : ''}`,
      collectedBy: null,
      idempotencyKey: `rzp:${payment.id}`,   // second line of defence against a double post
    });

    // 5. Ledger rows. The rollup trigger updates paid_amount and status (paid / partially_paid).
    await repo.insertGatewayTransactions(db, { order, receiptId, paymentMode, payment, lines });

    // 6. Close the order.
    await repo.markOrderPaid(db, order.id, { paymentId: payment.id, receiptId, reviewReason });

    return finish(reviewReason ? 'needs_review' : 'processed', reviewReason, order.id, { receiptId });
  });
}

// =====================================================================
// POST /finance/online-payments/:id/reconcile  (ADMINS)
// =====================================================================

/**
 * For an order whose webhook never arrived (school forgot to add the webhook, wrong secret,
 * outage): ask Razorpay which payments exist on the order and settle a captured one through the
 * same idempotent path as the webhook. Safe to run any number of times.
 */
export async function reconcileOrder({ auth, orderId, logger }) {
  const row = await repo.getOrder(pool, orderId);
  if (!row) throw AppError.notFound('Payment not found', 'ORDER_NOT_FOUND');
  assertBranchAccess(auth, { tenantId: row.tenant_id, branchId: row.branch_id }, 'Payment not found');
  if (repo.isDemoGatewayOrder(row.gateway_order_id)) {
    throw new AppError(409, 'DEMO_ORDER', 'This is a sample record of the demo school; there is nothing at Razorpay to check.');
  }
  if (row.status === 'paid') return { outcome: 'already_paid', message: 'This payment is already settled.', settled: [] };

  const gateway = await gatewayForOrder(pool, row);
  const payments = await gateway.client.fetchOrderPayments(row.gateway_order_id);
  const scope = gateway.source === 'platform'
    ? webhookScope({ platformKeyId: gateway.keyId })
    : webhookScope({ tenantId: row.tenant_id, keyId: row.gateway_key_id });

  const captured = payments.filter((p) => p.status === 'captured').sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0));
  if (captured.length > 0) {
    const settled = [];
    for (const p of captured) {
      const result = await handleWebhook({ eventId: `reconcile:${p.id}`, body: { event: 'payment.captured', payload: { payment: { entity: p } } }, logger, scope });
      settled.push({ paymentId: p.id, outcome: result.outcome, receiptId: result.receiptId ?? null });
    }
    logger?.info('Online payment reconciled', { orderId, by: auth.userId, payments: settled.map((s) => `${s.paymentId}:${s.outcome}`) });
    const after = await repo.getOrder(pool, orderId);
    return {
      outcome: after.status === 'paid' ? 'settled' : after.status,
      message: after.status === 'paid'
        ? `Payment found at Razorpay and settled.${after.receipt_number ? ` Receipt ${after.receipt_number} created.` : ''}`
        : after.status === 'needs_review' ? `Payment found at Razorpay but it needs a check: ${after.review_reason ?? ''}` : 'Payment found at Razorpay.',
      settled,
    };
  }

  const authorized = payments.find((p) => p.status === 'authorized');
  if (authorized) {
    return {
      outcome: 'authorized',
      message: `Payment ${authorized.id} is authorised but not captured. Capture it in the Razorpay Dashboard (or turn on auto-capture), then reconcile again.`,
      settled: [],
    };
  }
  const failed = payments.filter((p) => p.status === 'failed');
  if (failed.length > 0 && ['created', 'failed'].includes(row.status)) {
    const last = failed.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0];
    await repo.markOrderFailed(pool, row.id, { paymentId: last.id, reason: last.error_description || 'Payment failed' });
    return { outcome: 'failed', message: `No successful payment. Last attempt failed: ${last.error_description || 'payment failed'}.`, settled: [] };
  }
  return { outcome: 'no_payment', message: 'Razorpay has no payment on this order. The payer did not complete Checkout.', settled: [] };
}

// =====================================================================
// GET /finance/receipts/:receiptId/pdf
// =====================================================================

export async function getReceiptForPdf(auth, receiptId) {
  const doc = await repo.getReceiptDocument(receiptId);
  if (!doc) throw AppError.notFound('Receipt not found', 'RECEIPT_NOT_FOUND');
  try {
    await assertCanPayFor(pool, auth, doc);
  } catch {
    throw AppError.notFound('Receipt not found', 'RECEIPT_NOT_FOUND');
  }
  return doc;
}
