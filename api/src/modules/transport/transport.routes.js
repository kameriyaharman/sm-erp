import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { ADMINS } from '../shared/access.js';
import { idParams } from '../shared/schemas.js';
import * as schemas from './transport.schemas.js';
import * as controller from './transport.controller.js';

const router = Router();
router.use(authenticate, authorize(ADMINS));

router.get('/routes', validate({ query: schemas.listQuery }), controller.listRoutes);
router.post('/routes', validate({ body: schemas.createRouteBody }), controller.createRoute);
router.patch('/routes/:id', validate({ params: idParams, body: schemas.updateRouteBody }), controller.updateRoute);
router.get('/routes/:id/students', validate({ params: idParams, query: schemas.routeStudentsQuery }), controller.listRouteStudents);
router.get('/riders', validate({ query: schemas.ridersQuery }), controller.listRiders);
router.put('/assignments', validate({ body: schemas.assignmentBody }), controller.assignStudent);

export default router;
