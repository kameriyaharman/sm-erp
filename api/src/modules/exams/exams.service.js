import { pool, withTransaction } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { logger } from '../../utils/logger.js';
import { ROLES } from '../../config/roles.js';
import { assertStaffAccess, conflict, isAdmin, loadTeacherScope, notAssigned, resolveWriteBranch, staffScope, unprocessable } from '../shared/access.js';
import { marksAccess, paperSectionsForTeacher, teaches } from '../shared/teacher-scope.helpers.js';
import * as repo from './exams.repository.js';

function mapExam(e) {
  return {
    id: e.id,
    name: e.name,
    examType: e.exam_type,
    componentCode: e.component_code,
    term: e.term_id ? { id: e.term_id, name: e.term_name } : null,
    startDate: e.start_date,
    endDate: e.end_date,
    status: e.status,
    papers: e.papers,
    marksEntered: e.marks_entered,
    marksExpected: e.marks_expected,
  };
}

function mapPaper(p, { withExam = false } = {}) {
  return {
    id: p.id,
    examId: p.exam_id,
    ...(withExam && { exam: { id: p.exam_id, name: p.exam_name, status: p.exam_status } }),
    class: { id: p.class_id, name: p.class_name },
    section: p.section_id ? { id: p.section_id, name: p.section_name } : null,
    subject: { id: p.subject_id, name: p.subject_name, code: p.subject_code },
    examDate: p.exam_date,
    maxMarks: p.max_marks,
    passMarks: p.pass_marks,
    marksLocked: p.marks_locked,
    entered: p.entered,
    students: p.students,
  };
}

async function loadExam(db, auth, id, opts) {
  const exam = await repo.getExam(db, id, opts);
  assertStaffAccess(auth, exam, 'Exam not found', 'EXAM_NOT_FOUND');
  return exam;
}

async function loadPaper(db, auth, id, opts) {
  const paper = await repo.getPaper(db, id, opts);
  assertStaffAccess(auth, paper, 'Paper not found', 'PAPER_NOT_FOUND');
  return paper;
}

// =====================================================================
// Exams
// =====================================================================

export async function listExams(auth, { branchId, ...filters }) {
  return (await repo.listExams(await staffScope(auth, { branchId }), filters)).map(mapExam);
}

export async function createExam(auth, input) {
  const { tenantId, branchId } = await resolveWriteBranch(auth, input.branchId);
  const id = await withTransaction(async (db) => {
    const year = await repo.currentYear(db, branchId);
    if (!year) throw unprocessable('NO_CURRENT_YEAR', 'Set up the current academic year first');
    if (input.termId && !(await repo.termInYear(db, input.termId, year.id))) {
      throw unprocessable('TERM_NOT_IN_YEAR', `That term is not part of ${year.name}`);
    }
    return repo.insertExam(db, { ...input, tenantId, branchId, academicYearId: year.id, createdBy: auth.userId });
  });
  logger.info('Exam created', { examId: id, by: auth.userId });
  return mapExam(await repo.getExam(pool, id));
}

export async function updateExam(auth, id, patch) {
  await withTransaction(async (db) => {
    const exam = await loadExam(db, auth, id, { forUpdate: true });
    const start = patch.startDate !== undefined ? patch.startDate : exam.start_date;
    const end = patch.endDate !== undefined ? patch.endDate : exam.end_date;
    if (start && end && end < start) {
      throw AppError.badRequest('Validation failed', { body: { endDate: ['End date must be on or after the start date'] } }, 'VALIDATION_ERROR');
    }
    await repo.updateExam(db, id, patch);
  });
  return mapExam(await repo.getExam(pool, id));
}

// =====================================================================
// Papers
// =====================================================================

export async function listPapers(auth, examId, { classId, subjectId }) {
  await loadExam(pool, auth, examId);
  return (await repo.listPapers(pool, examId, classId, subjectId)).map((p) => mapPaper(p));
}

