import { Router } from 'express';
import { ROLES } from '../../config/roles.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { STAFF } from '../shared/access.js';
import { idParams } from '../shared/schemas.js';
import * as schemas from './homework.schemas.js';
import * as controller from './homework.controller.js';
import { uploadSingleFile } from './upload.js';

/**
 * Homework. Teachers: only subjects they teach (create) and their own sections (read);
 * changes by the teacher who set it or the school office. Parents read through /parent
 * and may download the files of their children's homework.
 */
const router = Router();
router.use(authenticate);

const staff = authorize(STAFF);

router.get('/', staff, validate({ query: schemas.listQuery }), controller.listHomework);
router.post('/', staff, validate({ body: schemas.createBody }), controller.createHomework);

// Files (before /:id so "attachments" is never taken for a homework id).
router.get('/attachments/:id', authorize(...STAFF, ROLES.PARENT, ROLES.STUDENT), validate({ params: idParams }), controller.downloadAttachment);
router.delete('/attachments/:id', staff, validate({ params: idParams }), controller.deleteAttachment);
router.post('/:id/attachments', staff, validate({ params: idParams }), controller.assertCanUpload, uploadSingleFile, controller.addAttachment);

router.delete('/:id', staff, validate({ params: idParams }), controller.deleteHomework);

export default router;
