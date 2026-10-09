import { pool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { logger } from '../../utils/logger.js';
import { CHANNELS, EVENTS, VARIABLES, placeholdersOf, templateProblems } from '../notifications/catalog.js';
import { invalidateSchoolMessaging } from '../notifications/index.js';
import { renderChannel } from '../notifications/render.js';
import { NotificationError } from '../notifications/errors.js';
import { diffValues, recordAudit } from './audit.js';
import { metaProviderFor } from './communication.service.js';
import { assertSchoolEditor, settingsScope } from './scope.js';

/**
 * Settings -> Message templates: the school's own text per event and channel.
 *
 *   SMS        must match a DLT-registered template word for word; `name` = DLT template ID / MSG91 flow ID
 *   WhatsApp   must be approved by Meta; `name` = approved template name (Twilio: Content SID),
 *              `params` = which variable fills {{1}}, {{2}} ...
 *   Email      free text with a subject
 *
 * Custom SMS / WhatsApp text only applies when the school sends from its own account: the
 * platform account's templates are fixed. Email templates always apply.
 */

const META_NAME = /^[a-z0-9_]{1,512}$/;
const samples = () => Object.fromEntries(Object.entries(VARIABLES).map(([k, v]) => [k, v.sample]));

async function ownProviders(tenantId) {
  const { rows } = await pool.query(
    `SELECT channel, provider FROM communication_channels WHERE tenant_id = $1 AND enabled AND provider <> 'platform'`,
    [tenantId],
  );
  const out = {};
  for (const r of rows) out[r.channel] ??= r.provider;
  return out;
}

function viewTemplate(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    body: row.body,
    params: row.params ?? [],
    language: row.language,
    approvalStatus: row.approval_status,
    approvalNote: row.approval_note,
    submittedAt: row.submitted_at,
    syncedAt: row.synced_at,
    updatedAt: row.updated_at,
  };
}

function preview(eventType, channel, template) {
  try {
    const r = renderChannel(channel, { ...template, custom: true }, samples());
    return channel === 'email' ? { subject: r.subject, text: r.text } : { text: channel === 'whatsapp' ? r.text : r.text, variables: r.variables };
  } catch {
    return null;
  }
}

export async function listTemplates(auth, { tenantId }) {
  const scope = await settingsScope(auth, { tenantId });
  const [{ rows }, own] = await Promise.all([
    pool.query(`SELECT * FROM message_templates WHERE tenant_id = $1`, [scope.tenantId]),
    ownProviders(scope.tenantId),
  ]);
  const saved = new Map(rows.map((r) => [`${r.event_type}:${r.channel}`, r]));
  return {
    canEdit: scope.canEditSchool,
    ownProviders: own,
    variables: VARIABLES,
    events: Object.entries(EVENTS).map(([key, e]) => ({
      key,
      label: e.label,
      group: e.group,
      description: e.description,
      variables: e.variables,
      channels: Object.fromEntries(
        CHANNELS.map((channel) => {
          const custom = saved.get(`${key}:${channel}`) ?? null;
          const def = e.templates[channel];
          return [
            channel,
            {
              default: { ...def, params: def.params ?? placeholdersOf(def.body) },
              custom: viewTemplate(custom),
              applies: channel === 'email' || Boolean(own[channel]),
              preview: preview(key, channel, custom ? { name: custom.name, subject: custom.subject, body: custom.body, params: custom.params } : def),
            },
          ];
        }),
      ),
    })),
  };
}

function checkEvent(eventType, channel) {
  if (!EVENTS[eventType]) throw AppError.notFound('Unknown message', 'EVENT_NOT_FOUND');
  if (!CHANNELS.includes(channel)) throw AppError.notFound('Unknown channel', 'CHANNEL_NOT_FOUND');
}

