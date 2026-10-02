/**
 * Pure rules for what a teacher may do (no database). Unit-tested in test/rbac.test.js.
 *
 * A teacher's scope for the current academic year:
 *   classTeacherOf   sections they are class teacher of
 *   assignments      (section, subject) pairs they teach (teacher_subject_assignments)
 *
 * Their "sections" = class-teacher sections + sections with at least one assignment.
 */

/**
 * @param {{ staffId?: string|null, classTeacherOf?: string[], assignments?: { sectionId: string, subjectId: string }[] }} input
 */
export function makeTeacherScope({ staffId = null, classTeacherOf = [], assignments = [] } = {}) {
  const ct = new Set(classTeacherOf);
  const pairs = new Set(assignments.map((a) => `${a.sectionId}:${a.subjectId}`));
  const assignedSections = new Set(assignments.map((a) => a.sectionId));
  return Object.freeze({
    staffId,
    classTeacherOf: ct,
    assignments: assignments.map((a) => ({ sectionId: a.sectionId, subjectId: a.subjectId })),
    assignedSections,
    sectionIds: new Set([...ct, ...assignedSections]),
  });
}

/** Teaches this subject in this section. */
export const teaches = (scope, sectionId, subjectId) =>
  Boolean(sectionId && subjectId) && scope.assignments.some((a) => a.sectionId === sectionId && a.subjectId === subjectId);

export const isClassTeacher = (scope, sectionId) => scope.classTeacherOf.has(sectionId);

/** Any connection with the section: class teacher or teaches something there. */
export const hasSection = (scope, sectionId) => scope.sectionIds.has(sectionId);

/**
 * Marks of one paper's subject in one section:
 *   'edit'  the subject teacher of that section
 *   'view'  the class teacher of that section (read-only)
 *   null    no access
 */
export function marksAccess(scope, sectionId, subjectId) {
  if (teaches(scope, sectionId, subjectId)) return 'edit';
  if (isClassTeacher(scope, sectionId)) return 'view';
  return null;
}

/**
 * The sections of a paper a teacher sees on their marks screen, or null when the paper is
 * not theirs. A paper is theirs when they teach its subject in at least one section that
 * sits it. Sections: the ones they teach the subject in (canEdit) plus their class-teacher
 * section (read-only).
 *
 * @param scope         makeTeacherScope(...)
 * @param paper         { subjectId, sectionId|null }
 * @param classSections [{ id, label }] current sections of the paper's class
 */
export function paperSectionsForTeacher(scope, paper, classSections) {
  const sitting = paper.sectionId ? classSections.filter((s) => s.id === paper.sectionId) : classSections;
  if (!sitting.some((s) => teaches(scope, s.id, paper.subjectId))) return null;
  return sitting
    .map((s) => ({ id: s.id, label: s.label, access: marksAccess(scope, s.id, paper.subjectId) }))
    .filter((s) => s.access)
    .map((s) => ({ id: s.id, label: s.label, canEdit: s.access === 'edit' }));
}

/**
 * Which (section, subject) pairs of a requested set are held by another teacher.
 * held: [{ sectionId, subjectId, staffId, ... }] current holders of those pairs.
 */
export function takenPairs(requested, held, staffId) {
  const want = new Set(requested.map((r) => `${r.sectionId}:${r.subjectId}`));
  return held.filter((h) => h.staffId !== staffId && want.has(`${h.sectionId}:${h.subjectId}`));
}

/** Removes duplicate { sectionId, subjectId } pairs, keeping the first. */
export function uniquePairs(pairs) {
  const seen = new Set();
  return pairs.filter((p) => {
    const key = `${p.sectionId}:${p.subjectId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Timetable clashes: the same teacher in two sections at the same weekday + period number.
 * periods: [{ id, sectionId, weekday, periodNo, teacherStaffId }]
 * Returns [[a, b], ...] clashing pairs.
 */
export function teacherClashes(periods) {
  const slots = new Map();
  const clashes = [];
  for (const p of periods) {
    if (!p.teacherStaffId) continue;
    const key = `${p.teacherStaffId}:${p.weekday}:${p.periodNo}`;
    const other = slots.get(key);
    if (other && other.sectionId !== p.sectionId) clashes.push([other, p]);
    else slots.set(key, p);
  }
  return clashes;
}
