import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { ADMINS, STAFF } from '../shared/access.js';
import * as schemas from './school.schemas.js';
import * as controller from './school.controller.js';
import * as assignments from '../assignments/assignments.controller.js';
import { sectionQuery } from '../assignments/assignments.schemas.js';

// School masters for pickers: classes + sections, subjects, terms, fee heads.
const router = Router();
router.use(authenticate, authorize(STAFF));

router.get('/classes', validate({ query: schemas.branchQuery }), controller.listClasses);
router.get('/subjects', validate({ query: schemas.branchQuery }), controller.listSubjects);
router.get('/terms', validate({ query: schemas.branchQuery }), controller.listTerms);
// Who teaches each subject in a section.
router.get('/assignments', validate({ query: sectionQuery }), assignments.sectionAssignments);
router.get('/fee-heads', authorize(ADMINS), validate({ query: schemas.branchQuery }), controller.listFeeHeads);

export default router;
