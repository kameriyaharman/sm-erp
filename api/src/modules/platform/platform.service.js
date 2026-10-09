import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { LIMIT_KEYS, MODULES, OPTIONAL_MODULES } from '../../config/modules.js';
import { env } from '../../config/env.js';
import { pool, withTransaction } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { logger } from '../../utils/logger.js';
import { temporaryPassword } from '../auth/login-id.js';
import { getEntitlements, invalidateEntitlements, usageThisMonth } from '../saas/entitlements.js';
import { invalidateSchoolMessaging } from '../notifications/index.js';
import { diffValues, recordAudit } from '../settings/audit.js';

/**
 * Platform console (SM ERP operator = super_admin without a school):
 * plans, schools and their subscriptions, onboarding a new school.
 */

const money = (v) => (v === null || v === undefined ? null : String(v));

function viewPlan(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    modules: row.modules,
    limits: Object.fromEntries(LIMIT_KEYS.map((k) => [k, row.limits?.[k] ?? null])),
    priceMonthly: money(row.price_monthly),
    priceYearly: money(row.price_yearly),
    priceNote: row.price_note,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    schools: row.schools ?? 0,
    updatedAt: row.updated_at,
  };
}

// ------------------------------------------------------------------ overview

export async function overview() {
  const [{ rows: [counts] }, { rows: plans }, { rows: trials }, { rows: usage }] = await Promise.all([
    pool.query(
      `SELECT count(*) FILTER (WHERE t.status = 'active')::int AS active,
              count(*) FILTER (WHERE t.status <> 'active')::int AS inactive,
              count(*) FILTER (WHERE s.status = 'trial')::int AS trial,
              (SELECT count(*)::int FROM student_profiles sp JOIN tenants tt ON tt.id = sp.tenant_id
                WHERE sp.deleted_at IS NULL AND sp.status = 'enrolled' AND tt.deleted_at IS NULL) AS students
         FROM tenants t LEFT JOIN tenant_subscriptions s ON s.tenant_id = t.id
        WHERE t.deleted_at IS NULL`,
    ),
    pool.query(`SELECT p.code, p.name, count(s.tenant_id)::int AS schools FROM plans p LEFT JOIN tenant_subscriptions s ON s.plan_id = p.id GROUP BY p.id ORDER BY p.sort_order`),
    pool.query(
      `SELECT t.id, t.name, t.code, s.trial_ends_at FROM tenant_subscriptions s JOIN tenants t ON t.id = s.tenant_id
        WHERE s.status = 'trial' AND s.trial_ends_at <= current_date + 7 AND t.deleted_at IS NULL ORDER BY s.trial_ends_at LIMIT 20`,
    ),
    pool.query(
      `SELECT channel, COALESCE(account, 'platform') AS account, count(*)::int AS sent
         FROM notification_logs WHERE status = 'sent' AND created_at >= date_trunc('month', now())
        GROUP BY channel, COALESCE(account, 'platform')`,
    ),
  ]);
  return {
    schools: { active: counts.active, inactive: counts.inactive, trial: counts.trial },
    students: counts.students,
    plans,
    trialsEnding: trials.map((t) => ({ id: t.id, name: t.name, code: t.code, trialEndsAt: t.trial_ends_at })),
    messagesThisMonth: usage,
  };
}

// ------------------------------------------------------------------ plans

export async function listPlans() {
  const { rows } = await pool.query(
    `SELECT p.*, (SELECT count(*)::int FROM tenant_subscriptions s WHERE s.plan_id = p.id) AS schools
       FROM plans p ORDER BY p.sort_order, p.name`,
  );
  return { plans: rows.map(viewPlan), modules: MODULES };
}

function cleanLimits(limits = {}) {
  return Object.fromEntries(LIMIT_KEYS.filter((k) => k in limits).map((k) => [k, limits[k] === null ? null : Number(limits[k])]));
}

