import { pool, withTransaction } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { assertBranchAccess } from '../../middleware/scope.js';
import { fromPaise, toPaise } from '../../utils/money.js';
import { logger } from '../../utils/logger.js';
import * as repo from './fees.repository.js';
import { mapReceipt } from './fees.service.js';

/**
 * POST /fees/receipts/:id/cancel (ADMINS). Undoes a receipt in ONE transaction:
 *
 *   lock student -> lock receipt (re-check status) -> lock the receipt's invoices
 *   -> mark the receipt cancelled      (012 trigger: one day-book "out" entry, source fee_cancel)
 *   -> one 'refund' transaction per payment line, refund_of_id = that payment
 *                                      (002 rollup: paid_amount / status of each invoice recomputed;
 *                                       012 refund posting is capped at 0 because the receipt is
 *                                       already fully reversed, so nothing is posted twice)
 *
 * Successful payment rows are never edited or deleted (trg_fee_transactions_lock_success).
 * Lock order student -> invoices is the same as counter payments and the Razorpay webhook.
 *
 * Online (Razorpay) receipts can only be cancelled as a record: we never call Razorpay's refund
 * API. The caller must send acknowledgeOnlineRefund: true, and the response says what to refund
 * in the Razorpay Dashboard.
 */
export async function cancelReceipt(auth, receiptId, { reason, acknowledgeOnlineRefund = false }) {
  const head = await repo.findReceiptHead(pool, receiptId);
  if (!head) throw AppError.notFound('Receipt not found', 'RECEIPT_NOT_FOUND');
  assertBranchAccess(auth, { tenantId: head.tenant_id, branchId: head.branch_id }, 'Receipt not found');

  const outcome = await withTransaction(async (db) => {
    await repo.getStudentForUpdate(db, head.student_id);
    const receipt = await repo.lockReceipt(db, receiptId);
    if (receipt.status === 'cancelled') {
      throw new AppError(409, 'ALREADY_CANCELLED', `Receipt ${receipt.receipt_number} is already cancelled`, {
        cancelledAt: receipt.cancelled_at,
      });
    }

    const online = Boolean(receipt.order_id || receipt.gateway);
    if (online && !acknowledgeOnlineRefund) {
      throw new AppError(409, 'ONLINE_REFUND_ACK_REQUIRED',
        'This receipt was paid online through Razorpay. Cancelling it only cancels the record here: refund the money in the Razorpay Dashboard yourself. Send acknowledgeOnlineRefund: true to go ahead.',
        { gatewayPaymentId: receipt.gateway_payment_id, amount: receipt.amount });
    }

    const payments = await repo.lockReceiptPaymentLines(db, receipt.id);
    const lines = payments
      .filter((p) => toPaise(p.refundable) > 0)
      .map((p) => ({ payment_id: p.id, invoice_id: p.invoice_id, amount: p.refundable, payment_mode: p.payment_mode }));

    // 1. The receipt (the ledger trigger posts the reversal for whatever of it is not reversed yet).
    await repo.markReceiptCancelled(db, { receiptId: receipt.id, userId: auth.userId, reason });
    // 2. Reverse each payment line; the invoice triggers make them payable again.
    if (lines.length > 0) {
      await repo.insertReversals(db, {
        tenantId: receipt.tenant_id,
        branchId: receipt.branch_id,
        studentId: receipt.student_id,
        receiptId: receipt.id,
        receiptNumber: receipt.receipt_number,
        reason,
        userId: auth.userId,
        lines,
      });
    }

    return {
      receipt,
      online,
      reversed: lines.reduce((sum, l) => sum + toPaise(l.amount), 0),
      invoiceIds: [...new Set(payments.map((p) => p.invoice_id))],
    };
  });

  const [row, invoices, ledger] = await Promise.all([
    repo.getReceipt(pool, receiptId),
    repo.invoicesState(pool, outcome.invoiceIds),
    repo.getCancelLedgerEntry(pool, receiptId),
  ]);
  logger.info('Fee receipt cancelled', {
    receiptNumber: outcome.receipt.receipt_number, amount: outcome.receipt.amount, online: outcome.online, by: auth.userId,
  });

  return {
    tenantId: outcome.receipt.tenant_id,
    receipt: mapReceipt(row),
    reversed: fromPaise(outcome.reversed),
    invoices: invoices.map((i) => ({
      id: i.id, invoiceNumber: i.invoice_number, periodLabel: i.period_label, netAmount: i.net_amount,
      paidAmount: i.paid_amount, balanceAmount: i.balance_amount, status: i.status,
    })),
    ledgerEntry: ledger ? { voucherNo: ledger.voucher_no, amount: ledger.amount, entryDate: ledger.entry_date, account: ledger.account } : null,
    onlineRefund: outcome.online
      ? {
        gateway: 'razorpay',
        gatewayPaymentId: outcome.receipt.gateway_payment_id,
        amount: outcome.receipt.amount,
        message: `Refund Rs. ${outcome.receipt.amount}${outcome.receipt.gateway_payment_id ? ` for payment ${outcome.receipt.gateway_payment_id}` : ''} in the Razorpay Dashboard. SM ERP does not move the money back.`,
      }
      : null,
  };
}
