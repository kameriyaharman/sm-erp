import { pool, withTransaction } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { conflict, loadSectionForStaff, unprocessable } from '../shared/access.js';
import { emptyWeek, overlaps, validateTimetable } from '../shared/school-ops.helpers.js';
import * as repo from './timetable.repository.js';

const DEFAULT_LABELS = { break: 'Break', assembly: 'Assembly', activity: 'Activity' };

/** Display label: subject name for classes, free text otherwise. */
export const periodLabel = (p) => (p.kind === 'class' && p.subject_name ? p.subject_name : p.label ?? p.subject_name ?? DEFAULT_LABELS[p.kind] ?? '');

/** { "1": Period[], ..., "6": Period[] } in the GET /timetable shape. */
export function weekFrom(rows) {
  const days = emptyWeek();
  for (const p of rows) {
    days[p.weekday]?.push({
      periodNo: p.period_no,
      start: p.start,
      end: p.end,
      kind: p.kind,
      subject: p.subject_id ? { id: p.subject_id, name: p.subject_name } : null,
      label: periodLabel(p),
      teacher: p.teacher_staff_id ? { staffId: p.teacher_staff_id, name: p.teacher_name } : null,
      room: p.room,
    });
  }
  return days;
}

export async function sectionTimetable(section) {
  return {
    section: { id: section.id, label: `${section.class_name} ${section.name}` },
    days: weekFrom(await repo.sectionPeriods(pool, section.id)),
  };
}

export async function getTimetable(auth, { sectionId }) {
  return sectionTimetable(await loadSectionForStaff(pool, auth, sectionId));
}

const invalid = (issues) => AppError.badRequest(
  'Validation failed',
  { body: Object.fromEntries(issues.map((i) => [i.path, [i.message]])) },
  'VALIDATION_ERROR',
);

/** Replaces the whole week for a section, after structural, reference and teacher-clash checks. */
export async function putTimetable(auth, { sectionId, periods }) {
  const issues = validateTimetable(periods);
  if (issues.length) throw invalid(issues);

  const section = await loadSectionForStaff(pool, auth, sectionId);
  await withTransaction(async (db) => {
    // One timetable write per branch at a time, so two sections can't double-book a teacher concurrently.
    await db.query(`SELECT pg_advisory_xact_lock(hashtext('timetable:' || $1::text))`, [section.branch_id]);

    const subjectIds = [...new Set(periods.map((p) => p.subjectId).filter(Boolean))];
    const staffIds = [...new Set(periods.map((p) => p.teacherStaffId).filter(Boolean))];
    const subjects = subjectIds.length ? await repo.subjectsInBranch(db, section.branch_id, subjectIds) : new Set();
    const staff = staffIds.length ? await repo.staffInBranch(db, section.branch_id, staffIds) : new Set();
    const badSubjects = subjectIds.filter((id) => !subjects.has(id));
    const badStaff = staffIds.filter((id) => !staff.has(id));
    if (badSubjects.length || badStaff.length) {
      throw unprocessable('INVALID_REFERENCE', 'Unknown subjects or teachers for this branch', { subjectIds: badSubjects, teacherStaffIds: badStaff });
    }

    if (staffIds.length) {
      const elsewhere = await repo.otherSectionsPeriods(db, { sectionId, academicYearId: section.academic_year_id, staffIds });
      const clashes = [];
      for (const p of periods.filter((x) => x.teacherStaffId)) {
        const hit = elsewhere.find((o) => o.teacher_staff_id === p.teacherStaffId && o.weekday === p.weekday && overlaps(o, p));
        if (hit) clashes.push({ weekday: p.weekday, periodNo: p.periodNo, teacher: hit.teacher_name, section: hit.section_label, at: `${hit.start}-${hit.end}` });
      }
      if (clashes.length) {
        throw conflict('TEACHER_CLASH', `${clashes[0].teacher} already teaches ${clashes[0].section} at ${clashes[0].at} that day`, { clashes });
      }
    }
    await repo.replacePeriods(db, section, periods);
  });
  return sectionTimetable(section);
}
