import { env } from '../../config/env.js';
import { NS, invalidate } from '../../cache/cache.js';
import { logger } from '../../utils/logger.js';
import * as onlineSvc from './online-payments.service.js';
import * as settings from './gateway-settings.service.js';
import { reconcileOrder } from './payments.service.js';

const noStore = (res) => res.set('Cache-Control', 'private, no-store');

/**
 * Public base URL of the web app (Razorpay calls the webhook through it): PARENT_PORTAL_URL,
 * else the host this request came in on (local development).
 */
function webhookBase(req) {
  if (env.PARENT_PORTAL_URL) return new URL(env.PARENT_PORTAL_URL).origin;
  return `${req.protocol}://${req.get('x-forwarded-host') ?? req.get('host')}`;
}

// ---------------------------------------------------------------- console

export async function list(req, res) {
  noStore(res).json(await onlineSvc.listOnlinePayments(req.auth, req.valid.query));
}

export async function summary(req, res) {
  noStore(res).json({ data: await onlineSvc.onlinePaymentsSummary(req.auth, req.valid.query) });
}

export async function detail(req, res) {
  noStore(res).json({ data: await onlineSvc.getOnlinePayment(req.auth, req.valid.params.id) });
}

export async function reconcile(req, res) {
  const result = await reconcileOrder({ auth: req.auth, orderId: req.valid.params.id, logger });
  if (result.settled?.some((s) => s.receiptId)) await invalidate(NS.FEES, req.auth.tenantId);
  noStore(res).json({ data: { ...result, order: await onlineSvc.getOnlinePayment(req.auth, req.valid.params.id) } });
}

// ---------------------------------------------------------------- settings

export async function getSettings(req, res) {
  noStore(res).json({ data: await settings.getSettings(req.auth, { webhookBase: webhookBase(req) }) });
}

export async function saveSettings(req, res) {
  noStore(res).json({ data: await settings.saveSettings(req.auth, req.valid.body, { webhookBase: webhookBase(req), logger }) });
}

export async function testSettings(req, res) {
  noStore(res).json({ data: await settings.testSettings(req.auth, req.valid.body, { logger }) });
}

export async function deleteSettings(req, res) {
  noStore(res).json({ data: await settings.deleteSettings(req.auth, req.valid.query, { logger }) });
}