export async function createPlan(auth, input) {
  try {
    const { rows: [row] } = await pool.query(
      `INSERT INTO plans (code, name, description, modules, limits, price_monthly, price_yearly, price_note, is_active, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [input.code, input.name, input.description ?? null, [...new Set(input.modules)], JSON.stringify(cleanLimits(input.limits)), input.priceMonthly ?? null, input.priceYearly ?? null, input.priceNote ?? null, input.isActive ?? true, input.sortOrder ?? 0],
    );
    await recordAudit(pool, { tenantId: null, actorUserId: auth.userId, area: 'plans', action: 'create', summary: `Plan created: ${row.name} (${row.code})` });
    return viewPlan(row);
  } catch (err) {
    if (err.code === '23505') throw new AppError(409, 'PLAN_CODE_TAKEN', 'A plan with this code already exists');
    throw err;
  }
}

export async function updatePlan(auth, id, input) {
  const { rows: [before] } = await pool.query(`SELECT * FROM plans WHERE id = $1`, [id]);
  if (!before) throw AppError.notFound('Plan not found', 'PLAN_NOT_FOUND');
  const next = {
    name: input.name ?? before.name,
    description: input.description !== undefined ? input.description : before.description,
    modules: input.modules ? [...new Set(input.modules)] : before.modules,
    limits: input.limits ? { ...before.limits, ...cleanLimits(input.limits) } : before.limits,
    priceMonthly: input.priceMonthly !== undefined ? input.priceMonthly : before.price_monthly,
    priceYearly: input.priceYearly !== undefined ? input.priceYearly : before.price_yearly,
    priceNote: input.priceNote !== undefined ? input.priceNote : before.price_note,
    isActive: input.isActive ?? before.is_active,
    sortOrder: input.sortOrder ?? before.sort_order,
  };
  const { rows: [row] } = await pool.query(
    `UPDATE plans SET name = $2, description = $3, modules = $4, limits = $5, price_monthly = $6, price_yearly = $7, price_note = $8, is_active = $9, sort_order = $10
      WHERE id = $1 RETURNING *`,
    [id, next.name, next.description, next.modules, JSON.stringify(next.limits), next.priceMonthly, next.priceYearly, next.priceNote, next.isActive, next.sortOrder],
  );
  await recordAudit(pool, {
    tenantId: null,
    actorUserId: auth.userId,
    area: 'plans',
    action: 'update',
    summary: `Plan updated: ${row.name}`,
    changes: diffValues({ modules: before.modules, limits: before.limits, name: before.name, isActive: before.is_active }, { modules: row.modules, limits: row.limits, name: row.name, isActive: row.is_active }),
  });
  invalidateEntitlements(); // every school on this plan
  invalidateSchoolMessaging();
  return viewPlan(row);
}

// ------------------------------------------------------------------ schools

export async function listTenants({ search, status, planId, page, limit }) {
  const like = search ? `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const { rows } = await pool.query(
    `SELECT t.id, t.name, t.code, t.status, t.contact_email, t.contact_phone, t.created_at,
            s.status AS subscription_status, s.trial_ends_at, s.current_period_end,
            p.id AS plan_id, p.name AS plan_name, p.code AS plan_code,
            (SELECT count(*)::int FROM branches b WHERE b.tenant_id = t.id AND b.deleted_at IS NULL) AS branches,
            (SELECT count(*)::int FROM student_profiles sp WHERE sp.tenant_id = t.id AND sp.deleted_at IS NULL AND sp.status = 'enrolled') AS students,
            (SELECT max(u.last_login_at) FROM users u WHERE u.tenant_id = t.id) AS last_login_at,
            count(*) OVER ()::int AS total_count
       FROM tenants t
       LEFT JOIN tenant_subscriptions s ON s.tenant_id = t.id
       LEFT JOIN plans p                ON p.id = s.plan_id
      WHERE t.deleted_at IS NULL
        AND ($1::text IS NULL OR t.name ILIKE $1 OR t.code::text ILIKE $1 OR t.contact_email::text ILIKE $1)
        AND ($2::text IS NULL OR s.status::text = $2 OR ($2 = 'suspended' AND t.status = 'suspended'))
        AND ($3::uuid IS NULL OR s.plan_id = $3)
      ORDER BY t.created_at DESC
      LIMIT $4 OFFSET $5`,
    [like, status ?? null, planId ?? null, limit, (page - 1) * limit],
  );
  const total = rows[0]?.total_count ?? 0;
  return {
    data: rows.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      status: r.status,
      contactEmail: r.contact_email,
      contactPhone: r.contact_phone,
      plan: r.plan_id ? { id: r.plan_id, name: r.plan_name, code: r.plan_code } : null,
      subscriptionStatus: r.subscription_status ?? null,
      trialEndsAt: r.trial_ends_at,
      currentPeriodEnd: r.current_period_end,
      branches: r.branches,
      students: r.students,
      lastLoginAt: r.last_login_at,
      createdAt: r.created_at,
    })),
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getTenant(id) {
  const { rows: [t] } = await pool.query(
    `SELECT t.*, s.status AS subscription_status, s.trial_ends_at, s.current_period_end, s.module_overrides, s.limit_overrides, s.notes, s.plan_id
       FROM tenants t LEFT JOIN tenant_subscriptions s ON s.tenant_id = t.id
      WHERE t.id = $1 AND t.deleted_at IS NULL`,
    [id],
  );
  if (!t) throw AppError.notFound('School not found', 'TENANT_NOT_FOUND');
  const [ent, usage, { rows: branches }, { rows: owners }, { rows: [students] }] = await Promise.all([
    getEntitlements(id),
    usageThisMonth(pool, id),
    pool.query(`SELECT id, name, code, city, state, is_head_office, status FROM branches WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY is_head_office DESC, name`, [id]),
    pool.query(
      `SELECT id, concat_ws(' ', first_name, last_name) AS name, email, phone, role, last_login_at, must_change_password
         FROM users WHERE tenant_id = $1 AND role IN ('super_admin', 'branch_admin') AND deleted_at IS NULL ORDER BY role, first_name`,
      [id],
    ),
    pool.query(`SELECT count(*)::int AS n FROM student_profiles WHERE tenant_id = $1 AND deleted_at IS NULL AND status = 'enrolled'`, [id]),
  ]);
  return {
    id: t.id,
    name: t.name,
    code: t.code,
    legalName: t.legal_name,
    contactEmail: t.contact_email,
    contactPhone: t.contact_phone,
    timezone: t.timezone,
    status: t.status,
    createdAt: t.created_at,
    subscription: t.plan_id
      ? {
        planId: t.plan_id,
        status: t.subscription_status,
        trialEndsAt: t.trial_ends_at,
        currentPeriodEnd: t.current_period_end,
        moduleOverrides: t.module_overrides,
        limitOverrides: t.limit_overrides,
        notes: t.notes,
      }
      : null,
    entitlements: ent,
    usage,
    students: students.n,
    branches: branches.map((b) => ({ id: b.id, name: b.name, code: b.code, city: b.city, state: b.state, isHeadOffice: b.is_head_office, status: b.status })),
    admins: owners.map((u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, lastLoginAt: u.last_login_at, mustChangePassword: u.must_change_password })),
  };
}

