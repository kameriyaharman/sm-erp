import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { ADMINS, STAFF } from '../shared/access.js';
import * as schemas from './timetable.schemas.js';
import * as controller from './timetable.controller.js';

const router = Router();
router.use(authenticate);

router.get('/', authorize(STAFF), validate({ query: schemas.getQuery }), controller.getTimetable);
router.put('/', authorize(ADMINS), validate({ body: schemas.putBody }), controller.putTimetable);

export default router;
