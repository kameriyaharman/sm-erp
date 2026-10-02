import { query } from '../../db/pool.js';

// Students a paper is for: its class this year, and its section when the paper is section-specific.
const PAPER_STUDENTS = `
  SELECT count(*)::int FROM student_profiles sp
   WHERE sp.class_id = es.class_id AND sp.academic_year_id = es.academic_year_id
     AND (es.section_id IS NULL OR sp.section_id = es.section_id)
     AND sp.deleted_at IS NULL AND sp.status IN ('enrolled', 'suspended')`;

// ---------------------------------------------------------------- exams

const EXAM_SELECT = `
  SELECT e.id, e.tenant_id, e.branch_id, e.academic_year_id, e.name, e.exam_type, e.component_code, e.term_id, t.name AS term_name,
         e.start_date, e.end_date, e.status, e.results_published_at,
         (SELECT count(*)::int FROM exam_schedules es WHERE es.exam_id = e.id) AS papers,
         (SELECT count(*)::int FROM marks_entry m WHERE m.exam_id = e.id) AS marks_entered,
         (SELECT COALESCE(sum((${PAPER_STUDENTS})), 0)::int FROM exam_schedules es WHERE es.exam_id = e.id) AS marks_expected
    FROM exams e
    LEFT JOIN academic_terms t ON t.id = e.term_id`;

export async function listExams(scope) {
  const { rows } = await query(
    `${EXAM_SELECT}
      JOIN academic_years ay ON ay.id = e.academic_year_id AND ay.is_current
     WHERE ($1::uuid IS NULL OR e.tenant_id = $1) AND ($2::uuid[] IS NULL OR e.branch_id = ANY ($2))
     ORDER BY e.start_date NULLS LAST, e.name`,
    [scope.tenantId, scope.branchIds],
  );
  return rows;
}

export async function getExam(db, id, { forUpdate = false } = {}) {
  const { rows } = await db.query(`${EXAM_SELECT} WHERE e.id = $1 ${forUpdate ? 'FOR UPDATE OF e' : ''}`, [id]);
  return rows[0] ?? null;
}

export async function currentYear(db, branchId) {
  const { rows } = await db.query(`SELECT id, name FROM academic_years WHERE branch_id = $1 AND is_current`, [branchId]);
  return rows[0] ?? null;
}

export async function termInYear(db, termId, academicYearId) {
  const { rows } = await db.query(`SELECT id FROM academic_terms WHERE id = $1 AND academic_year_id = $2`, [termId, academicYearId]);
  return rows.length > 0;
}

export async function insertExam(db, e) {
  const { rows } = await db.query(
    `INSERT INTO exams (tenant_id, branch_id, academic_year_id, term_id, name, exam_type, component_code, start_date, end_date, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'scheduled', $10) RETURNING id`,
    [e.tenantId, e.branchId, e.academicYearId, e.termId ?? null, e.name, e.examType, e.componentCode ?? null, e.startDate ?? null, e.endDate ?? null, e.createdBy],
  );
  return rows[0].id;
}

export async function updateExam(db, id, patch) {
  const sets = [];
  const params = [id];
  const add = (column, value, cast = '') => { params.push(value); sets.push(`${column} = $${params.length}${cast}`); };
  if (patch.name !== undefined) add('name', patch.name);
  if (patch.startDate !== undefined) add('start_date', patch.startDate, '::date');
  if (patch.endDate !== undefined) add('end_date', patch.endDate, '::date');
  if (patch.status !== undefined) {
    add('status', patch.status, '::exam_status');
    if (patch.status === 'results_published') sets.push('results_published_at = COALESCE(results_published_at, now())');
  }
  await db.query(`UPDATE exams SET ${sets.join(', ')} WHERE id = $1`, params);
}

// ---------------------------------------------------------------- papers

const PAPER_SELECT = `
  SELECT es.id, es.exam_id, es.tenant_id, es.branch_id, es.academic_year_id, es.class_id, c.name AS class_name,
         es.section_id, s.name AS section_name, es.subject_id, sub.name AS subject_name, sub.code AS subject_code,
         es.exam_date, es.max_marks::float8 AS max_marks, es.pass_marks::float8 AS pass_marks, es.marks_locked,
         e.name AS exam_name, e.status AS exam_status, e.term_id, e.start_date AS exam_start,
         (SELECT count(*)::int FROM marks_entry m WHERE m.exam_schedule_id = es.id) AS entered,
         (${PAPER_STUDENTS}) AS students
    FROM exam_schedules es
    JOIN exams e         ON e.id = es.exam_id
    JOIN classes c       ON c.id = es.class_id
    JOIN subjects sub    ON sub.id = es.subject_id
    LEFT JOIN sections s ON s.id = es.section_id`;