/**
 * Onboards a school: tenant + head-office branch + owner login (temporary password, shown once)
 * + subscription (trial on the chosen plan). The owner then runs the setup screens.
 */
export async function createTenant(auth, input) {
  const { rows: [plan] } = await pool.query(`SELECT id, code, name FROM plans WHERE code = $1 AND is_active`, [input.planCode ?? env.DEFAULT_PLAN_CODE]);
  if (!plan) throw new AppError(422, 'PLAN_NOT_FOUND', `No active plan with code "${input.planCode ?? env.DEFAULT_PLAN_CODE}"`);
  const password = temporaryPassword(randomInt);
  const hash = await bcrypt.hash(password, 12);
  const trialDays = input.trialDays ?? env.TRIAL_DAYS;

  const created = await withTransaction(async (db) => {
    let tenant;
    try {
      ({ rows: [tenant] } = await db.query(
        `INSERT INTO tenants (name, code, legal_name, contact_email, contact_phone, timezone)
         VALUES ($1, lower($2), $3, $4, $5, $6) RETURNING id, code, name`,
        [input.name, input.code, input.legalName ?? null, input.contactEmail ?? input.owner.email ?? null, input.contactPhone ?? input.owner.phone ?? null, input.timezone ?? 'Asia/Kolkata'],
      ));
    } catch (err) {
      if (err.code === '23505') throw new AppError(409, 'SCHOOL_CODE_TAKEN', `The school code "${input.code}" is taken. Choose another.`, { body: { code: ['Already taken'] } });
      throw err;
    }
    const { rows: [branch] } = await db.query(
      `INSERT INTO branches (tenant_id, name, code, city, state, phone, email, is_head_office)
       VALUES ($1, $2, upper($3), $4, $5, $6, $7, true) RETURNING id, name, code`,
      [tenant.id, input.branch.name, input.branch.code, input.branch.city ?? null, input.branch.state ?? null, input.contactPhone ?? null, input.contactEmail ?? null],
    );
    const { rows: [owner] } = await db.query(
      `INSERT INTO users (tenant_id, branch_id, role, email, phone, first_name, last_name, password_hash, must_change_password, password_set_at)
       VALUES ($1, NULL, 'super_admin', $2, $3, $4, $5, $6, true, now()) RETURNING id`,
      [tenant.id, input.owner.email ?? null, input.owner.phone ?? null, input.owner.firstName, input.owner.lastName ?? null, hash],
    );
    await db.query(
      `INSERT INTO tenant_subscriptions (tenant_id, plan_id, status, trial_ends_at, notes, updated_by)
       VALUES ($1, $2, $3, CASE WHEN $4::int > 0 THEN current_date + $4::int END, $5, $6)`,
      [tenant.id, plan.id, trialDays > 0 ? 'trial' : 'active', trialDays, input.notes ?? null, auth.userId],
    );
    await recordAudit(db, { tenantId: tenant.id, actorUserId: auth.userId, area: 'subscription', action: 'create', summary: `School created on ${plan.name}${trialDays > 0 ? ` (${trialDays}-day trial)` : ''}` });
    return { tenant, branch, ownerId: owner.id };
  });

  logger.info('School onboarded', { tenantId: created.tenant.id, code: created.tenant.code, plan: plan.code, by: auth.userId });
  return {
    school: { id: created.tenant.id, name: created.tenant.name, code: created.tenant.code },
    branch: created.branch,
    plan: { code: plan.code, name: plan.name },
    // Shown once: give these to the school owner. They must set their own password at first sign-in.
    ownerLogin: { schoolCode: created.tenant.code, identifier: input.owner.email ?? input.owner.phone, temporaryPassword: password },
  };
}

