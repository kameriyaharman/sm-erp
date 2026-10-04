import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { ADMINS, STAFF } from '../shared/access.js';
import { idParams } from '../shared/schemas.js';
import { imageUpload } from '../setup/upload.js';
import { MAX_PHOTO_BYTES } from '../setup/profile.helpers.js';
import * as schemas from './students.schemas.js';
import * as controller from './students.controller.js';

// Student register. Teachers read the students of their own sections; only the school office admits or edits.
const router = Router();
router.use(authenticate);

router.get('/', authorize(STAFF), validate({ query: schemas.listQuery }), controller.listStudents);
router.get('/:id', authorize(STAFF), validate({ params: idParams }), controller.getStudent);
router.post('/', authorize(ADMINS), validate({ body: schemas.createBody }), controller.admitStudent);
router.patch('/:id', authorize(ADMINS), validate({ params: idParams, body: schemas.updateBody }), controller.updateStudent);

// Passport photo (jpeg / png / webp, max 2 MB). Readable by whoever can read the student.
router.get('/:id/photo', authorize(STAFF), validate({ params: idParams }), controller.getPhoto);
router.put('/:id/photo', authorize(ADMINS), validate({ params: idParams }), imageUpload(MAX_PHOTO_BYTES, 'Photo'), controller.putPhoto);
router.delete('/:id/photo', authorize(ADMINS), validate({ params: idParams }), controller.deletePhoto);

// Full Aadhaar number (GET /:id only ever shows it masked). Logged.
router.get('/:id/aadhaar', authorize(ADMINS), validate({ params: idParams }), controller.revealAadhaar);

export default router;
