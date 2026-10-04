import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { ADMINS } from '../shared/access.js';
import { idParams } from '../shared/schemas.js';
import * as schemas from './expenses.schemas.js';
import * as controller from './expenses.controller.js';

const router = Router();
router.use(authenticate, authorize(ADMINS));

router.get('/', validate({ query: schemas.listQuery }), controller.listExpenses);
router.get('/monthly', validate({ query: schemas.monthlyQuery }), controller.monthlyExpenses);
router.post('/', validate({ body: schemas.createBody }), controller.createExpense);
router.delete('/:id', validate({ params: idParams, body: schemas.deleteBody }), controller.deleteExpense);

export default router;