export async function updateTenant(auth, id, input) {
  const before = await getTenant(id);
  await withTransaction(async (db) => {
    if (input.status && input.status !== before.status) {
      await db.query(`UPDATE tenants SET status = $2::record_status WHERE id = $1`, [id, input.status]);
    }
    if (input.name || input.contactEmail !== undefined || input.contactPhone !== undefined) {
      await db.query(
        `UPDATE tenants SET name = COALESCE($2, name),
                contact_email = CASE WHEN $3::boolean THEN $4 ELSE contact_email END,
                contact_phone = CASE WHEN $5::boolean THEN $6 ELSE contact_phone END
          WHERE id = $1`,
        [id, input.name ?? null, input.contactEmail !== undefined, input.contactEmail ?? null, input.contactPhone !== undefined, input.contactPhone ?? null],
      );
    }
    const sub = input.subscription;
    if (sub) {
      const planId = sub.planId ?? before.subscription?.planId;
      if (!planId) throw new AppError(422, 'PLAN_REQUIRED', 'Choose a plan for this school');
      const overrides = sub.moduleOverrides
        ? Object.fromEntries(Object.entries(sub.moduleOverrides).filter(([k, v]) => OPTIONAL_MODULES.includes(k) && typeof v === 'boolean'))
        : before.subscription?.moduleOverrides ?? {};
      const limitOverrides = sub.limitOverrides ? cleanLimits(sub.limitOverrides) : before.subscription?.limitOverrides ?? {};
      await db.query(
        `INSERT INTO tenant_subscriptions (tenant_id, plan_id, status, trial_ends_at, current_period_end, module_overrides, limit_overrides, notes, updated_by)
         VALUES ($1, $2, COALESCE($3::subscription_status, 'active'), $4, $5, $6, $7, $8, $9)
         ON CONFLICT (tenant_id) DO UPDATE
            SET plan_id = EXCLUDED.plan_id,
                status = COALESCE($3::subscription_status, tenant_subscriptions.status),
                trial_ends_at = CASE WHEN $10::boolean THEN EXCLUDED.trial_ends_at ELSE tenant_subscriptions.trial_ends_at END,
                current_period_end = CASE WHEN $11::boolean THEN EXCLUDED.current_period_end ELSE tenant_subscriptions.current_period_end END,
                module_overrides = EXCLUDED.module_overrides, limit_overrides = EXCLUDED.limit_overrides,
                notes = CASE WHEN $12::boolean THEN EXCLUDED.notes ELSE tenant_subscriptions.notes END,
                updated_by = EXCLUDED.updated_by`,
        [id, planId, sub.status ?? null, sub.trialEndsAt ?? null, sub.currentPeriodEnd ?? null, JSON.stringify(overrides), JSON.stringify(limitOverrides), sub.notes ?? null, auth.userId,
          sub.trialEndsAt !== undefined, sub.currentPeriodEnd !== undefined, sub.notes !== undefined],
      );
      // Suspending / cancelling the subscription locks the school out; re-activating lets it back in.
      if (sub.status === 'suspended' || sub.status === 'cancelled') await db.query(`UPDATE tenants SET status = 'suspended' WHERE id = $1`, [id]);
      if ((sub.status === 'active' || sub.status === 'trial') && before.status === 'suspended' && !input.status) await db.query(`UPDATE tenants SET status = 'active' WHERE id = $1`, [id]);
    }
    const after = { status: input.status ?? before.status, subscription: sub ?? null };
    await recordAudit(db, {
      tenantId: id,
      actorUserId: auth.userId,
      area: 'subscription',
      action: 'update',
      summary: `Subscription updated by SM ERP${sub?.planId && sub.planId !== before.subscription?.planId ? ' (plan changed)' : ''}${input.status ? ` (school ${input.status})` : ''}`,
      changes: diffValues({ status: before.status, subscription: before.subscription }, { status: after.status, subscription: sub ? { ...before.subscription, ...sub } : before.subscription }),
    });
  });
  invalidateEntitlements(id);
  invalidateSchoolMessaging(id);
  logger.info('School subscription updated', { tenantId: id, by: auth.userId });
  return getTenant(id);
}
