import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import { loginAccountLimiter, loginIpLimiter, logoutLimiter, refreshLimiter } from '../../middleware/rateLimit.js';
import { changePasswordSchema, loginSchema, logoutSchema, refreshSchema } from './auth.schemas.js';
import * as controller from './auth.controller.js';

const router = Router();

// Public endpoints: per-IP and per-account brakes on failed logins (plus the DB lockout in auth.service).
// There is deliberately no public /register: accounts are created by school administrators.
router.post('/login', loginIpLimiter, loginAccountLimiter, validate({ body: loginSchema }), controller.login);
router.post('/refresh', refreshLimiter, validate({ body: refreshSchema }), controller.refresh);
router.post('/logout', logoutLimiter, validate({ body: logoutSchema }), controller.logout);
router.post('/logout-all', authenticate, controller.logoutAll);
router.get('/me', authenticate, controller.me);
// Signed-in user sets a new password (also the forced step after a temporary password). Wrong current
// passwords count toward the per-IP brake and the account lockout.
router.post('/change-password', loginIpLimiter, authenticate, validate({ body: changePasswordSchema }), controller.changePassword);

export default router;
