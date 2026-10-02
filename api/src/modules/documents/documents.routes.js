import { Router } from 'express';
import { ROLES } from '../../config/roles.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { pdfLimiter, verifyLimiter } from '../../middleware/rateLimit.js';
import * as s from './documents.schemas.js';
import * as controller from './documents.controller.js';

const router = Router();
router.use(authenticate);

const admins = authorize(ROLES.SUPER_ADMIN, ROLES.BRANCH_ADMIN);
const staff = authorize(ROLES.SUPER_ADMIN, ROLES.BRANCH_ADMIN, ROLES.TEACHER);       // teacher = class teacher (checked in service)
const viewers = authorize(ROLES.SUPER_ADMIN, ROLES.BRANCH_ADMIN, ROLES.TEACHER, ROLES.PARENT, ROLES.STUDENT);

// ---- Report cards
router.post('/report-cards/generate', staff, validate({ body: s.generateBody }), controller.generateReportCards);
router.post('/report-cards/publish', admins, validate({ body: s.publishBody }), controller.publishReportCards);
router.patch('/report-cards/:id', staff, validate({ params: s.idParams, body: s.updateReportCardBody }), controller.updateReportCard);
router.get('/report-cards/:id/pdf', viewers, pdfLimiter, validate({ params: s.idParams, query: s.pdfQuery }), controller.reportCardPdf);
router.get('/students/:studentId/report-cards', viewers, validate({ params: s.studentParams }), controller.listStudentReportCards);

// ---- Certificates (school office only)
router.post('/students/:studentId/transfer-certificate', admins, validate({ params: s.studentParams, body: s.transferCertificateBody }), controller.issueTransferCertificate);
router.post('/students/:studentId/bonafide', admins, validate({ params: s.studentParams, body: s.bonafideBody }), controller.issueBonafide);
router.get('/certificates', admins, validate({ query: s.certificateListQuery }), controller.listCertificates);
router.get('/certificates/:id/pdf', admins, pdfLimiter, validate({ params: s.idParams, query: s.certificatePdfQuery }), controller.certificatePdf);
router.post('/certificates/:id/cancel', admins, validate({ params: s.idParams, body: s.cancelBody }), controller.cancelCertificate);

export default router;

/** Public QR verification: GET /api/v1/verify/:code (no login, rate limited). */
export const verifyRouter = Router();
verifyRouter.get('/:code', verifyLimiter, validate({ params: s.codeParams }), controller.verify);
