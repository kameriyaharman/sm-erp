import { createHash } from 'node:crypto';
import { AppError } from '../../errors/AppError.js';
import { logger } from '../../utils/logger.js';
import { pool } from '../../db/pool.js';
import { getRazorpay, paymentsConfig } from './index.js';
import { matchTenantWebhook } from './gateway.js';
import { renderReceiptPdf } from './receipt-pdf.js';
import * as service from './payments.service.js';
import * as settingsRepo from './gateway-settings.repository.js';
import { NS, invalidate } from '../../cache/cache.js';

export async function createOrder(req, res) {
  const { order, replayed } = await service.createOrder({
    auth: req.auth,
    input: req.valid.body,
    idempotencyKey: req.valid.headers['idempotency-key'],
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

function rawBodyOf(req) {
  const raw = req.body;
  if (!Buffer.isBuffer(raw) || raw.length === 0) throw AppError.badRequest('Expected a raw JSON body', undefined, 'INVALID_BODY');
  return raw;
}

function parseEvent(raw) {
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw AppError.badRequest('Malformed JSON body', undefined, 'INVALID_JSON');
  }
}

// Razorpay sends a unique x-razorpay-event-id per event (the same id on every retry).
// Fall back to a hash of the signed body so dedupe still works if it is ever missing.
const eventIdOf = (req, raw) => req.get('x-razorpay-event-id') || `sha256:${createHash('sha256').update(raw).digest('hex')}`;

async function applyEvent(req, res, raw, scope) {
  const body = parseEvent(raw);
  const eventId = eventIdOf(req, raw);
  const result = await service.handleWebhook({ eventId, body, logger, scope });
  if (result.receiptId && result.outcome !== 'already_paid') await invalidate(NS.FEES, result.tenantId);
  logger.info('Payment webhook', { eventId, event: body.event, outcome: result.outcome, receiptId: result.receiptId, tenantId: scope.tenantId ?? undefined });
  res.json({ status: result.outcome });
}

/**
 * Legacy webhook for the platform account (RAZORPAY_* env vars): /finance/webhook.
 * Mounted with express.raw() so the signature is checked against the exact bytes Razorpay
 * signed. Responds 2xx only after the database transaction has committed; any failure returns
 * 5xx and Razorpay retries. Only reaches orders made with the platform account.
 */
export async function webhook(req, res) {
  const razorpay = getRazorpay();
  if (!razorpay.configured) throw new AppError(503, 'PAYMENTS_DISABLED', 'Payments are not configured');
  const raw = rawBodyOf(req);
  if (!razorpay.verifyWebhookSignature(raw, req.get('x-razorpay-signature'))) {
    logger.warn('Rejected webhook with bad signature', { requestId: req.id, ip: req.ip });
    throw AppError.badRequest('Invalid signature', undefined, 'INVALID_SIGNATURE');
  }
  await applyEvent(req, res, raw, service.webhookScope({ platformKeyId: razorpay.keyId }));
}

/**
 * A school's own webhook: /finance/webhook/:tenantCode (the URL shown in Settings -> Online
 * payments). The signature must match the webhook secret of one of THIS school's saved Razorpay
 * accounts, and the event can only settle that school's orders made with that account.
 */
export async function tenantWebhook(req, res) {
  const raw = rawBodyOf(req);
  const tenant = await settingsRepo.findTenantByCode(pool, req.params.tenantCode);
  if (!tenant) throw AppError.notFound('Unknown school', 'WEBHOOK_NOT_CONFIGURED');
  const match = await matchTenantWebhook(pool, tenant.id, raw, req.get('x-razorpay-signature'));
  if (!match) {
    logger.warn('Rejected school webhook with bad signature', { requestId: req.id, ip: req.ip, tenantId: tenant.id });
    throw AppError.badRequest('Invalid signature', undefined, 'INVALID_SIGNATURE');
  }
  await settingsRepo.touchWebhook(pool, match.settingsId);
  await applyEvent(req, res, raw, service.webhookScope({ tenantId: tenant.id, keyId: match.keyId }));
}
