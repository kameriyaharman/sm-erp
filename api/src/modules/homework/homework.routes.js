import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { STAFF } from '../shared/access.js';
import { idParams } from '../shared/schemas.js';
import * as schemas from './homework.schemas.js';
import * as controller from './homework.controller.js';

// Teachers set homework for any section of their branch; parents read it through /parent.
const router = Router();
router.use(authenticate, authorize(STAFF));

router.get('/', validate({ query: schemas.listQuery }), controller.listHomework);
router.post('/', validate({ body: schemas.createBody }), controller.createHomework);
router.delete('/:id', validate({ params: idParams }), controller.deleteHomework);

export default router;