export async function createPapers(auth, examId, input) {
  return withTransaction(async (db) => {
    const exam = await loadExam(db, auth, examId);
    if (!(await repo.getClassInBranch(db, input.classId, exam.branch_id))) throw AppError.notFound('Class not found', 'CLASS_NOT_FOUND');
    const subjectIds = [...new Set(input.subjectIds)];
    const known = new Set(await repo.activeSubjects(db, exam.branch_id, subjectIds));
    const unknown = subjectIds.filter((s) => !known.has(s));
    if (unknown.length) throw unprocessable('SUBJECT_NOT_FOUND', 'Unknown or inactive subjects for this branch', { subjectIds: unknown });

    const created = await repo.insertPapers(db, {
      tenantId: exam.tenant_id,
      branchId: exam.branch_id,
      examId,
      academicYearId: exam.academic_year_id,
      classId: input.classId,
      subjectIds,
      examDate: input.examDate,
      maxMarks: input.maxMarks,
      passMarks: input.passMarks,
    });
    return { created, skipped: subjectIds.length - created };
  });
}

export async function updatePaper(auth, id, patch) {
  await withTransaction(async (db) => {
    const paper = await loadPaper(db, auth, id, { lock: 'UPDATE' });
    const maxMarks = patch.maxMarks ?? paper.max_marks;
    const passMarks = patch.passMarks !== undefined ? patch.passMarks : paper.pass_marks;
    if (passMarks != null && passMarks > maxMarks) {
      throw AppError.badRequest('Validation failed', { body: { passMarks: ['Pass marks cannot exceed the maximum'] } }, 'VALIDATION_ERROR');
    }

    const maxChanged = patch.maxMarks !== undefined && patch.maxMarks !== paper.max_marks;
    const marks = maxChanged ? await repo.highestMark(db, id) : { n: 0 };
    if (maxChanged && marks.n > 0) {
      if (paper.marks_locked && patch.marksLocked !== false) {
        throw conflict('PAPER_LOCKED', 'Marks for this paper are locked. Unlock it to change the maximum marks.');
      }
      if (marks.max != null && marks.max > patch.maxMarks) {
        throw unprocessable('MARKS_EXCEED_MAX', `A student already has ${marks.max} marks, more than the new maximum of ${patch.maxMarks}`);
      }
      // Unlocked while the stored marks pick up the new maximum, then the requested lock state.
      await repo.updatePaper(db, id, { ...patch, marksLocked: false });
      await repo.refreshMarksMax(db, id);
      if (patch.marksLocked) await repo.updatePaper(db, id, { marksLocked: true });
      return;
    }
    await repo.updatePaper(db, id, patch);
  });
  return mapPaper(await repo.getPaper(pool, id));
}

/**
 * The teacher's marks screen: current-year papers of subjects they teach in some section
 * of the paper's class. `sections` = the sections they may open (canEdit: subject teacher;
 * read-only: their class-teacher section).
 */
export async function listTeacherPapers(auth) {
  const [scope, papers, sections] = await Promise.all([
    loadTeacherScope(pool, auth),
    repo.listBranchPapers(auth.branchId),
    repo.branchSections(pool, auth.branchId),
  ]);
  const byClass = Map.groupBy(sections, (s) => s.class_id);
  const out = [];
  for (const p of papers) {
    const mine = paperSectionsForTeacher(scope, { subjectId: p.subject_id, sectionId: p.section_id }, byClass.get(p.class_id) ?? []);
    if (mine) out.push({ ...mapPaper(p, { withExam: true }), sections: mine });
  }
  return out;
}

// =====================================================================
// Marks
// =====================================================================

async function resolveMarksSection(db, auth, paper, sectionId) {
  const id = sectionId ?? paper.section_id;
  if (!id) {
    throw AppError.badRequest('Validation failed', { query: { sectionId: ['Required for a paper set for the whole class'] } }, 'VALIDATION_ERROR');
  }
  const section = await repo.getSection(db, id);
  assertStaffAccess(auth, section, 'Section not found', 'SECTION_NOT_FOUND');
  if (section.class_id !== paper.class_id || section.academic_year_id !== paper.academic_year_id) {
    throw unprocessable('SECTION_NOT_IN_PAPER', 'This section does not sit this paper');
  }
  if (paper.section_id && paper.section_id !== section.id) {
    throw unprocessable('SECTION_NOT_IN_PAPER', 'This paper is set for another section');
  }
  return section;
}

