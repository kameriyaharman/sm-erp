import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { AppError } from '../../errors/AppError.js';
import { assertBranchAccess, resolveBranchScope } from '../../middleware/scope.js';
import { logger } from '../../utils/logger.js';
import { getNotifier } from './index.js';
import { findDueFeesForReminders, runFeeDueReminders } from './jobs/fee-reminders.job.js';
import { batchSummary, findLog, listLogs } from './notification-logs.repository.js';
import { maskPhone } from './phone.js';
import { findNoticeRecipients } from './recipients.repository.js';

const notifier = () => getNotifier({ env, logger });

/** Platform super admins must pick a tenant: nobody blasts every school at once. */
async function scopeFor(auth, { tenantId, branchId }) {
  const scope = await resolveBranchScope(auth, { tenantId, branchId });
  if (!scope.tenantId) {
    throw new AppError(422, 'TENANT_REQUIRED', 'Choose a school (tenantId) for this action');
  }
  return scope;
}

// ---------------------------------------------------------------- broadcast

export async function createBroadcast(req, res) {
  const { targetRole, title, body, tenantId, branchId } = req.valid.body;
  const scope = await scopeFor(req.auth, { tenantId, branchId });
  const branch = scope.branchIds?.[0];

  // Resolve recipients now so the response can say how many; send in the background.
  const recipients = await findNoticeRecipients({ role: targetRole, tenantId: scope.tenantId, branchId: branch });
  const batchId = randomUUID();

  notifier()
    .sendBroadcastNotice(targetRole, title, body, {
      tenantId: scope.tenantId,
      branchId: branch,
      createdBy: req.auth.userId,
      batchId,
      recipients,
    })
    .catch((err) => logger.error('Broadcast crashed', { batchId, error: err.message })); // sendBroadcastNotice never rejects; belt and braces

  res.status(202).location(`${req.baseUrl}/batches/${batchId}`).json({
    data: {
      batchId,
      targetRole,
      recipients: recipients.length,
      withPhone: recipients.filter((r) => r.phone).length,
      statusUrl: `${req.baseUrl}/batches/${batchId}`,
    },
  });
}

// ---------------------------------------------------------------- fee reminders

export async function runFeeReminders(req, res) {
  if (!env.PARENT_PORTAL_URL) {
    throw new AppError(503, 'NOT_CONFIGURED', 'Set PARENT_PORTAL_URL so reminders can include a payment link');
  }
  const { daysAhead, includeOverdue, tenantId, branchId, classId, sectionId, dryRun } = req.valid.body;
  const scope = await scopeFor(req.auth, { tenantId, branchId });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

  if (dryRun) {
    const rows = await findDueFeesForReminders({ tenantId: scope.tenantId, branchIds: scope.branchIds, daysAhead, includeOverdue, today, classId, sectionId });
    res.json({
      data: {
        dryRun: true,
        date: today,
        students: new Set(rows.map((r) => r.student_id)).size,
        reminders: rows.filter((r) => r.phone).length,
        noPhone: rows.filter((r) => !r.phone).length,
        totalDue: rows
          .filter((r, i, all) => all.findIndex((x) => x.student_id === r.student_id) === i)
          .reduce((sum, r) => sum + Number(r.amount), 0)
          .toFixed(2),
      },
    });
    return;
  }

  const batchId = randomUUID();
  runFeeDueReminders({
    notifier: notifier(),
    portalUrl: env.PARENT_PORTAL_URL,
    tenantId: scope.tenantId,
    branchIds: scope.branchIds,
    daysAhead,
    includeOverdue,
    classId,
    sectionId,
    today,
    createdBy: req.auth.userId,
    batchId,
  }).catch((err) => logger.error('Fee reminder run crashed', { batchId, error: err.message }));

  res.status(202).location(`${req.baseUrl}/batches/${batchId}`).json({ data: { batchId, date: today, statusUrl: `${req.baseUrl}/batches/${batchId}` } });
}

// ---------------------------------------------------------------- batches + logs

export async function getBatch(req, res) {
  const rows = await batchSummary(req.valid.params.batchId);
  if (rows.length === 0) {
    // Nothing logged yet (just started, or nobody to message): report an empty batch.
    res.json({ data: { batchId: req.valid.params.batchId, total: 0, sent: 0, inProgress: 0, failed: 0, abandoned: 0, retryScheduled: 0 } });
    return;
  }
  rows.forEach((r) => assertBranchAccess(req.auth, { tenantId: r.tenant_id, branchId: r.branch_id }, 'Batch not found'));
  const sum = (key) => rows.reduce((s, r) => s + r[key], 0);
  res.json({
    data: {
      batchId: req.valid.params.batchId,
      eventType: rows[0].event_type,
      total: sum('total'),
      sent: sum('sent'),
      inProgress: sum('in_progress'),
      failed: sum('failed'),
      abandoned: sum('abandoned'),
      retryScheduled: sum('retry_scheduled'),
      startedAt: rows.map((r) => r.started_at).sort()[0],
      lastUpdateAt: rows.map((r) => r.last_update_at).sort().at(-1),
    },
  });
}

function presentLog(row) {
  return {
    id: row.id,
    batchId: row.batch_id,
    eventType: row.event_type,
    template: row.template,
    channel: row.channel,
    provider: row.provider,
    recipient: { userId: row.recipient_user_id, name: row.recipient_name || null, phone: maskPhone(row.recipient_phone) },
    student: row.student_id ? { id: row.student_id, name: row.student_name } : null,
    status: row.status,
    attempts: row.attempts,
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    nextRetryAt: row.next_retry_at,
    lastError: row.last_error_code ? { code: row.last_error_code, message: row.last_error_message, httpStatus: row.last_http_status } : null,
    providerMessageId: row.provider_message_id,
    sentAt: row.sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getLogs(req, res) {
  const { tenantId, branchId, page, limit, ...filters } = req.valid.query;
  const scope = await scopeFor(req.auth, { tenantId, branchId });
  const rows = await listLogs({ tenantId: scope.tenantId, branchIds: scope.branchIds, page, limit, ...filters });
  const total = rows.length ? Number(rows[0].total_count) : 0;
  res.json({ data: rows.map(presentLog), meta: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}

export async function retryLog(req, res) {
  const row = await findLog(req.valid.params.id);
  if (!row) throw AppError.notFound('Notification not found', 'NOTIFICATION_NOT_FOUND');
  assertBranchAccess(req.auth, { tenantId: row.tenant_id, branchId: row.branch_id }, 'Notification not found');
  if (row.status === 'sent') throw new AppError(409, 'ALREADY_SENT', 'This message was already delivered to the gateway');
  if (row.status === 'sending') throw new AppError(409, 'IN_PROGRESS', 'This message is being sent right now');

  const result = await notifier().retryLog(row.id);
  if (!result) throw new AppError(409, 'NOT_RETRYABLE', 'This message cannot be retried right now');
  const updated = await findLog(row.id);
  res.status(result.ok ? 200 : 502).json({
    data: { ...presentLog(updated), recipient: { userId: updated.recipient_user_id, phone: maskPhone(updated.recipient_phone) } },
  });
}
