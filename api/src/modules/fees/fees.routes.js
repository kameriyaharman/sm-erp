import { Router } from 'express';
import { ROLES } from '../../config/roles.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import * as schemas from './fees.schemas.js';
import * as controller from './fees.controller.js';
import { cached } from '../../middleware/cache.js';
import { NS } from '../../cache/cache.js';

const router = Router();

// Fee management is restricted to school administrators. Rows are further limited
// to the caller's tenant / branch inside the service (resolveBranchScope / assertBranchAccess).
router.use(authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.BRANCH_ADMIN));

// Ledger: every student with total fee, paid, pending
router.get('/students', validate({ query: schemas.listStudentFeesQuery }), cached({ namespace: NS.FEES, ttlSeconds: 60 }), controller.listStudents);

// Open invoices + not-yet-invoiced allocations for one student (Collect fee modal)
router.get('/students/:studentId/dues', validate({ params: schemas.studentParams }), controller.getStudentDues);

// Invoices
router.post('/invoices', validate({ body: schemas.createInvoiceBody }), controller.createInvoice);
// Bill upcoming instalments for a class / section (dryRun = preview). Re-sending bills nothing twice.
router.post('/invoices/bulk', validate({ body: schemas.bulkInvoiceBody }), controller.bulkInvoices);
router.get('/invoices/:invoiceId', validate({ params: schemas.invoiceParams }), controller.getInvoice);

// One-off charge ("extra fee") for one student or a whole class / section: one invoice each.
router.post('/charges', validate({ body: schemas.chargeBody }), controller.createCharges);

// Counter payment -> receipt. Requires an Idempotency-Key header.
router.post(
  '/payments',
  validate({ headers: schemas.idempotencyHeaders, body: schemas.collectPaymentBody }),
  controller.collectPayment,
);

// Cancel a receipt: its invoices become payable again, the day book gets the reversal (migration 016).
router.post(
  '/receipts/:receiptId/cancel',
  validate({ params: schemas.receiptParams, body: schemas.cancelReceiptBody }),
  controller.cancelReceipt,
);

// Paid vs pending analytics
router.get('/analytics', validate({ query: schemas.analyticsQuery }), cached({ namespace: NS.FEES, ttlSeconds: 300 }), controller.getAnalytics);

export default router;
