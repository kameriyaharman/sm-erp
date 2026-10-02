import { withTransaction, pool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { ROLES } from '../../config/roles.js';
import { assertBranchAccess } from '../../middleware/scope.js';
import { logger } from '../../utils/logger.js';
import { kickDispatcher } from '../notifications/dispatcher.js';
import * as repo from './attendance.repository.js';
import { loadSectionForStaff } from '../shared/access.js';
import { attendanceStats, monthRange } from '../shared/school-ops.helpers.js';

// How far back each role may record or change attendance (0 = today only).
export const BACKDATE_DAYS = { teacher: 1, branch_admin: 30, super_admin: 30 };

const unprocessable = (code, message, details) => new AppError(422, code, message, details);

const daysBetween = (fromIso, toIso) => Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
const isoOf = (date) => (date instanceof Date ? date.toISOString().slice(0, 10) : String(date).slice(0, 10));

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-02" -> "Fri 2 Oct 2026" (calendar date, no timezone shift) */
function formatDisplayDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[weekday]} ${d} ${MONTHS[m - 1]} ${y}`;
}

/** Can this caller mark this section at all? Teachers only their own class; admins by scope. */
function assertSectionAccess(auth, ctx) {
  if (auth.role === ROLES.TEACHER) {
    if (!ctx.is_class_teacher || auth.tenantId !== ctx.tenant_id) {
      throw AppError.forbidden('Only the class teacher can take attendance for this section', 'NOT_CLASS_TEACHER');
    }
    return;
  }
  assertBranchAccess(auth, { tenantId: ctx.tenant_id, branchId: ctx.branch_id }, 'Section not found');
}

/** Returns null if editable, otherwise a user-facing reason. */
function editBlockReason(auth, ctx, date) {
  const today = isoOf(ctx.today);
  if (date > today) return 'Attendance cannot be recorded for a future date.';
  if (date < isoOf(ctx.year_start) || date > isoOf(ctx.year_end)) {
    return `The date is outside academic year ${ctx.academic_year}.`;
  }
  const window = BACKDATE_DAYS[auth.role] ?? 0;
  if (daysBetween(date, today) > window) {
    return window === 0
      ? 'You can only record attendance for today.'
      : `You can only change attendance from the last ${window} day${window === 1 ? '' : 's'}. Ask the branch admin for older dates.`;
  }
  return null;
}

async function loadSection(db, auth, sectionId) {
  const ctx = await repo.getSectionContext(db, sectionId, auth.userId);
  if (!ctx) throw AppError.notFound('Section not found', 'SECTION_NOT_FOUND');
  assertSectionAccess(auth, ctx);
  return ctx;
}

function mapSubmission(sub) {
  if (!sub) return null;
  return {
    submittedAt: sub.submitted_at,
    submittedBy: sub.submitted_by_name || null,
    updatedAt: sub.updated_at,
    updatedBy: sub.updated_by_name || null,
    revision: sub.revision,
    counts: { total: sub.total_students, present: sub.present_count, absent: sub.absent_count, other: sub.other_count },
  };
}

// =====================================================================
// Queries
// =====================================================================

export async function listSections(auth, { date }) {
  const rows = await repo.listMarkableSections(auth, auth.role, date);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    label: `${r.class_name} ${r.name}`,
    class: { id: r.class_id, name: r.class_name },
    branch: { id: r.branch_id, name: r.branch_name },
    academicYear: { id: r.academic_year_id, name: r.academic_year },
    classTeacher: r.class_teacher || null,
    isClassTeacher: r.is_class_teacher,
    studentCount: r.student_count,
    submission: r.submitted_at
      ? { submittedAt: r.submitted_at, present: r.present_count, absent: r.absent_count, total: r.total_students }
      : null,
  }));
}

export async function getRoster(auth, { sectionId, date }) {
  const ctx = await loadSection(pool, auth, sectionId);
  const day = date ?? isoOf(ctx.today);
  const [students, submission] = await Promise.all([repo.getRoster(pool, sectionId, day), repo.getSubmission(pool, sectionId, day)]);
  const blockReason = editBlockReason(auth, ctx, day);

  return {
    section: {
      id: ctx.id,
      name: ctx.name,
      label: `${ctx.class_name} ${ctx.name}`,
      className: ctx.class_name,
      branchName: ctx.branch_name,
      academicYear: ctx.academic_year,
      classTeacher: ctx.class_teacher || null,
    },
    date: day,
    today: isoOf(ctx.today),
    canEdit: blockReason === null,
    editBlockedReason: blockReason,
    submission: mapSubmission(submission),
    students: students.map((s) => ({
      studentId: s.student_id,
      name: s.student_name,
      rollNumber: s.roll_number,
      admissionNumber: s.admission_number,
      status: s.status,
      remarks: s.remarks,
      hasParentContact: s.has_parent_contact,
      notification: s.last_notification,
    })),
  };
}

export async function listNotifications(auth, { sectionId, date }) {
  const ctx = await loadSection(pool, auth, sectionId);
  const day = date ?? isoOf(ctx.today);
  const rows = await repo.notificationsFor(pool, sectionId, day);
  return rows.map((n) => ({
    id: n.id,
    studentId: n.student_id,
    studentName: n.student_name,
    parentName: n.parent_name,
    channel: n.channel,
    recipient: n.channel === 'email' ? n.recipient.replace(/^(.).*(@.*)$/, '$1•••$2') : n.recipient.replace(/\d(?=\d{3})/g, '•'),
    template: n.template,
    message: n.message,
    status: n.status,
    attempts: n.attempts,
    sentAt: n.sent_at,
    lastError: n.last_error,
  }));
}

// =====================================================================
// Submit
// =====================================================================

function absenceMessage({ parentName, studentName, label, schoolName, date }) {
  return `Dear ${parentName}, ${studentName} (${label}) was marked absent at ${schoolName} on ${formatDisplayDate(date)}. If this is unexpected, please contact the school office.`;
}

function correctionMessage({ parentName, studentName, schoolName, date }) {
  return `Dear ${parentName}, update from ${schoolName}: ${studentName} has been marked present on ${formatDisplayDate(date)}. Please ignore the earlier absence message.`;
}

function contactFor(recipient) {
  if (recipient.phone) return { channel: 'sms', recipient: recipient.phone };
  if (recipient.email) return { channel: 'email', recipient: recipient.email };
  return null;
}

/**
 * Saves the full register for a section and day in one transaction, then
 * queues parent notifications in the same transaction (outbox). Re-submitting
 * updates marks and only notifies about changes:
 *   newly absent                    -> absence message
 *   absent -> not absent, unsent    -> pending message cancelled
 *   absent -> not absent, sent      -> correction message
 */
export async function submitAttendance(auth, input) {
  const result = await withTransaction(async (db) => {
    const ctx = await loadSection(db, auth, input.sectionId);
    const date = input.date ?? isoOf(ctx.today);

    const blockReason = editBlockReason(auth, ctx, date);
    if (blockReason) throw unprocessable('ATTENDANCE_LOCKED', blockReason);

    await repo.lockSectionDay(db, ctx.id, date);

    // The register must be complete: every enrolled student, nobody else.
    const roster = await repo.getRoster(db, ctx.id, date);
    const rosterIds = new Set(roster.map((s) => s.student_id));
    const submittedIds = new Set(input.records.map((r) => r.studentId));
    const unknown = [...submittedIds].filter((id) => !rosterIds.has(id));
    const missing = [...rosterIds].filter((id) => !submittedIds.has(id));
    if (unknown.length > 0) {
      throw unprocessable('STUDENT_NOT_IN_SECTION', 'Some students are not enrolled in this section', { studentIds: unknown });
    }
    if (missing.length > 0) {
      throw unprocessable('ROSTER_INCOMPLETE', `Mark all ${roster.length} students before submitting (${missing.length} missing). The class list may have changed; reload it.`, {
        studentIds: missing,
      });
    }

    const before = await repo.previousStatuses(db, [...submittedIds], date);
    await repo.upsertAttendance(db, ctx, { date, records: input.records, markedBy: auth.userId });

    const counts = { total: input.records.length, present: 0, absent: 0, other: 0 };
    for (const r of input.records) {
      if (r.status === 'present') counts.present += 1;
      else if (r.status === 'absent') counts.absent += 1;
      else counts.other += 1;
    }
    const submission = await repo.upsertSubmission(db, ctx, { date, counts, userId: auth.userId });

    // ---- notifications (outbox)
    const newlyAbsent = input.records.filter((r) => r.status === 'absent' && before.get(r.studentId) !== 'absent').map((r) => r.studentId);
    const noLongerAbsent = input.records.filter((r) => r.status !== 'absent' && before.get(r.studentId) === 'absent').map((r) => r.studentId);

    const cancelled = noLongerAbsent.length ? await repo.cancelPendingAbsence(db, ctx.tenant_id, noLongerAbsent, date) : [];
    const alreadyInformed = noLongerAbsent.length ? await repo.studentsWithSentAbsence(db, ctx.tenant_id, noLongerAbsent, date) : new Set();
    const needCorrection = noLongerAbsent.filter((id) => alreadyInformed.has(id));

    const outbox = [];
    const skipped = [];
    if (input.notifyParents && (newlyAbsent.length || needCorrection.length)) {
      const recipients = await repo.getNoticeRecipients(db, [...newlyAbsent, ...needCorrection]);
      const byStudent = Map.groupBy ? Map.groupBy(recipients, (r) => r.student_id) : groupBy(recipients, (r) => r.student_id);
      const label = `${ctx.class_name} ${ctx.name}`;

      for (const [studentIds, template] of [[newlyAbsent, 'attendance_absent'], [needCorrection, 'attendance_correction']]) {
        for (const studentId of studentIds) {
          const parents = byStudent.get(studentId) ?? [];
          let queuedForStudent = 0;
          for (const parent of parents) {
            const contact = contactFor(parent);
            if (!contact) continue;
            const vars = { parentName: parent.parent_name, studentName: parent.student_name, label, schoolName: `${ctx.school_name}, ${ctx.branch_name}`, date };
            outbox.push({
              tenant_id: ctx.tenant_id,
              branch_id: ctx.branch_id,
              student_id: studentId,
              parent_user_id: parent.parent_user_id,
              channel: contact.channel,
              recipient: contact.recipient,
              template,
              payload: {
                date,
                sectionId: ctx.id,
                status: template === 'attendance_absent' ? 'absent' : 'present',
                studentName: parent.student_name,
                schoolName: `${ctx.school_name}, ${ctx.branch_name}`,
              },
              message: template === 'attendance_absent' ? absenceMessage(vars) : correctionMessage(vars),
              dedupe_key: `${template}:${studentId}:${date}:${parent.parent_user_id}`,
              created_by: auth.userId,
            });
            queuedForStudent += 1;
          }
          if (queuedForStudent === 0) skipped.push({ studentId, reason: 'NO_PARENT_CONTACT' });
        }
      }
    }
    const queued = await repo.enqueueNotifications(db, outbox);

    return {
      date,
      ctx,
      submission,
      counts,
      notifications: {
        queued: queued.filter((q) => q.template === 'attendance_absent').length,
        corrections: queued.filter((q) => q.template === 'attendance_correction').length,
        cancelled: cancelled.length,
        skipped,
      },
    };
  });

  if (result.notifications.queued + result.notifications.corrections > 0) kickDispatcher();

  logger.info('Attendance submitted', {
    sectionId: result.ctx.id,
    date: result.date,
    revision: result.submission.revision,
    ...result.counts,
    by: auth.userId,
  });

  return {
    sectionId: result.ctx.id,
    section: `${result.ctx.class_name} ${result.ctx.name}`,
    date: result.date,
    revision: result.submission.revision,
    updated: result.submission.revision > 1,
    submittedAt: result.submission.submitted_at,
    counts: result.counts,
    notifications: result.notifications,
    _tenantId: result.ctx.tenant_id,   // for cache invalidation; stripped by the controller
  };
}

function groupBy(items, keyOf) {
  const map = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

// =====================================================================
// Monthly history (any section of the caller's branch)
// =====================================================================

export async function attendanceHistory(auth, { sectionId, month }) {
  const section = await loadSectionForStaff(pool, auth, sectionId);
  const m = month ?? isoOf(section.today).slice(0, 7);
  const { from, to } = monthRange(m);
  const [days, students] = await Promise.all([repo.historyDays(pool, sectionId, from, to), repo.historyStudents(pool, sectionId, from, to)]);
  return {
    section: { id: section.id, label: `${section.class_name} ${section.name}` },
    month: m,
    days: days.map((d) => ({
      date: d.date,
      total: d.total,
      present: d.present,
      absent: d.absent,
      late: d.late,
      leave: d.leave,
      halfDay: d.half_day,
      submittedAt: d.submitted_at,
    })),
    students: students.map((s) => {
      const stats = attendanceStats(s);
      return {
        studentId: s.student_id,
        name: s.name,
        rollNumber: s.roll_number,
        present: stats.present,
        absent: stats.absent,
        late: stats.late,
        leave: stats.leave,
        halfDay: stats.halfDay,
        percentage: stats.percentage,
      };
    }),
  };
}
