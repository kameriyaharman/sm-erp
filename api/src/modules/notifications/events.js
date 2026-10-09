import { env } from '../../config/env.js';
import { pool } from '../../db/pool.js';
import { logger } from '../../utils/logger.js';
import { safeZone, sendAtFor } from '../../utils/time.js';
import { getNoticeRecipients, enqueueNotifications } from '../academics/attendance.repository.js';
import { kickDispatcher } from './dispatcher.js';
import { getNotifier } from './index.js';

/**
 * Parent messages for things that happen elsewhere in the ERP: a fee receipt, published report
 * cards, new homework. Called AFTER the business transaction committed, fire-and-forget: a
 * messaging problem never fails the receipt or the publish.
 *
 * Messages go through the attendance outbox (parent_notifications), so they survive a restart,
 * are retried, and show up in the delivery log. Nothing is queued when the school's rule for the
 * event is off.
 */

/**
 * @param {object} p
 * @param {string} p.tenantId
 * @param {string} p.eventType           catalog key
 * @param {string[]} p.studentIds
 * @param {(student: object) => object} p.varsFor   event variables for one student row
 * @param {string} p.dedupe             unique per event occurrence, e.g. the receipt ID
 * @param {string|null} [p.createdBy]
 */
export async function emitStudentEvent({ tenantId, eventType, studentIds, varsFor, dedupe, createdBy = null }) {
  if (!studentIds?.length) return { queued: 0 };
  const notifier = getNotifier({ env, logger });
  const rule = await notifier.ruleFor(tenantId, eventType);
  if (!rule?.enabled) return { queued: 0, skipped: 'RULE_OFF' };

  const { rows: students } = await pool.query(
    `SELECT sp.id, sp.tenant_id, sp.branch_id, sp.section_id, concat_ws(' ', u.first_name, u.last_name) AS name,
            concat_ws(' ', c.name, s.name) AS class_label, concat(t.name, ', ', b.name) AS school_name, t.timezone
       FROM student_profiles sp
       JOIN users u    ON u.id = sp.user_id
       JOIN tenants t  ON t.id = sp.tenant_id
       JOIN branches b ON b.id = sp.branch_id
       LEFT JOIN classes c  ON c.id = sp.class_id
       LEFT JOIN sections s ON s.id = sp.section_id
      WHERE sp.id = ANY ($1) AND sp.tenant_id = $2 AND sp.deleted_at IS NULL`,
    [studentIds, tenantId],
  );
  const byId = new Map(students.map((s) => [s.id, s]));
  const parents = await getNoticeRecipients(pool, students.map((s) => s.id));
  const outbox = [];
  for (const parent of parents) {
    const student = byId.get(parent.student_id);
    if (!student) continue;
    if (rule.audience === 'primary_parent' && !parent.is_primary) continue;
    if (!parent.phone && !parent.email) continue;
    const vars = { schoolName: student.school_name, studentName: student.name, className: student.class_label, parentName: parent.parent_name, ...varsFor(student) };
    outbox.push({
      tenant_id: student.tenant_id,
      branch_id: student.branch_id,
      student_id: student.id,
      parent_user_id: parent.parent_user_id,
      channel: parent.phone ? 'sms' : 'email',
      recipient: parent.phone ?? parent.email,
      template: eventType,
      payload: { studentName: student.name, schoolName: student.school_name, phone: parent.phone ?? null, email: parent.email ?? null, vars, sectionId: student.section_id },
      message: `${eventType}: ${student.name}`,
      dedupe_key: `${eventType}:${dedupe}:${student.id}:${parent.parent_user_id}`,
      created_by: createdBy,
      next_attempt_at: sendAtFor(rule.timing, { timeZone: safeZone(student.timezone) }).toISOString(),
    });
  }
  // Large classes: insert in chunks to keep each statement small.
  let queued = 0;
  for (let i = 0; i < outbox.length; i += 500) {
    queued += (await enqueueNotifications(pool, outbox.slice(i, i + 500))).length;
  }
  if (queued) kickDispatcher();
  return { queued };
}

const fire = (label, promise) =>
  promise.catch((err) => logger.error('Event notification failed', { event: label, error: err.message }));

// ------------------------------------------------------------------ the events

/** A receipt was issued (counter or online). */
export function notifyFeeReceipt(receiptId, createdBy = null) {
  return fire('fee_receipt', (async () => {
    const { rows: [r] } = await pool.query(
      `SELECT r.id, r.tenant_id, r.student_id, r.receipt_number, r.amount::text AS amount,
              (r.received_at AT TIME ZONE t.timezone)::date::text AS day
         FROM fee_receipts r JOIN tenants t ON t.id = r.tenant_id
        WHERE r.id = $1`,
      [receiptId],
    );
    if (!r) return null;
    return emitStudentEvent({
      tenantId: r.tenant_id,
      eventType: 'fee_receipt',
      studentIds: [r.student_id],
      dedupe: r.id,
      createdBy,
      varsFor: () => ({ amount: r.amount, receiptNumber: r.receipt_number, date: r.day }),
    });
  })());
}

/** Report cards of a section were published. */
export function notifyReportCardsPublished({ tenantId, sectionId, termId = null, publishedBy = null }) {
  return fire('report_card_published', (async () => {
    const { rows } = await pool.query(
      `SELECT rc.student_id, COALESCE(t.name, 'final') AS term_name
         FROM report_cards rc LEFT JOIN academic_terms t ON t.id = rc.term_id
        WHERE rc.section_id = $1 AND rc.status = 'published' AND rc.term_id IS NOT DISTINCT FROM $2::uuid
          AND rc.published_at > now() - interval '10 minutes'`,
      [sectionId, termId],
    );
    if (!rows.length) return null;
    const termName = rows[0].term_name === 'final' ? 'final' : rows[0].term_name;
    const portal = env.PARENT_PORTAL_URL ? `${env.PARENT_PORTAL_URL.replace(/\/$/, '')}/parent/report-card` : '';
    return emitStudentEvent({
      tenantId,
      eventType: 'report_card_published',
      studentIds: rows.map((r) => r.student_id),
      dedupe: `${sectionId}:${termId ?? 'final'}`,
      createdBy: publishedBy,
      varsFor: () => ({ termName, portalLink: portal }),
    });
  })());
}

/** A teacher set homework for a section. */
export function notifyHomework({ tenantId, sectionId, homeworkId, title, subjectName, dueDate, createdBy = null }) {
  return fire('homework_assigned', (async () => {
    const { rows } = await pool.query(
      `SELECT id FROM student_profiles WHERE section_id = $1 AND status = 'enrolled' AND deleted_at IS NULL`,
      [sectionId],
    );
    return emitStudentEvent({
      tenantId,
      eventType: 'homework_assigned',
      studentIds: rows.map((r) => r.id),
      dedupe: homeworkId,
      createdBy,
      varsFor: () => ({ homeworkTitle: title, subjectName: subjectName ?? 'class', dueDate }),
    });
  })());
}
