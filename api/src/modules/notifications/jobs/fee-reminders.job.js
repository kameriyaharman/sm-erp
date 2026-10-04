import { randomUUID } from 'node:crypto';
import { pool } from '../../../db/pool.js';

/**
 * Fee due reminders for split dues.
 *
 * A student's fee is split into installments (one invoice per quarter, per
 * term...). For every student with open invoices that are overdue or due within
 * `daysAhead` days, this job adds up the open balance across those installments
 * and sends ONE reminder per parent/guardian:
 *   "fee of Rs.<total of open installments> is due on <earliest due date>"
 * with a link to pay in the parent portal.
 *
 * Idempotent per day: the dedupe key fee_due:<student>:<parent>:<date> means a
 * second run on the same day (cron overlap, manual re-run) sends nothing new.
 */
export async function findDueFeesForReminders({ tenantId, branchIds, daysAhead, includeOverdue, today, classId = null, sectionId = null }) {
  const { rows } = await pool.query(
    `WITH due AS (
       SELECT i.tenant_id, i.branch_id, i.student_id,
              sum(i.balance_amount)               AS amount,
              min(i.due_date)                     AS due_date,
              count(*)::int                       AS installments,
              bool_or(i.due_date < $3::date)      AS has_overdue
         FROM fee_invoices i
        WHERE i.status IN ('unpaid', 'partially_paid')
          AND i.balance_amount > 0
          AND i.due_date <= $3::date + $4::int
          AND ($5 OR i.due_date >= $3::date)
          AND ($1::uuid   IS NULL OR i.tenant_id = $1)
          AND ($2::uuid[] IS NULL OR i.branch_id = ANY ($2))
        GROUP BY i.tenant_id, i.branch_id, i.student_id
     )
     SELECT d.tenant_id, d.branch_id, d.student_id, d.amount::text AS amount, d.due_date,
            d.installments, d.has_overdue,
            concat_ws(' ', su.first_name, su.last_name) AS student_name,
            concat(t.name, ', ', b.name)                AS school_name,
            pu.id AS parent_user_id, concat_ws(' ', pu.first_name, pu.last_name) AS parent_name, pu.phone
       FROM due d
       JOIN student_profiles sp ON sp.id = d.student_id AND sp.deleted_at IS NULL
                               AND ($6::uuid IS NULL OR sp.class_id = $6) AND ($7::uuid IS NULL OR sp.section_id = $7)
       JOIN users su            ON su.id = sp.user_id
       JOIN branches b          ON b.id = d.branch_id
       JOIN tenants t           ON t.id = d.tenant_id AND t.status = 'active'
       JOIN users pu
         ON pu.deleted_at IS NULL AND pu.status = 'active'
        AND (pu.id = sp.parent_id
             OR pu.id IN (SELECT g.guardian_user_id FROM student_guardians g
                           WHERE g.student_id = sp.id AND g.receives_notices))
      ORDER BY d.due_date, d.student_id`,
    [tenantId ?? null, branchIds ?? null, today, daysAhead, includeOverdue, classId ?? null, sectionId ?? null],
  );
  return rows;
}

/**
 * @param {object} options
 * @param {import('../NotificationService.js').NotificationService} options.notifier
 * @param {string} options.portalUrl          https base of the parent portal, e.g. https://app.dps.in
 * @param {string} [options.tenantId]
 * @param {string[]} [options.branchIds]
 * @param {number} [options.daysAhead]        remind this many days before the due date
 * @param {boolean} [options.includeOverdue]
 * @param {string} [options.classId]          only students of this class
 * @param {string} [options.sectionId]        only students of this section
 * @param {string} [options.today]            YYYY-MM-DD (defaults to today, Asia/Kolkata)
 * @param {string} [options.createdBy]
 * @param {string} [options.batchId]
 */
export async function runFeeDueReminders({
  notifier,
  portalUrl,
  tenantId,
  branchIds,
  daysAhead = 3,
  includeOverdue = true,
  classId = null,
  sectionId = null,
  today = todayInIndia(),
  createdBy,
  batchId = randomUUID(),
  logger = notifier.logger,
}) {
  const summary = { batchId, date: today, students: 0, reminders: 0, sent: 0, failed: 0, alreadySent: 0, noPhone: 0, failures: [] };
  let rows;
  try {
    rows = await findDueFeesForReminders({ tenantId, branchIds, daysAhead, includeOverdue, today, classId, sectionId });
  } catch (err) {
    logger.error('Fee reminder run could not read dues', { batchId, error: err.message });
    return { ...summary, error: { code: 'QUERY_FAILED', message: err.message } };
  }

  summary.students = new Set(rows.map((r) => r.student_id)).size;
  for (const row of rows) {
    if (!row.phone) {
      summary.noPhone += 1;
      continue;
    }
    summary.reminders += 1;
    const link = `${portalUrl.replace(/\/$/, '')}/parent/fees?child=${row.student_id}`;
    const result = await notifier.sendFeeDueReminder(row.phone, row.parent_name, row.amount, row.due_date, link, {
      tenantId: row.tenant_id,
      branchId: row.branch_id,
      studentId: row.student_id,
      recipientUserId: row.parent_user_id,
      schoolName: row.school_name,
      batchId,
      createdBy,
      dedupeKey: `fee_due:${row.student_id}:${row.parent_user_id}:${today}`,
    });
    if (result.duplicate) summary.alreadySent += 1;
    else if (result.ok) summary.sent += 1;
    else {
      summary.failed += 1;
      summary.failures.push({ studentId: row.student_id, parentUserId: row.parent_user_id, code: result.error.code, logId: result.logId });
    }
  }

  logger.info('Fee reminder run finished', {
    batchId, date: today, students: summary.students, sent: summary.sent, failed: summary.failed,
    alreadySent: summary.alreadySent, noPhone: summary.noPhone,
  });
  return summary;
}

function todayInIndia() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}