export async function saveTemplate(auth, eventType, channel, input) {
  checkEvent(eventType, channel);
  const scope = await settingsScope(auth, { tenantId: input.tenantId });
  assertSchoolEditor(scope, 'message templates');
  const own = await ownProviders(scope.tenantId);
  if (channel !== 'email' && !own[channel]) {
    throw new AppError(422, 'OWN_ACCOUNT_REQUIRED', `Your ${channel === 'sms' ? 'SMS' : 'WhatsApp'} messages go out from the SM ERP account, whose templates are fixed. Connect your own account under Settings -> Communication to use your own text.`);
  }

  const errors = {};
  const problems = [...templateProblems(eventType, input.body), ...(channel === 'email' ? templateProblems(eventType, input.subject ?? '') : [])];
  if (problems.length) errors.body = problems;
  if (channel === 'email' && !input.subject?.trim()) errors.subject = ['Required'];
  let params = input.params?.length ? input.params : placeholdersOf(input.body);
  if (channel === 'whatsapp') {
    if (!input.name?.trim()) errors.name = [own.whatsapp === 'twilio' ? 'Content SID of the approved template (HX...)' : 'Name of the approved template'];
    else if (own.whatsapp === 'meta_cloud' && !META_NAME.test(input.name.trim())) errors.name = ['Lower-case letters, digits and _ only (Meta template names)'];
    else if (own.whatsapp === 'twilio' && !/^HX[0-9a-fA-F]{32}$/.test(input.name.trim())) errors.name = ['Twilio Content SID: HX followed by 32 characters'];
    const unknown = params.filter((p) => !EVENTS[eventType].variables.includes(p));
    if (unknown.length) errors.params = [`Not available for this message: ${unknown.join(', ')}`];
  }
  if (channel === 'sms') {
    if (own.sms === 'msg91' && !input.name?.trim()) errors.name = ['DLT template ID (or MSG91 flow ID) of this text'];
    if (/₹/.test(input.body)) errors.body = [...(errors.body ?? []), 'Use "Rs." instead of "₹" in SMS: ₹ makes the SMS Unicode (70 characters per part instead of 160)'];
  }
  if (Object.keys(errors).length) throw AppError.badRequest('Validation failed', { body: errors }, 'VALIDATION_ERROR');
  if (channel === 'sms') params = placeholdersOf(input.body);

  const { rows: [before] } = await pool.query(`SELECT * FROM message_templates WHERE tenant_id = $1 AND event_type = $2 AND channel = $3`, [scope.tenantId, eventType, channel]);
  const bodyChanged = !before || before.body !== input.body || before.name !== (input.name?.trim() || null) || JSON.stringify(before.params) !== JSON.stringify(params);
  let approval = before?.approval_status ?? 'not_required';
  if (channel === 'whatsapp') {
    if (own.whatsapp === 'meta_cloud') approval = bodyChanged ? 'draft' : approval;
    else approval = input.approvalStatus ?? (bodyChanged ? 'approved' : approval); // WATI / Twilio: approved in their panel
  }

  const { rows: [row] } = await pool.query(
    `INSERT INTO message_templates (tenant_id, event_type, channel, language, name, subject, body, params, approval_status, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (tenant_id, event_type, channel) DO UPDATE
        SET language = EXCLUDED.language, name = EXCLUDED.name, subject = EXCLUDED.subject, body = EXCLUDED.body,
            params = EXCLUDED.params, approval_status = EXCLUDED.approval_status, updated_by = EXCLUDED.updated_by,
            approval_note = CASE WHEN EXCLUDED.approval_status = 'draft' THEN NULL ELSE message_templates.approval_note END
     RETURNING *`,
    [scope.tenantId, eventType, channel, input.language ?? 'en', input.name?.trim() || null, channel === 'email' ? input.subject.trim() : null, input.body, params, approval, auth.userId],
  );
  await recordAudit(pool, {
    tenantId: scope.tenantId,
    actorUserId: auth.userId,
    area: 'templates',
    action: before ? 'update' : 'create',
    summary: `${EVENTS[eventType].label} (${channel}) template saved`,
    changes: diffValues(before ? { name: before.name, subject: before.subject, body: before.body, params: before.params } : {}, { name: row.name, subject: row.subject, body: row.body, params: row.params }),
  });
  invalidateSchoolMessaging(scope.tenantId);
  return viewTemplate(row);
}

export async function resetTemplate(auth, eventType, channel, { tenantId }) {
  checkEvent(eventType, channel);
  const scope = await settingsScope(auth, { tenantId });
  assertSchoolEditor(scope, 'message templates');
  const { rowCount } = await pool.query(`DELETE FROM message_templates WHERE tenant_id = $1 AND event_type = $2 AND channel = $3`, [scope.tenantId, eventType, channel]);
  if (rowCount) {
    await recordAudit(pool, { tenantId: scope.tenantId, actorUserId: auth.userId, area: 'templates', action: 'reset', summary: `${EVENTS[eventType].label} (${channel}) back to the default text` });
    invalidateSchoolMessaging(scope.tenantId);
  }
  return { reset: rowCount > 0 };
}

