import { Router } from 'express';
import { ROLES } from '../../config/roles.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import * as schemas from './attendance.schemas.js';
import * as controller from './attendance.controller.js';
import { cached } from '../../middleware/cache.js';
import { NS } from '../../cache/cache.js';

const router = Router();

// Teachers mark their own class; branch/super admins can mark or correct any section in scope.
router.use(authenticate, authorize(ROLES.TEACHER, ROLES.BRANCH_ADMIN, ROLES.SUPER_ADMIN));

// Sections the caller can take attendance for, with today's status
router.get('/sections', validate({ query: schemas.sectionsQuery }), cached({ namespace: NS.ATTENDANCE, ttlSeconds: 30 }), controller.listSections);

// Class list + existing marks for one section and day
router.get('/attendance', validate({ query: schemas.rosterQuery }), controller.getRoster);

// Save the register and notify parents of absent students
router.post('/attendance', validate({ body: schemas.submitAttendanceBody }), controller.submitAttendance);

// Delivery status of parent notifications for a section and day
router.get('/attendance/notifications', validate({ query: schemas.rosterQuery }), controller.listNotifications);

export default router;
