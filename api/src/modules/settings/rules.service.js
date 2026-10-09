import { z } from 'zod';
import { CHANNEL_MODULE } from '../../config/modules.js';
import { pool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { getEntitlements } from '../saas/entitlements.js';
import { AUDIENCES, CHANNELS, EVENTS, defaultRule } from '../notifications/catalog.js';
import { invalidateSchoolMessaging } from '../notifications/index.js';
import { diffValues, recordAudit } from './audit.js';
import { assertSchoolEditor, settingsScope } from './scope.js';

/**
 * Settings -> Notification rules: per event, whether it is sent, over which channels (in
 * fallback order: WhatsApp first, SMS if the parent isn't on WhatsApp ...), to whom, and when.
 */

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time, e.g. 09:00');

const timingSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('immediate') }).strict(),
  z.object({ mode: z.literal('delay'), minutes: z.number().int().min(1).max(240) }).strict(),
  z.object({ mode: z.literal('at_time'), time: hhmm }).strict(),
  z
    .object({
      mode: z.literal('scheduled'),
      time: hhmm,
      daysBefore: z.number().int().min(0).max(30).optional(),
      includeOverdue: z.boolean().optional(),
      everyDays: z.number().int().min(1).max(30).optional(), // automatic run: once every N days
      autoRun: z.boolean(),
    })
    .strict(),
]);

export const ruleBody = z
  .object({
    tenantId: z.string().uuid().optional(),
    enabled: z.boolean(),
    channels: z.array(z.enum(CHANNELS)).min(1, 'Choose at least one channel').max(3).refine((a) => new Set(a).size === a.length, 'Each channel once'),
    audience: z.enum(AUDIENCES),
    timing: timingSchema,
  })
  .strict();

function view(eventType, row, ent) {
  const e = EVENTS[eventType];
  const rule = row ? { enabled: row.enabled, channels: row.channels, audience: row.audience, timing: row.timing } : defaultRule(eventType);
  return {
    key: eventType,
    label: e.label,
    group: e.group,
    description: e.description,
    alwaysOn: Boolean(e.alwaysOn),
    timingModes: e.timingModes,
    custom: Boolean(row),
    rule,
    defaults: defaultRule(eventType),
    // Channels the rule lists that the school can't use right now (module off / not in plan).
    unavailableChannels: rule.channels.filter((c) => ent && !ent.modules.includes(CHANNEL_MODULE[c])),
    updatedAt: row?.updated_at ?? null,
  };
}

export async function listRules(auth, { tenantId }) {
  const scope = await settingsScope(auth, { tenantId });
  const [ent, { rows }] = await Promise.all([
    getEntitlements(scope.tenantId),
    pool.query(`SELECT * FROM notification_rules WHERE tenant_id = $1`, [scope.tenantId]),
  ]);
  const byEvent = new Map(rows.map((r) => [r.event_type, r]));
  return {
    canEdit: scope.canEditSchool,
    channels: CHANNELS.map((c) => ({ key: c, available: ent ? ent.modules.includes(CHANNEL_MODULE[c]) : true })),
    rules: Object.keys(EVENTS).map((key) => view(key, byEvent.get(key), ent)),
  };
}

export async function saveRule(auth, eventType, input) {
  if (!EVENTS[eventType]) throw AppError.notFound('Unknown message', 'EVENT_NOT_FOUND');
  const scope = await settingsScope(auth, { tenantId: input.tenantId });
  assertSchoolEditor(scope, 'notification rules');
  const e = EVENTS[eventType];
  if (!e.timingModes.includes(input.timing.mode)) {
    throw AppError.badRequest('Validation failed', { body: { timing: [`"${input.timing.mode}" timing is not available for ${e.label}`] } }, 'VALIDATION_ERROR');
  }
  const { rows: [before] } = await pool.query(`SELECT * FROM notification_rules WHERE tenant_id = $1 AND event_type = $2`, [scope.tenantId, eventType]);
  const { rows: [row] } = await pool.query(
    `INSERT INTO notification_rules (tenant_id, event_type, enabled, channels, audience, timing, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id, event_type) DO UPDATE
        SET enabled = EXCLUDED.enabled, channels = EXCLUDED.channels, audience = EXCLUDED.audience,
            timing = EXCLUDED.timing, updated_by = EXCLUDED.updated_by
     RETURNING *`,
    [scope.tenantId, eventType, input.enabled, input.channels, input.audience, JSON.stringify(input.timing), auth.userId],
  );
  const prev = before ? { enabled: before.enabled, channels: before.channels, audience: before.audience, timing: before.timing } : defaultRule(eventType);
  const next = { enabled: row.enabled, channels: row.channels, audience: row.audience, timing: row.timing };
  await recordAudit(pool, {
    tenantId: scope.tenantId,
    actorUserId: auth.userId,
    area: 'rules',
    action: 'update',
    summary: `${e.label}: ${e.alwaysOn ? '' : next.enabled ? 'on, ' : 'off, '}${next.channels.join(' > ')}`,
    changes: diffValues(prev, next),
  });
  invalidateSchoolMessaging(scope.tenantId);
  return view(eventType, row, await getEntitlements(scope.tenantId));
}

export async function resetRule(auth, eventType, { tenantId }) {
  if (!EVENTS[eventType]) throw AppError.notFound('Unknown message', 'EVENT_NOT_FOUND');
  const scope = await settingsScope(auth, { tenantId });
  assertSchoolEditor(scope, 'notification rules');
  await pool.query(`DELETE FROM notification_rules WHERE tenant_id = $1 AND event_type = $2`, [scope.tenantId, eventType]);
  await recordAudit(pool, { tenantId: scope.tenantId, actorUserId: auth.userId, area: 'rules', action: 'reset', summary: `${EVENTS[eventType].label}: back to the default rule` });
  invalidateSchoolMessaging(scope.tenantId);
  return view(eventType, null, await getEntitlements(scope.tenantId));
}