export function previewTemplate({ eventType, channel, body, subject, params, name }) {
  checkEvent(eventType, channel);
  const problems = [...templateProblems(eventType, body), ...(channel === 'email' ? templateProblems(eventType, subject ?? '') : [])];
  const r = renderChannel(channel, { body, subject, params: params?.length ? params : placeholdersOf(body), name, custom: true }, samples());
  const out = channel === 'email' ? { subject: r.subject, text: r.text } : { text: r.text, variables: r.variables };
  if (channel === 'sms') {
    const gsm = !/[^\x20-\x7E\n\r£¥èéùìòÇØøÅåÆæßÉ€]/.test(r.text);
    out.characters = r.text.length;
    out.segments = r.text.length <= (gsm ? 160 : 70) ? 1 : Math.ceil(r.text.length / (gsm ? 153 : 67));
    out.unicode = !gsm;
  }
  return { ...out, problems };
}

// ------------------------------------------------------------------ WhatsApp Cloud API: submit + sync

/** "{{student_name}} was absent on {{date}}" -> "{{1}} was absent on {{2}}" with params in order. */
export function numberedBody(body, params) {
  return String(body).replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, name) => {
    const i = params.indexOf(name);
    return i >= 0 ? `{{${i + 1}}}` : '';
  });
}

export async function submitWhatsappTemplate(auth, eventType, { tenantId }) {
  checkEvent(eventType, 'whatsapp');
  const scope = await settingsScope(auth, { tenantId });
  assertSchoolEditor(scope, 'message templates');
  const { rows: [row] } = await pool.query(`SELECT * FROM message_templates WHERE tenant_id = $1 AND event_type = $2 AND channel = 'whatsapp'`, [scope.tenantId, eventType]);
  if (!row) throw new AppError(422, 'TEMPLATE_NOT_SAVED', 'Save your WhatsApp text first, then submit it for approval.');
  const params = placeholdersOf(row.body);
  if (JSON.stringify(params) !== JSON.stringify(row.params)) {
    // Meta numbers parameters in the order they appear in the text.
    await pool.query(`UPDATE message_templates SET params = $2 WHERE id = $1`, [row.id, params]);
  }
  const meta = await metaProviderFor(scope);
  let result;
  try {
    result = await meta.submitTemplate({ name: row.name, language: row.language === 'hi' ? 'hi' : 'en', body: numberedBody(row.body, params), examples: params.map((p) => VARIABLES[p]?.sample ?? 'sample') });
  } catch (err) {
    if (err instanceof NotificationError) throw new AppError(422, 'META_REJECTED', `WhatsApp did not accept the template: ${err.message}`);
    throw err;
  }
  const status = ['approved', 'pending', 'rejected', 'paused'].includes(result.status) ? result.status : 'pending';
  await pool.query(
    `UPDATE message_templates SET approval_status = $2, provider_template_id = $3, submitted_at = now(), approval_note = NULL WHERE id = $1`,
    [row.id, status, result.id],
  );
  await recordAudit(pool, { tenantId: scope.tenantId, actorUserId: auth.userId, area: 'templates', action: 'submit', summary: `WhatsApp template "${row.name}" submitted to Meta (${status})` });
  invalidateSchoolMessaging(scope.tenantId);
  logger.info('WhatsApp template submitted', { tenantId: scope.tenantId, eventType, name: row.name, status });
  return { status, id: result.id };
}

const STATUS_FROM_META = { approved: 'approved', pending: 'pending', in_appeal: 'pending', rejected: 'rejected', paused: 'paused', disabled: 'rejected', pending_deletion: 'rejected' };

export async function syncWhatsappTemplates(auth, { tenantId }) {
  const scope = await settingsScope(auth, { tenantId });
  assertSchoolEditor(scope, 'message templates');
  const meta = await metaProviderFor(scope);
  let remote;
  try {
    remote = await meta.listTemplates();
  } catch (err) {
    if (err instanceof NotificationError) throw new AppError(422, 'META_REJECTED', `Could not read templates from WhatsApp: ${err.message}`);
    throw err;
  }
  const { rows } = await pool.query(`SELECT id, name, language FROM message_templates WHERE tenant_id = $1 AND channel = 'whatsapp'`, [scope.tenantId]);
  let updated = 0;
  for (const row of rows) {
    const match = remote.find((t) => t.name === row.name && (t.language === row.language || t.language?.startsWith(row.language))) ?? remote.find((t) => t.name === row.name);
    if (!match) continue;
    await pool.query(
      `UPDATE message_templates SET approval_status = $2, approval_note = $3, provider_template_id = $4, synced_at = now() WHERE id = $1`,
      [row.id, STATUS_FROM_META[match.status] ?? 'pending', match.rejectedReason, match.id],
    );
    updated += 1;
  }
  invalidateSchoolMessaging(scope.tenantId);
  return {
    updated,
    templates: remote.map((t) => ({ name: t.name, language: t.language, status: STATUS_FROM_META[t.status] ?? t.status, category: t.category, body: t.body })),
  };
}
