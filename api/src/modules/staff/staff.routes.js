import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { ADMINS } from '../shared/access.js';
import { idParams } from '../shared/schemas.js';
import * as schemas from './staff.schemas.js';
import * as controller from './staff.controller.js';

const router = Router();
router.use(authenticate, authorize(ADMINS));

router.get('/', validate({ query: schemas.listQuery }), controller.listStaff);
router.post('/', validate({ body: schemas.createBody }), controller.createStaff);
router.patch('/:id', validate({ params: idParams, body: schemas.updateBody }), controller.updateStaff);

export default router;
