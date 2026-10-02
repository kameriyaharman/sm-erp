import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { loginAccountLimiter, loginIpLimiter, logoutLimiter, refreshLimiter } from '../../middleware/rateLimit.js';
import { loginSchema, logoutSchema, refreshSchema } from './auth.schemas.js';
import * as controller from './auth.controller.js';

const router = Router();

// Public endpoints: per-IP and per-account brakes on failed logins (plus the DB lockout in auth.service).
// There is deliberately no public /register: accounts are created by school administrators.
router.post('/login', loginIpLimiter, loginAccountLimiter, validate({ body: loginSchema }), controller.login);
router.post('/refresh', refreshLimiter, validate({ body: refreshSchema }), controller.refresh);
router.post('/logout', logoutLimiter, validate({ body: logoutSchema }), controller.logout);
router.post('/logout-all', authenticate, controller.logoutAll);
router.get('/me', authenticate, controller.me);

export default router;
