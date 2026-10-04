import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { ADMINS } from '../shared/access.js';
import { idParams } from '../shared/schemas.js';
import * as schemas from './fee-setup.schemas.js';
import * as controller from './fee-setup.controller.js';

/**
 * Fee setup (ADMINS). Guards are per route, not router.use(): these routers share the /fees
 * and /students mount points with other modules and must not touch their requests.
 */
const admins = [authenticate, authorize(ADMINS)];

/** Mounted at /fees (before the fees module). */
export const feeSetupRouter = Router();
feeSetupRouter.get('/heads', admins, validate({ query: schemas.branchQuery }), controller.listHeads);
feeSetupRouter.post('/heads', admins, validate({ body: schemas.createHeadBody }), controller.createHead);
feeSetupRouter.patch('/heads/:id', admins, validate({ params: idParams, body: schemas.updateHeadBody }), controller.updateHead);
feeSetupRouter.delete('/heads/:id', admins, validate({ params: idParams }), controller.deleteHead);

feeSetupRouter.get('/structure', admins, validate({ query: schemas.structureQuery }), controller.getStructure);
feeSetupRouter.put('/structure', admins, validate({ body: schemas.saveStructureBody }), controller.saveStructure);
feeSetupRouter.get('/structure/overview', admins, validate({ query: schemas.overviewQuery }), controller.overview);
feeSetupRouter.get('/structure/schedule', admins, validate({ query: schemas.scheduleQuery }), controller.schedule);
feeSetupRouter.post('/structure/copy', admins, validate({ body: schemas.copyStructureBody }), controller.copyStructure);
feeSetupRouter.get('/structure/apply-preview', admins, validate({ query: schemas.applyPreviewQuery }), controller.applyPreview);
feeSetupRouter.post('/structure/apply', admins, validate({ body: schemas.applyBody }), controller.apply);

/** Mounted at /students (before the students module): only /:id/fee-concession. */
export const concessionRouter = Router();
concessionRouter.get('/:id/fee-concession', admins, validate({ params: idParams, query: schemas.concessionQuery }), controller.getConcession);
concessionRouter.put('/:id/fee-concession', admins, validate({ params: idParams, body: schemas.saveConcessionBody }), controller.saveConcession);
