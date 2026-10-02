import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { ADMINS } from '../shared/access.js';
import { idParams } from '../shared/schemas.js';
import * as schemas from './staff.schemas.js';
import * as controller from './staff.controller.js';
import * as assignments from '../assignments/assignments.controller.js';
import { putBody as assignmentsBody } from '../assignments/assignments.schemas.js';

const router = Router();
router.use(authenticate, authorize(ADMINS));

router.get('/', validate({ query: schemas.listQuery }), controller.listStaff);
router.post('/', validate({ body: schemas.createBody }), controller.createStaff);
router.patch('/:id', validate({ params: idParams, body: schemas.updateBody }), controller.updateStaff);

// Subjects a teacher teaches, per section (current academic year).
router.get('/:id/assignments', validate({ params: idParams }), assignments.getStaffAssignments);
router.put('/:id/assignments', validate({ params: idParams, body: assignmentsBody }), assignments.putStaffAssignments);

export default router;
