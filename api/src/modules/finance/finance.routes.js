import { Router } from 'express';
import { ROLES } from '../../config/roles.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { defaultersQuerySchema } from './finance.schemas.js';
import * as controller from './finance.controller.js';
import { cached } from '../../middleware/cache.js';
import { NS } from '../../cache/cache.js';
import { attachPaymentRoutes } from '../payments/payments.routes.js';

const router = Router();

// Every finance endpoint requires a signed-in user.
router.use(authenticate);

/**
 * GET /api/v1/finance/defaulters
 * Roles: super_admin, branch_admin
 * branch_admin is automatically limited to their own branch (see middleware/scope.js).
 */
router.get(
  '/defaulters',
  authorize(ROLES.SUPER_ADMIN, ROLES.BRANCH_ADMIN),
  validate({ query: defaultersQuerySchema }),
  cached({ namespace: NS.FEES, ttlSeconds: 120 }),
  controller.getDefaulters,
);

// Online fee payments (Razorpay): create-order, order status, receipt PDF.
// The webhook is mounted separately in routes.js because it is not authenticated by JWT.
attachPaymentRoutes(router);

export default router;
