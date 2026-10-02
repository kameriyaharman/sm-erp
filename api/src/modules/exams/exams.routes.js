import { Router } from 'express';
import { ROLES } from '../../config/roles.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { ADMINS, STAFF } from '../shared/access.js';
import { idParams } from '../shared/schemas.js';
import * as s from './exams.schemas.js';
import * as controller from './exams.controller.js';

/** /exams: exams and their papers. */
export const examsRouter = Router();
examsRouter.use(authenticate);
examsRouter.get('/', authorize(STAFF), validate({ query: s.listQuery }), controller.listExams);
examsRouter.post('/', authorize(ADMINS), validate({ body: s.createExamBody }), controller.createExam);
examsRouter.patch('/:id', authorize(ADMINS), validate({ params: idParams, body: s.updateExamBody }), controller.updateExam);
examsRouter.get('/:id/papers', authorize(STAFF), validate({ params: idParams, query: s.papersQuery }), controller.listPapers);
examsRouter.post('/:id/papers', authorize(ADMINS), validate({ params: idParams, body: s.createPapersBody }), controller.createPapers);

/** /papers: one paper (exam schedule row). */
export const papersRouter = Router();
papersRouter.use(authenticate, authorize(ADMINS));
papersRouter.patch('/:id', validate({ params: idParams, body: s.updatePaperBody }), controller.updatePaper);

/** /marks: marks entry for one paper and section. Teachers: any section of their branch. */
export const marksRouter = Router();
marksRouter.use(authenticate, authorize(STAFF));
marksRouter.get('/', validate({ query: s.marksQuery }), controller.getMarks);
marksRouter.put('/', validate({ body: s.saveMarksBody }), controller.saveMarks);

/** /teacher: teacher shortcuts. */
export const teacherRouter = Router();
teacherRouter.use(authenticate, authorize(ROLES.TEACHER));
teacherRouter.get('/papers', controller.listTeacherPapers);
