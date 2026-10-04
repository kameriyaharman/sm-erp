import { Router } from 'express';
import { ROLES } from '../../config/roles.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { pdfLimiter } from '../../middleware/rateLimit.js';
import * as schemas from './payments.schemas.js';
import * as controller from './payments.controller.js';
import * as admin from './payments.admin.controller.js';

/**
 * Public (signature-checked) webhooks. Mounted at /api/v1/finance/webhook BEFORE the
 * authenticated finance router, with express.raw() applied in app.js.
 *   POST /finance/webhook               platform account (RAZORPAY_* env vars), legacy
 *   POST /finance/webhook/:tenantCode   a school's own Razorpay account(s) (Settings -> Online payments)
 */
export const webhookRouter = Router();
webhookRouter.post('/', controller.webhook);
webhookRouter.post('/:tenantCode', controller.tenantWebhook);

/** Authenticated payment endpoints, attached to the finance router (which runs `authenticate`). */
export function attachPaymentRoutes(router) {
  const payers = authorize(ROLES.PARENT, ROLES.STUDENT, ROLES.SUPER_ADMIN, ROLES.BRANCH_ADMIN);
  const admins = authorize(ROLES.SUPER_ADMIN, ROLES.BRANCH_ADMIN);

  // Start an online payment for one student's invoices. Optional Idempotency-Key header.
  router.post(
    '/create-order',
    payers,
    validate({ headers: schemas.optionalIdempotencyHeaders, body: schemas.createOrderBody }),
    controller.createOrder,
  );

  // Poll after Checkout closes: created -> paid (webhook) | needs_review.
  router.get('/orders/:orderId', payers, validate({ params: schemas.orderParams }), controller.getOrder);

  // Printable receipt (online or counter). ?download=1 for an attachment.
  router.get('/receipts/:receiptId/pdf', payers, pdfLimiter, validate({ params: schemas.receiptParams }), controller.getReceiptPdf);

  // Admin console (Fees -> Online payments).
  router.get('/online-payments', admins, validate({ query: schemas.onlinePaymentsQuery }), admin.list);
  router.get('/online-payments/summary', admins, validate({ query: schemas.summaryQuery }), admin.summary);
  router.get('/online-payments/:id', admins, validate({ params: schemas.idParams }), admin.detail);
  router.post('/online-payments/:id/reconcile', admins, validate({ params: schemas.idParams }), admin.reconcile);
}

/** Settings -> Online payments: /api/v1/settings/payments (owner: school-wide + branches; branch admin: own branch). */
export const gatewaySettingsRouter = Router();
gatewaySettingsRouter.use(authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.BRANCH_ADMIN));
gatewaySettingsRouter.get('/', admin.getSettings);
gatewaySettingsRouter.put('/', validate({ body: schemas.gatewaySettingsBody }), admin.saveSettings);
gatewaySettingsRouter.post('/test', validate({ body: schemas.gatewayTargetBody }), admin.testSettings);
gatewaySettingsRouter.delete('/', validate({ query: schemas.gatewayTargetQuery }), admin.deleteSettings);
