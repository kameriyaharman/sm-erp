import { Router } from 'express';
import { ROLES } from '../../config/roles.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { getParentHome } from './parent.service.js';

const router = Router();
router.use(authenticate, authorize(ROLES.PARENT));

// Everything the parent app home screen needs, for all of this parent's children.
router.get('/home', async (req, res) => {
  res.set('Cache-Control', 'private, no-store').json({ data: await getParentHome(req.auth) });
});

export default router;
