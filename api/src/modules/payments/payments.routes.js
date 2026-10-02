import { Router } from 'express';
import { ROLES } from '../../config/roles.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { pdfLimiter } from '../../middleware/rateLimit.js';
import * as schemas from './payments.schemas.js';
import * as controller from './payments.controller.js';

/**
 * Public (signature-checked) webhook. Mounted at /api/v1/finance/webhook BEFORE the
 * authenticated finance router, with express.raw() applied in app.js.
 */
export const webhookRouter = Router();
webhookRouter.post('/', controller.webhook);

/** Authenticated payment endpoints, attached to the finance router (which runs `authenticate`). */
export function attachPaymentRoutes(router) {
  const payers = authorize(ROLES.PARENT, ROLES.SUPER_ADMIN, ROLES.BRANCH_ADMIN);

  // Start an online payment for one child's invoices. Optional Idempotency-Key header.
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
}