/**
 * Teacher: the subject teacher of that section may edit; the class teacher may view
 * (canEdit false); anyone else 403 NOT_ASSIGNED. Admins: canEdit true.
 */
export async function getMarks(auth, { paperId, sectionId }) {
  const paper = await loadPaper(pool, auth, paperId);
  const section = await resolveMarksSection(pool, auth, paper, sectionId);
  let canEdit = isAdmin(auth);
  if (auth.role === ROLES.TEACHER) {
    const access = marksAccess(await loadTeacherScope(pool, auth), section.id, paper.subject_id);
    if (!access) throw notAssigned(`You do not teach ${paper.subject_name} in ${section.class_name} ${section.name}`);
    canEdit = access === 'edit';
  }
  const students = await repo.sectionMarks(pool, paper.id, section.id);
  return {
    paper: { ...mapPaper(paper), exam: { id: paper.exam_id, name: paper.exam_name } },
    section: { id: section.id, name: section.name, label: `${section.class_name} ${section.name}` },
    canEdit,
    students: students.map((s) => ({
      studentId: s.student_id,
      name: s.name,
      rollNumber: s.roll_number,
      admissionNumber: s.admission_number,
      marksObtained: s.marks_obtained,
      isAbsent: s.is_absent,
      remarks: s.remarks,
    })),
  };
}

/**
 * Upserts a batch of marks for one paper. Absent = entered with no marks; marks null and
 * not absent = cleared (row deleted).
 */
export async function saveMarks(auth, { paperId, entries }) {
  const result = await withTransaction(async (db) => {
    // FOR SHARE: a concurrent lock / max-marks change waits for this save, and vice versa.
    const paper = await loadPaper(db, auth, paperId, { lock: 'SHARE' });
    // Teacher: only the sections where they teach this paper's subject.
    let teacherScope = null;
    if (auth.role === ROLES.TEACHER) {
      teacherScope = await loadTeacherScope(db, auth);
      const sitting = paper.section_id ? [paper.section_id] : await repo.classSectionIds(db, paper.class_id, paper.academic_year_id);
      if (!sitting.some((s) => teaches(teacherScope, s, paper.subject_id))) {
        throw notAssigned(`You do not teach ${paper.subject_name} to this class`);
      }
    }

    if (paper.marks_locked) throw conflict('PAPER_LOCKED', 'Marks for this paper are locked. Ask the school office to unlock it.');

    const outOfRange = {};
    entries.forEach((e, i) => {
      if (e.marksObtained !== null && e.marksObtained > paper.max_marks) {
        outOfRange[`entries.${i}.marksObtained`] = [`Must be between 0 and ${paper.max_marks}`];
      }
    });
    if (Object.keys(outOfRange).length) throw AppError.badRequest('Validation failed', { body: outOfRange }, 'VALIDATION_ERROR');

    const inClass = await repo.studentsInPaper(db, paper, entries.map((e) => e.studentId));
    const strangers = entries.filter((e) => !inClass.has(e.studentId)).map((e) => e.studentId);
    if (strangers.length) {
      throw unprocessable('STUDENT_NOT_IN_CLASS', 'Some students do not sit this paper', { studentIds: strangers });
    }
    if (teacherScope) {
      const others = entries.filter((e) => !teaches(teacherScope, inClass.get(e.studentId), paper.subject_id)).map((e) => e.studentId);
      if (others.length) {
        throw new AppError(403, 'NOT_ASSIGNED', `Some students are in a section where you do not teach ${paper.subject_name}`, { studentIds: others });
      }
    }

    const toClear = entries.filter((e) => e.marksObtained === null && !e.isAbsent).map((e) => e.studentId);
    const toSave = entries.filter((e) => e.marksObtained !== null || e.isAbsent);
    const saved = await repo.upsertMarks(db, paper, toSave, auth.userId);
    const cleared = await repo.deleteMarks(db, paper.id, toClear);
    return { saved, cleared };
  });
  logger.info('Marks saved', { paperId, ...result, by: auth.userId });
  return result;
}
