import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from '../../config/roles.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { logger } from '../../utils/logger.js';
import { limit, page, uuid } from '../shared/schemas.js';
import * as service from './portal-access.service.js';

/**
 * Settings -> Portal logins (ADMINS): parent and student logins for the family portal.
 * Owner: whole school; branch admin: students of their branch and parents with a child there.
 */
const router = Router();
router.use(authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.BRANCH_ADMIN));

const noStore = (res) => res.set('Cache-Control', 'private, no-store');

const listQuery = z
  .object({
    type: z.enum(['parent', 'student']),
    search: z.string().trim().max(100).optional(),
    classId: uuid.optional(),
    sectionId: uuid.optional(),
    // none = no login yet, temporary = must change password, has_login = temporary + active + locked
    status: z.enum(['none', 'temporary', 'active', 'locked', 'inactive', 'has_login']).optional(),
    page,
    limit: limit(25, 100),
  })
  .strict();

const resetBody = z
  .object({
    // Omit to generate a temporary password (shown once). Or type one (rules as for users' own passwords).
    password: z.string().min(1).max(72).optional(),
    // Only for a typed password: ask the user to change it at first sign-in (default yes).
    mustChange: z.boolean().default(true),
  })
  .strict();

const bulkBody = z
  .object({
    type: z.enum(['parent', 'student']),
    classId: uuid,
    sectionId: uuid.optional(),
    // Default: only accounts that have no login yet (re-issuing would lock out families already using the app).
    onlyWithoutLogin: z.boolean().default(true),
  })
  .strict();

router.get('/', validate({ query: listQuery }), async (req, res) => {
  noStore(res).json(await service.listPortalAccess(req.auth, req.valid.query));
});

router.post('/bulk', validate({ body: bulkBody }), async (req, res) => {
  noStore(res).json({ data: await service.bulkIssue(req.auth, req.valid.body, { logger, portalUrl: service.portalUrl(req) }) });
});

router.post('/:userId/reset', validate({ params: z.object({ userId: uuid }).strict(), body: resetBody }), async (req, res) => {
  noStore(res).json({ data: await service.resetPassword(req.auth, req.valid.params.userId, req.valid.body, { logger, portalUrl: service.portalUrl(req) }) });
});

export default router;
