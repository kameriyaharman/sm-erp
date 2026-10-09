import { CORE_MODULES, MODULES } from '../../config/modules.js';
import { pool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { getEntitlements, invalidateEntitlements, usageThisMonth } from '../saas/entitlements.js';
import { invalidateSchoolMessaging } from '../notifications/index.js';
import { EVENTS } from '../notifications/catalog.js';
import { listAudit } from './audit.js';
import { assertSchoolEditor, settingsScope, targetBranch } from './scope.js';
import { SECTIONS } from './sections.js';
import { getSectionForEdit, putSection, resetBranchSection } from './store.js';

/**
 * Settings home, modules on/off, typed sections (attendance policy, holidays, messaging),
 * and the change log.
 */

// ------------------------------------------------------------------ overview

export async function overview(auth, { tenantId }) {
  const scope = await settingsScope(auth, { tenantId });
  const ent = await getEntitlements(scope.tenantId);
  const [channels, templates, rules, devices, usage] = await Promise.all([
    pool.query(`SELECT channel, provider, enabled, verified_at, branch_id FROM communication_channels WHERE tenant_id = $1`, [scope.tenantId]),
    pool.query(`SELECT count(*)::int AS n FROM message_templates WHERE tenant_id = $1`, [scope.tenantId]),
    pool.query(`SELECT event_type, enabled FROM notification_rules WHERE tenant_id = $1`, [scope.tenantId]),
    pool.query(
      `SELECT count(*)::int AS n, max(last_seen_at) AS last_seen FROM attendance_devices
        WHERE tenant_id = $1 AND deleted_at IS NULL AND ($2::uuid IS NULL OR branch_id = $2)`,
      [scope.tenantId, scope.ownBranchId],
    ),
    usageThisMonth(pool, scope.tenantId),
  ]);
  const ruleMap = Object.fromEntries(rules.rows.map((r) => [r.event_type, r.enabled]));
  const automaticOn = Object.entries(EVENTS).filter(([key, e]) => !e.alwaysOn && (ruleMap[key] ?? e.defaultRule.enabled)).length;

  const channelState = {};
  for (const channel of ['whatsapp', 'sms', 'email']) {
    const school = channels.rows.find((r) => r.channel === channel && r.branch_id === null);
    channelState[channel] = {
      module: ent?.modules.includes(channel) ?? true,
      inPlan: ent?.availableModules.includes(channel) ?? true,
      provider: school ? school.provider : 'platform',
      enabled: school ? school.enabled : true,
      verified: school ? Boolean(school.verified_at) || school.provider === 'platform' : true,
      branchOverrides: channels.rows.filter((r) => r.channel === channel && r.branch_id !== null).length,
    };
  }

  return {
    school: scope.school,
    canEditSchool: scope.canEditSchool,
    branches: scope.branches,
    subscription: ent
      ? { plan: ent.plan, status: ent.status, trialEndsAt: ent.trialEndsAt, trialDaysLeft: ent.trialDaysLeft, limits: ent.limits, managed: ent.managed }
      : null,
    modules: { enabled: ent?.modules.length ?? MODULES.length, total: MODULES.length },
    channels: channelState,
    usage,
    templates: { custom: templates.rows[0].n },
    rules: { automaticOn, automaticTotal: Object.values(EVENTS).filter((e) => !e.alwaysOn).length },
    devices: { count: devices.rows[0].n, lastSeenAt: devices.rows[0].last_seen },
  };
}

// ------------------------------------------------------------------ modules

export async function getModules(auth, { tenantId }) {
  const scope = await settingsScope(auth, { tenantId });
  const ent = await getEntitlements(scope.tenantId);
  const edit = await getSectionForEdit(scope.tenantId, 'modules');
  return {
    canEdit: scope.canEditSchool,
    plan: ent?.plan ?? null,
    version: edit.version,
    modules: MODULES.map((m) => ({
      key: m.key,
      label: m.label,
      group: m.group,
      description: m.description,
      core: CORE_MODULES.includes(m.key),
      inPlan: ent ? ent.availableModules.includes(m.key) : true,
      enabled: ent ? ent.modules.includes(m.key) : true,
    })),
  };
}

export async function putModules(auth, { tenantId, disabled, version }) {
  const scope = await settingsScope(auth, { tenantId });
  assertSchoolEditor(scope, 'which modules the school uses');
  const ent = await getEntitlements(scope.tenantId);
  // Only modules the plan includes can be switched; the rest stay as the plan says.
  const switchable = new Set(ent ? ent.availableModules : MODULES.map((m) => m.key));
  const clean = [...new Set(disabled)].filter((k) => !CORE_MODULES.includes(k) && switchable.has(k));
  const before = ent?.schoolDisabled ?? [];
  const turnedOff = clean.filter((k) => !before.includes(k));
  const turnedOn = before.filter((k) => !clean.includes(k));
  const label = (k) => MODULES.find((m) => m.key === k)?.label ?? k;
  const summary = [
    turnedOff.length ? `Switched off: ${turnedOff.map(label).join(', ')}` : null,
    turnedOn.length ? `Switched on: ${turnedOn.map(label).join(', ')}` : null,
  ].filter(Boolean).join('. ') || 'Modules saved (no change)';
  await putSection({ tenantId: scope.tenantId, section: 'modules', value: { disabled: clean }, version, actorUserId: auth.userId, auditArea: 'modules', summary });
  invalidateEntitlements(scope.tenantId);
  invalidateSchoolMessaging(scope.tenantId);
  return getModules(auth, { tenantId });
}

// ------------------------------------------------------------------ sections

const EDITABLE_SECTIONS = ['attendance', 'calendar', 'messaging'];

function checkSection(section) {
  if (!EDITABLE_SECTIONS.includes(section)) throw AppError.notFound('Unknown settings section', 'SECTION_NOT_FOUND');
  return SECTIONS[section];
}

export async function getSection(auth, section, { tenantId, branchId }) {
  const def = checkSection(section);
  const scope = await settingsScope(auth, { tenantId });
  // Branch admin of a multi-branch school: their branch's view (school-wide value as the inherited one).
  const target = def.branchable ? branchId ?? (scope.canEditSchool ? null : scope.ownBranchId) : null;
  if (target) targetBranch(scope, target);
  const data = await getSectionForEdit(scope.tenantId, section, target);
  return {
    ...data,
    canEdit: target ? true : scope.canEditSchool,
    canEditSchool: scope.canEditSchool,
    branches: def.branchable ? scope.branches : [],
    defaults: def.defaults,
  };
}

export async function putSectionValue(auth, section, { tenantId, branchId, value, version }) {
  const def = checkSection(section);
  const scope = await settingsScope(auth, { tenantId });
  const target = def.branchable ? targetBranch(scope, branchId ?? (scope.canEditSchool ? null : scope.ownBranchId)) : (assertSchoolEditor(scope), null);
  const branchName = target ? scope.branches.find((b) => b.id === target)?.name : null;
  await putSection({
    tenantId: scope.tenantId,
    branchId: target,
    section,
    value,
    version,
    actorUserId: auth.userId,
    summary: `${def.label} updated${branchName ? ` for ${branchName}` : ''}`,
  });
  if (section === 'messaging') invalidateSchoolMessaging(scope.tenantId);
  return getSection(auth, section, { tenantId, branchId: target });
}

export async function resetSection(auth, section, { tenantId, branchId }) {
  const def = checkSection(section);
  if (!def.branchable || !branchId) throw new AppError(422, 'NOT_BRANCHABLE', 'Only a branch can be reset to the school-wide settings');
  const scope = await settingsScope(auth, { tenantId });
  targetBranch(scope, branchId);
  await resetBranchSection({ tenantId: scope.tenantId, branchId, section, actorUserId: auth.userId });
  return getSection(auth, section, { tenantId, branchId });
}

// ------------------------------------------------------------------ audit

export async function auditLog(auth, { tenantId, area, page, limit }) {
  const scope = await settingsScope(auth, { tenantId });
  const rows = await listAudit(pool, {
    tenantId: scope.tenantId,
    branchIds: scope.canEditSchool ? null : scope.branches.map((b) => b.id),
    area: area ?? null,
    page,
    limit,
  });
  const total = rows[0]?.total_count ?? 0;
  return {
    data: rows.map((r) => ({
      id: r.id,
      area: r.area,
      action: r.action,
      summary: r.summary,
      changes: r.changes,
      branch: r.branch_id ? { id: r.branch_id, name: r.branch_name } : null,
      actor: r.actor_name ? { name: r.actor_name, role: r.actor_role } : null,
      createdAt: r.created_at,
    })),
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

// ------------------------------------------------------------------ entitlements for the apps

/** What the signed-in user's school has: drives the navigation in the web and parent apps. */
export async function myEntitlements(auth) {
  if (!auth.tenantId) {
    return { platform: true, plan: null, status: 'active', modules: MODULES.map((m) => m.key), trialDaysLeft: null };
  }
  const ent = await getEntitlements(auth.tenantId);
  return {
    platform: false,
    plan: ent?.plan ?? null,
    status: ent?.status ?? 'active',
    trialDaysLeft: ent?.trialDaysLeft ?? null,
    modules: ent?.modules ?? MODULES.map((m) => m.key),
  };
}
