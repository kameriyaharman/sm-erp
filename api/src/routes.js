import { Router } from 'express';
import academicsRoutes from './modules/academics/attendance.routes.js';
import authRoutes from './modules/auth/auth.routes.js';
import documentRoutes, { verifyRouter } from './modules/documents/documents.routes.js';
import feesRoutes from './modules/fees/fees.routes.js';
import financeRoutes from './modules/finance/finance.routes.js';
import { webhookRouter as paymentWebhook } from './modules/payments/payments.routes.js';
import parentRoutes from './modules/parent/parent.routes.js';
import notificationRoutes from './modules/notifications/notifications.routes.js';

const router = Router();

router.use('/academics', academicsRoutes);
router.use('/auth', authRoutes);
router.use('/documents', documentRoutes);
router.use('/fees', feesRoutes);
router.use('/verify', verifyRouter);
// Before /finance: the finance router authenticates every request, the gateway has no JWT.
router.use('/finance/webhook', paymentWebhook);
router.use('/finance', financeRoutes);
router.use('/notifications', notificationRoutes);
router.use('/parent', parentRoutes);

export default router;
