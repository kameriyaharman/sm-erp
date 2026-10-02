import { createHash } from 'node:crypto';
import { AppError } from '../../errors/AppError.js';
import { logger } from '../../utils/logger.js';
import { getRazorpay, paymentsConfig } from './index.js';
import { renderReceiptPdf } from './receipt-pdf.js';
import * as service from './payments.service.js';
import { NS, invalidate } from '../../cache/cache.js';

export async function createOrder(req, res) {
  const { order, replayed } = await service.createOrder({
    auth: req.auth,
    input: req.valid.body,
    idempotencyKey: req.valid.headers['idempotency-key'],
    razorpay: getRazorpay(),
    config: paymentsConfig,
  });
  res.status(replayed ? 200 : 201).set('Idempotent-Replayed', String(replayed)).json({ data: order });
}

export async function getOrder(req, res) {
  res.set('Cache-Control', 'no-store').json({ data: await service.getOrderStatus(req.auth, req.valid.params.orderId) });
}

export async function getReceiptPdf(req, res) {
  const receipt = await service.getReceiptForPdf(req.auth, req.valid.params.receiptId);
  const fileName = `receipt-${receipt.receipt_number.replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`;
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${fileName}"`,
    'Cache-Control': 'private, no-store',
  });
  renderReceiptPdf(receipt, res);
}

/**
 * Razorpay webhook. Mounted with express.raw() so the signature is checked
 * against the exact bytes Razorpay signed. Responds 2xx only after the database
 * transaction has committed; any failure returns 5xx and Razorpay retries.
 */
export async function webhook(req, res) {
  const razorpay = getRazorpay();
  if (!razorpay.configured) throw new AppError(503, 'PAYMENTS_DISABLED', 'Payments are not configured');

  const raw = req.body;
  if (!Buffer.isBuffer(raw) || raw.length === 0) throw AppError.badRequest('Expected a raw JSON body', undefined, 'INVALID_BODY');

  if (!razorpay.verifyWebhookSignature(raw, req.get('x-razorpay-signature'))) {
    logger.warn('Rejected webhook with bad signature', { requestId: req.id, ip: req.ip });
    throw AppError.badRequest('Invalid signature', undefined, 'INVALID_SIGNATURE');
  }

  let body;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    throw AppError.badRequest('Malformed JSON body', undefined, 'INVALID_JSON');
  }

  // Razorpay sends a unique x-razorpay-event-id per event (the same id on every retry).
  // Fall back to a hash of the signed body so dedupe still works if it is ever missing.
  const eventId = req.get('x-razorpay-event-id') || `sha256:${createHash('sha256').update(raw).digest('hex')}`;

  const result = await service.handleWebhook({ eventId, body, logger });
  if (result.receiptId && result.outcome !== 'already_paid') await invalidate(NS.FEES, result.tenantId);
  logger.info('Payment webhook', { eventId, event: body.event, outcome: result.outcome, receiptId: result.receiptId });
  res.json({ status: result.outcome });
}
