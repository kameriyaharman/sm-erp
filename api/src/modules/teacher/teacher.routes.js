import { Router } from 'express';
import { ROLES } from '../../config/roles.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import * as exams from '../exams/exams.controller.js';
import * as assignments from '../assignments/assignments.controller.js';

/** /teacher: the signed-in teacher's own classes, subjects, papers and week. */
const router = Router();
router.use(authenticate, authorize(ROLES.TEACHER));

router.get('/assignments', assignments.teacherAssignments);
router.get('/timetable', assignments.teacherTimetable);
router.get('/papers', exams.listTeacherPapers);

export default router;
