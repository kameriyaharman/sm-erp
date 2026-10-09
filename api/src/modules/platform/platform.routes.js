import { Router } from 'express';
import { z } from 'zod';
import { LIMIT_KEYS, OPTIONAL_MODULES } from '../../config/modules.js';
import { ROLES } from '../../config/roles.js';
import { AppError } from '../../errors/AppError.js';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { listAudit } from '../settings/audit.js';
import { pool } from '../../db/pool.js';
import * as platform from './platform.service.js';

/**
 * Platform console for the SM ERP operator (super_admin with no school).
 *
 *   GET   /platform/overview
 *   GET   /platform/plans          POST   PATCH /plans/:id
 *   GET   /platform/tenants        POST (onboard a school)
 *   GET   /platform/tenants/:id    PATCH (status, plan, trial, module / limit overrides)
 *   GET   /platform/audit          plan changes
 */
export const platformRouter = Router();

function platformOnly(req, _res, next) {
  if (req.auth?.role !== ROLES.SUPER_ADMIN || req.auth.tenantId) {
    return next(AppError.forbidden('Only SM ERP platform administrators can do this', 'PLATFORM_ONLY'));
  }
  return next();
}
platformRouter.use(authenticate, authorize(ROLES.SUPER_ADMIN), platformOnly);

const uuid = z.string().uuid();
const money = z.union([z.number().min(0).max(1e9), z.string().regex(/^\d{1,9}(\.\d{1,2})?$/)]).nullable().optional();
const limitsSchema = z.object(Object.fromEntries(LIMIT_KEYS.map((k) => [k, z.number().int().min(0).max(10_000_000).nullable().optional()]))).strict();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const page = z.coerce.number().int().min(1).default(1);

const planCreate = z
  .object({
    code: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/, 'Lower-case letters, digits, - and _'),
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500).nullable().optional(),
    modules: z.array(z.enum(OPTIONAL_MODULES)).max(OPTIONAL_MODULES.length),
    limits: limitsSchema.default({}),
    priceMonthly: money,
    priceYearly: money,
    priceNote: z.string().trim().max(200).nullable().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
  })
  .strict();
const planUpdate = planCreate.omit({ code: true }).partial().strict();

const phone = z.string().trim().regex(/^\+?\d[\d\s-]{8,15}$/, 'Mobile number');
const tenantCreate = z
  .object({
    name: z.string().trim().min(3).max(150),
    code: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,62}$/, 'Lower-case letters, digits and -: used to sign in, e.g. dps-dwarka'),
    legalName: z.string().trim().max(200).optional().nullable(),
    contactEmail: z.string().trim().email().optional().nullable(),
    contactPhone: phone.optional().nullable(),
    timezone: z.string().max(64).optional(),
    branch: z.object({
      name: z.string().trim().min(2).max(150),
      code: z.string().trim().regex(/^[A-Za-z0-9]{2,12}$/, '2-12 letters/digits, printed in receipt numbers (e.g. MAIN)'),
      city: z.string().trim().max(100).optional().nullable(),
      state: z.string().trim().max(100).optional().nullable(),
    }).strict(),
    owner: z.object({
      firstName: z.string().trim().min(1).max(100),
      lastName: z.string().trim().max(100).optional().nullable(),
      email: z.string().trim().email().optional().nullable(),
      phone: phone.optional().nullable(),
    }).strict().refine((o) => o.email || o.phone, { message: 'Email or mobile number for the owner login', path: ['email'] }),
    planCode: z.string().trim().max(40).optional(),
    trialDays: z.number().int().min(0).max(365).optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict();

const tenantUpdate = z
  .object({
    name: z.string().trim().min(3).max(150).optional(),
    contactEmail: z.string().trim().email().nullable().optional(),
    contactPhone: phone.nullable().optional(),
    status: z.enum(['active', 'suspended']).optional(),
    subscription: z
      .object({
        planId: uuid.optional(),
        status: z.enum(['trial', 'active', 'past_due', 'suspended', 'cancelled']).optional(),
        trialEndsAt: isoDate.nullable().optional(),
        currentPeriodEnd: isoDate.nullable().optional(),
        moduleOverrides: z.record(z.enum(OPTIONAL_MODULES), z.boolean()).optional(),
        limitOverrides: limitsSchema.optional(),
        notes: z.string().trim().max(1000).nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const idParams = z.object({ id: uuid }).strict();

platformRouter.get('/overview', async (_req, res) => {
  res.json({ data: await platform.overview() });
});

platformRouter.get('/plans', async (_req, res) => {
  res.json({ data: await platform.listPlans() });
});
platformRouter.post('/plans', validate({ body: planCreate }), async (req, res) => {
  res.status(201).json({ data: await platform.createPlan(req.auth, req.valid.body) });
});
platformRouter.patch('/plans/:id', validate({ params: idParams, body: planUpdate }), async (req, res) => {
  res.json({ data: await platform.updatePlan(req.auth, req.valid.params.id, req.valid.body) });
});

platformRouter.get(
  '/tenants',
  validate({ query: z.object({ search: z.string().trim().max(100).optional(), status: z.enum(['trial', 'active', 'past_due', 'suspended', 'cancelled']).optional(), planId: uuid.optional(), page, limit: z.coerce.number().int().min(1).max(100).default(25) }).strict() }),
  async (req, res) => {
    res.json(await platform.listTenants(req.valid.query));
  },
);
platformRouter.post('/tenants', validate({ body: tenantCreate }), async (req, res) => {
  res.status(201).json({ data: await platform.createTenant(req.auth, req.valid.body) });
});
platformRouter.get('/tenants/:id', validate({ params: idParams }), async (req, res) => {
  res.json({ data: await platform.getTenant(req.valid.params.id) });
});
platformRouter.patch('/tenants/:id', validate({ params: idParams, body: tenantUpdate }), async (req, res) => {
  res.json({ data: await platform.updateTenant(req.auth, req.valid.params.id, req.valid.body) });
});
platformRouter.get('/tenants/:id/audit', validate({ params: idParams, query: z.object({ page }).strict() }), async (req, res) => {
  const rows = await listAudit(pool, { tenantId: req.valid.params.id, page: req.valid.query.page, limit: 50 });
  res.json({ data: rows.map((r) => ({ id: r.id, area: r.area, action: r.action, summary: r.summary, changes: r.changes, actor: r.actor_name ? { name: r.actor_name, role: r.actor_role } : null, createdAt: r.created_at })) });
});
