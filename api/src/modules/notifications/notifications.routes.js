import { Router } from 'express';
import { ROLES } from '../../config/roles.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import * as schemas from './notifications.schemas.js';
import * as controller from './notifications.controller.js';

const router = Router();

router.use(authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.BRANCH_ADMIN));

// Blast a notice to all teachers or parents (202: sends in the background)
router.post('/broadcasts', validate({ body: schemas.broadcastBody }), controller.createBroadcast);

// Send fee-due reminders for split dues now (202), or preview with dryRun
router.post('/fee-reminders/run', validate({ body: schemas.feeRemindersBody }), controller.runFeeReminders);

// Progress of a broadcast or reminder run
router.get('/batches/:batchId', validate({ params: schemas.batchParams }), controller.getBatch);

// Delivery log, e.g. ?status=failed
router.get('/logs', validate({ query: schemas.logsQuery }), controller.getLogs);

// Retry one failed or abandoned message now
router.post('/logs/:id/retry', validate({ params: schemas.idParams }), controller.retryLog);

export default router;
