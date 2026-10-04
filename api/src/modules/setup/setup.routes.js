import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { ALL_ROLES } from '../../config/roles.js';
import { ADMINS, STAFF } from '../shared/access.js';
import { imageUpload } from './upload.js';
import { MAX_LOGO_BYTES } from './profile.helpers.js';
import * as s from './setup.schemas.js';
import * as c from './setup.controller.js';

// ---------------------------------------------------------------- /setup (school office only)
// Academic years + terms, classes + sections, subjects. Owner: ?branchId= picks the branch
// (default: head office); branch admin: own branch only.
export const setupRouter = Router();
setupRouter.use(authenticate, authorize(ADMINS));

const body = (schema) => validate({ query: s.branchQuery, body: schema });
const byId = (schema) => validate(schema ? { params: s.idParams, body: schema } : { params: s.idParams });

setupRouter.get('/academic-years', validate({ query: s.branchQuery }), c.listYears);
setupRouter.post('/academic-years', body(s.createYearBody), c.createYear);
setupRouter.patch('/academic-years/:id', byId(s.updateYearBody), c.updateYear);
setupRouter.post('/academic-years/:id/make-current', byId(), c.makeCurrentYear);
setupRouter.delete('/academic-years/:id', byId(), c.deleteYear);

setupRouter.post('/terms', validate({ body: s.createTermBody }), c.createTerm);
setupRouter.patch('/terms/:id', byId(s.updateTermBody), c.updateTerm);
setupRouter.delete('/terms/:id', byId(), c.deleteTerm);

setupRouter.get('/classes', validate({ query: s.classesQuery }), c.listClasses);
setupRouter.post('/classes', body(s.createClassBody), c.createClass);
setupRouter.patch('/classes/:id', byId(s.updateClassBody), c.updateClass);
setupRouter.delete('/classes/:id', byId(), c.deleteClass);

setupRouter.post('/sections', validate({ body: s.createSectionBody }), c.createSection);
setupRouter.patch('/sections/:id', byId(s.updateSectionBody), c.updateSection);
setupRouter.delete('/sections/:id', byId(), c.deleteSection);

setupRouter.get('/subjects', validate({ query: s.branchQuery }), c.listSubjects);
setupRouter.post('/subjects', body(s.createSubjectBody), c.createSubject);
setupRouter.patch('/subjects/:id', byId(s.updateSubjectBody), c.updateSubject);
setupRouter.delete('/subjects/:id', byId(), c.deleteSubject);

// ---------------------------------------------------------------- /settings/school
// authenticate per route (not router.use): other /settings/* routers may be mounted next to this one.
export const settingsRouter = Router();
settingsRouter.get('/school', authenticate, authorize(ADMINS), validate({ query: s.branchQuery }), c.getSchool);
settingsRouter.put('/school', authenticate, authorize(ADMINS), body(s.schoolProfileBody), c.putSchool);
// Logo: png / jpg, max 1 MB (printed on certificates and report cards). Any staff member may see it.
settingsRouter.get('/school/logo', authenticate, authorize(STAFF), validate({ query: s.branchQuery }), c.getLogo);
settingsRouter.put('/school/logo', authenticate, authorize(ADMINS), validate({ query: s.branchQuery }), imageUpload(MAX_LOGO_BYTES, 'The logo'), c.putLogo);
settingsRouter.delete('/school/logo', authenticate, authorize(ADMINS), validate({ query: s.branchQuery }), c.deleteLogo);

// ---------------------------------------------------------------- /me (the signed-in user)
// Profile edits are for staff (a parent's mobile links siblings; the office changes it).
// Every role may change their own password.
export const meRouter = Router();
meRouter.use(authenticate);
meRouter.get('/', authorize(ALL_ROLES), c.getMe);
meRouter.patch('/', authorize(STAFF), validate({ body: s.updateMeBody }), c.updateMe);
meRouter.post('/password', authorize(ALL_ROLES), validate({ body: s.changePasswordBody }), c.changePassword);
