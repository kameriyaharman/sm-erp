import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { ADMINS } from '../shared/access.js';
import { idParams } from '../shared/schemas.js';
import * as schemas from './notices.schemas.js';
import * as controller from './notices.controller.js';

// Notice board. Every signed-in role reads (filtered by audience in the service); the office posts.
const router = Router();
router.use(authenticate);

router.get('/', validate({ query: schemas.listQuery }), controller.listNotices);
router.post('/', authorize(ADMINS), validate({ body: schemas.createBody }), controller.createNotice);
router.delete('/:id', authorize(ADMINS), validate({ params: idParams }), controller.deleteNotice);

export default router;