export async function listPapers(db, examId, classId) {
  const { rows } = await db.query(
    `${PAPER_SELECT}
      WHERE es.exam_id = $1 AND ($2::uuid IS NULL OR es.class_id = $2)
      ORDER BY c.display_order, c.name, s.name NULLS FIRST, sub.display_order, sub.name`,
    [examId, classId ?? null],
  );
  return rows;
}

export async function getPaper(db, id, { lock } = {}) {
  const { rows } = await db.query(`${PAPER_SELECT} WHERE es.id = $1 ${lock ? `FOR ${lock} OF es` : ''}`, [id]);
  return rows[0] ?? null;
}

/** Current-year papers of every class in a branch (teacher shortcut), newest exam first. */
export async function listBranchPapers(branchId) {
  const { rows } = await query(
    `${PAPER_SELECT}
      JOIN academic_years ay ON ay.id = es.academic_year_id AND ay.is_current
     WHERE es.branch_id = $1
     ORDER BY e.start_date DESC NULLS LAST, e.name, c.display_order, c.name, s.name NULLS FIRST, sub.display_order, sub.name`,
    [branchId],
  );
  return rows;
}

export async function getClassInBranch(db, classId, branchId) {
  const { rows } = await db.query(`SELECT id FROM classes WHERE id = $1 AND branch_id = $2 AND deleted_at IS NULL`, [classId, branchId]);
  return rows[0] ?? null;
}

export async function activeSubjects(db, branchId, subjectIds) {
  const { rows } = await db.query(`SELECT id FROM subjects WHERE branch_id = $1 AND id = ANY ($2) AND status = 'active'`, [branchId, subjectIds]);
  return rows.map((r) => r.id);
}

export async function insertPapers(db, p) {
  const { rowCount } = await db.query(
    `INSERT INTO exam_schedules (tenant_id, branch_id, exam_id, academic_year_id, class_id, section_id, subject_id, exam_date, max_marks, pass_marks)
     SELECT $1, $2, $3, $4, $5, NULL, x.subject_id, $7, $8, $9
       FROM unnest($6::uuid[]) AS x(subject_id)
     ON CONFLICT ON CONSTRAINT uq_esch_paper DO NOTHING`,
    [p.tenantId, p.branchId, p.examId, p.academicYearId, p.classId, p.subjectIds, p.examDate, p.maxMarks, p.passMarks ?? null],
  );
  return rowCount;
}

export async function updatePaper(db, id, patch) {
  const sets = [];
  const params = [id];
  const add = (column, value) => { params.push(value); sets.push(`${column} = $${params.length}`); };
  if (patch.examDate !== undefined) add('exam_date', patch.examDate);
  if (patch.maxMarks !== undefined) add('max_marks', patch.maxMarks);
  if (patch.passMarks !== undefined) add('pass_marks', patch.passMarks);
  if (patch.marksLocked !== undefined) add('marks_locked', patch.marksLocked);
  if (sets.length) await db.query(`UPDATE exam_schedules SET ${sets.join(', ')} WHERE id = $1`, params);
}

export async function highestMark(db, paperId) {
  const { rows } = await db.query(`SELECT max(marks_obtained)::float8 AS max, count(*)::int AS n FROM marks_entry WHERE exam_schedule_id = $1`, [paperId]);
  return rows[0];
}

/** Re-copies max_marks from the paper onto its marks (the guard trigger does the copy). */
export async function refreshMarksMax(db, paperId) {
  await db.query(`UPDATE marks_entry SET updated_at = now() WHERE exam_schedule_id = $1`, [paperId]);
}

// ---------------------------------------------------------------- marks

