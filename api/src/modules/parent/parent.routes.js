import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from '../../config/roles.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { isoMonth, limit, page, studentParams } from '../shared/schemas.js';
import { getParentHome } from './parent.service.js';
import * as children from './parent.children.service.js';

const router = Router();
router.use(authenticate, authorize(ROLES.PARENT));

const noStore = (res) => res.set('Cache-Control', 'private, no-store');

// Everything the parent app home screen needs, for all of this parent's children.
router.get('/home', async (req, res) => {
  noStore(res).json({ data: await getParentHome(req.auth) });
});

// One child (must be the caller's child, else 404).
router.get('/children/:studentId/fees', validate({ params: studentParams }), async (req, res) => {
  noStore(res).json({ data: await children.childFees(req.auth, req.valid.params.studentId) });
});

router.get(
  '/children/:studentId/attendance',
  validate({ params: studentParams, query: z.object({ month: isoMonth.optional() }).strict() }),
  async (req, res) => {
    noStore(res).json({ data: await children.childAttendance(req.auth, req.valid.params.studentId, req.valid.query) });
  },
);

router.get(
  '/children/:studentId/homework',
  validate({ params: studentParams, query: z.object({ page, limit: limit(20, 100) }).strict() }),
  async (req, res) => {
    noStore(res).json(await children.childHomework(req.auth, req.valid.params.studentId, req.valid.query));
  },
);

router.get('/children/:studentId/timetable', validate({ params: studentParams }), async (req, res) => {
  noStore(res).json({ data: await children.childTimetable(req.auth, req.valid.params.studentId) });
});

router.get('/children/:studentId/transport', validate({ params: studentParams }), async (req, res) => {
  noStore(res).json({ data: await children.childTransport(req.auth, req.valid.params.studentId) });
});

export default router;
