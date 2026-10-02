import { pool, withTransaction } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { ROLES } from '../../config/roles.js';
import { logger } from '../../utils/logger.js';
import { assertStaffAccess, conflict, loadSectionForStaff, loadTeacherScope, unprocessable } from '../shared/access.js';
import { takenPairs, uniquePairs } from '../shared/teacher-scope.helpers.js';
import { weekFrom } from '../timetable/timetable.service.js';
import * as repo from './assignments.repository.js';

const mapAssignment = (r) => ({
  id: r.id,
  section: { id: r.section_id, label: r.section_label },
  subject: { id: r.subject_id, name: r.subject_name, code: r.subject_code },
});

async function loadStaff(db, auth, staffId, opts) {
  const staff = await repo.getStaffMember(db, staffId, opts);
  assertStaffAccess(auth, staff, 'Staff member not found', 'STAFF_NOT_FOUND');
  return staff;
}

// =====================================================================
// Admins: one teacher's subjects
// =====================================================================

export async function getStaffAssignments(auth, staffId) {
  await loadStaff(pool, auth, staffId);
  return (await repo.listForStaff(pool, staffId)).map(mapAssignment);
}

/**
 * Replaces a teacher's current-year (section, subject) assignments. A pair already taught
 * by another teacher is a 409 SUBJECT_TAKEN unless `reassign` is true (then it moves).
 */
export async function putStaffAssignments(auth, staffId, { assignments, reassign }) {
  const pairs = uniquePairs(assignments);
  const result = await withTransaction(async (db) => {
    const staff = await loadStaff(db, auth, staffId, { lock: true });
    // One assignment write per branch at a time: two admins can't give the same subject to two teachers.
    await db.query(`SELECT pg_advisory_xact_lock(hashtext('assignments:' || $1::text))`, [staff.branch_id]);

    if (staff.role !== ROLES.TEACHER) {
      throw unprocessable('NOT_A_TEACHER', 'Subjects can only be assigned to teachers');
    }
    if (pairs.length && staff.status !== 'active') {
      throw unprocessable('STAFF_INACTIVE', 'Reactivate this teacher before assigning subjects');
    }
    const year = await repo.currentYear(db, staff.branch_id);
    if (!year) throw unprocessable('NO_CURRENT_YEAR', 'Set up the current academic year first');

    if (pairs.length) {
      const sectionIds = [...new Set(pairs.map((p) => p.sectionId))];
      const subjectIds = [...new Set(pairs.map((p) => p.subjectId))];
      const [sections, subjects] = await Promise.all([
        repo.sectionsInYear(db, staff.branch_id, year.id, sectionIds),
        repo.activeSubjects(db, staff.branch_id, subjectIds),
      ]);
      const badSections = sectionIds.filter((id) => !sections.has(id));
      const badSubjects = subjectIds.filter((id) => !subjects.has(id));
      if (badSections.length || badSubjects.length) {
        throw unprocessable('INVALID_REFERENCE', `Unknown sections (of ${year.name}) or inactive subjects for this branch`, {
          sectionIds: badSections, subjectIds: badSubjects,
        });
      }
    }

    const taken = takenPairs(
      pairs,
      (await repo.holdersOf(db, year.id, pairs)).map((h) => ({ ...h, sectionId: h.section_id, subjectId: h.subject_id, staffId: h.staff_id })),
      staff.id,
    );
    if (taken.length && !reassign) {
      const first = taken[0];
      throw conflict('SUBJECT_TAKEN', `${first.subject_name} in ${first.section_label} is already taught by ${first.teacher_name}. Send reassign: true to move it.`, {
        conflicts: taken.map((t) => ({
          section: { id: t.section_id, label: t.section_label },
          subject: { id: t.subject_id, name: t.subject_name },
          teacher: { staffId: t.staff_id, name: t.teacher_name },
        })),
      });
    }
    await repo.deleteByIds(db, taken.map((t) => t.id));
    await repo.replaceForStaff(db, { staff, yearId: year.id, pairs, userId: auth.userId });
    return { moved: taken.length };
  });
  logger.info('Teacher assignments saved', { staffId, count: pairs.length, moved: result.moved, by: auth.userId });
  return (await repo.listForStaff(pool, staffId)).map(mapAssignment);
}

// =====================================================================
// Staff: who teaches what in a section
// =====================================================================

export async function sectionAssignments(auth, sectionId) {
  const section = await loadSectionForStaff(pool, auth, sectionId);
  const rows = await repo.sectionSubjectTeachers(pool, section);
  return rows.map((r) => ({
    subject: { id: r.subject_id, name: r.subject_name, code: r.subject_code },
    teacher: r.staff_id ? { staffId: r.staff_id, name: r.teacher_name } : null,
  }));
}

// =====================================================================
// Teacher: own classes, subjects and week
// =====================================================================

export async function teacherAssignments(auth) {
  const scope = await loadTeacherScope(pool, auth);
  if (!scope.staffId) return { classTeacherOf: [], subjects: [] };
  const [ct, subjects] = await Promise.all([repo.classTeacherSections(pool, scope.staffId), repo.listForStaff(pool, scope.staffId)]);
  return {
    classTeacherOf: ct.map((s) => ({ sectionId: s.id, label: s.label })),
    subjects: subjects.map((r) => ({ section: { id: r.section_id, label: r.section_label }, subject: { id: r.subject_id, name: r.subject_name, code: r.subject_code } })),
  };
}

/** The teacher's own periods in every section, in the GET /timetable days shape (+ section). */
export async function teacherTimetable(auth) {
  const scope = await loadTeacherScope(pool, auth);
  if (!scope.staffId) throw AppError.notFound('No staff profile for this account', 'STAFF_NOT_FOUND');
  const [rows, name] = await Promise.all([repo.teacherPeriods(pool, scope.staffId), repo.staffName(pool, scope.staffId)]);
  const days = weekFrom(rows);
  // weekFrom keeps row order per day; add the section to each period.
  const byDay = new Map();
  for (const r of rows) {
    if (!byDay.has(r.weekday)) byDay.set(r.weekday, []);
    byDay.get(r.weekday).push(r);
  }
  for (const [weekday, list] of byDay) {
    days[weekday] = days[weekday].map((p, i) => ({ ...p, section: { id: list[i].section_id, label: list[i].section_label } }));
  }
  return { teacher: { staffId: scope.staffId, name }, days };
}