export async function getSection(db, sectionId) {
  const { rows } = await db.query(
    `SELECT s.id, s.name, s.class_id, s.academic_year_id, s.branch_id, s.tenant_id, c.name AS class_name
       FROM sections s JOIN classes c ON c.id = s.class_id
      WHERE s.id = $1 AND s.deleted_at IS NULL`,
    [sectionId],
  );
  return rows[0] ?? null;
}

export async function sectionMarks(db, paperId, sectionId) {
  const { rows } = await db.query(
    `SELECT sp.id AS student_id, concat_ws(' ', u.first_name, u.last_name) AS name, sp.roll_number, sp.admission_number,
            m.marks_obtained::float8 AS marks_obtained, COALESCE(m.is_absent, false) AS is_absent, m.remarks
       FROM student_profiles sp
       JOIN users u ON u.id = sp.user_id
       LEFT JOIN marks_entry m ON m.student_id = sp.id AND m.exam_schedule_id = $1
      WHERE sp.section_id = $2 AND sp.deleted_at IS NULL AND sp.status IN ('enrolled', 'suspended')
      ORDER BY NULLIF(regexp_replace(sp.roll_number, '\\D', '', 'g'), '')::int NULLS LAST, name`,
    [paperId, sectionId],
  );
  return rows;
}

/** Of `studentIds`, those placed in the paper's class (and section) this year: id -> section id. */
export async function studentsInPaper(db, paper, studentIds) {
  const { rows } = await db.query(
    `SELECT sp.id, sp.section_id FROM student_profiles sp
      WHERE sp.id = ANY ($1) AND sp.class_id = $2 AND sp.academic_year_id = $3
        AND ($4::uuid IS NULL OR sp.section_id = $4) AND sp.deleted_at IS NULL`,
    [studentIds, paper.class_id, paper.academic_year_id, paper.section_id],
  );
  return new Map(rows.map((r) => [r.id, r.section_id]));
}

/** Current-year sections of a branch with labels (teacher paper lists). */
export async function branchSections(db, branchId) {
  const { rows } = await db.query(
    `SELECT s.id, s.class_id, c.name || ' ' || s.name AS label
       FROM sections s
       JOIN classes c ON c.id = s.class_id
       JOIN academic_years ay ON ay.id = s.academic_year_id AND ay.is_current
      WHERE s.branch_id = $1 AND s.deleted_at IS NULL
      ORDER BY c.display_order, c.name, s.name`,
    [branchId],
  );
  return rows;
}

/** Sections of a class in a year. */
export async function classSectionIds(db, classId, academicYearId) {
  const { rows } = await db.query(
    `SELECT id FROM sections WHERE class_id = $1 AND academic_year_id = $2 AND deleted_at IS NULL`,
    [classId, academicYearId],
  );
  return rows.map((r) => r.id);
}

export async function upsertMarks(db, paper, entries, userId) {
  if (entries.length === 0) return 0;
  const { rowCount } = await db.query(
    `INSERT INTO marks_entry (tenant_id, branch_id, exam_schedule_id, exam_id, subject_id, academic_year_id, term_id,
                              student_id, marks_obtained, max_marks, is_absent, remarks, entered_by)
     SELECT $1, $2, $3, $4, $5, $6, $7, x.student_id, x.marks, $8, x.absent, x.remarks, $9
       FROM unnest($10::uuid[], $11::numeric[], $12::boolean[], $13::text[]) AS x(student_id, marks, absent, remarks)
     ON CONFLICT (exam_schedule_id, student_id) DO UPDATE
        SET marks_obtained = EXCLUDED.marks_obtained,
            is_absent      = EXCLUDED.is_absent,
            remarks        = COALESCE(EXCLUDED.remarks, marks_entry.remarks),
            entered_by     = EXCLUDED.entered_by`,
    [paper.tenant_id, paper.branch_id, paper.id, paper.exam_id, paper.subject_id, paper.academic_year_id, paper.term_id,
      paper.max_marks, userId,
      entries.map((e) => e.studentId), entries.map((e) => e.marksObtained), entries.map((e) => e.isAbsent), entries.map((e) => e.remarks ?? null)],
  );
  return rowCount;
}

export async function deleteMarks(db, paperId, studentIds) {
  if (studentIds.length === 0) return 0;
  const { rowCount } = await db.query(`DELETE FROM marks_entry WHERE exam_schedule_id = $1 AND student_id = ANY ($2)`, [paperId, studentIds]);
  return rowCount;
}
