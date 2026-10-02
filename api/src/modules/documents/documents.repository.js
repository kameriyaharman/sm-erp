import { pool } from '../../db/pool.js';

// Letterhead columns, joined from branches + tenants (alias b, t).
const SCHOOL_COLUMNS = `
  t.name AS school_name, t.timezone, b.name AS branch_name, b.code AS branch_code, b.affiliation_no, b.school_code,
  b.udise_code, b.address_line1, b.address_line2, b.city, b.state, b.postal_code, b.phone AS branch_phone,
  b.email AS branch_email, b.settings AS branch_settings`;

// ===================================================================== report cards: inputs

/** Section + class + year + school, and whether `userId` is its class teacher. */
export async function getSectionContext(db, sectionId, userId) {
  const { rows } = await db.query(
    `SELECT s.id AS section_id, s.name AS section_name, s.tenant_id, s.branch_id, s.academic_year_id,
            c.id AS class_id, c.name AS class_name, c.numeric_level,
            ay.name AS academic_year, ay.start_date AS year_start, ay.end_date AS year_end,
            concat_ws(' ', tu.first_name, tu.last_name) AS class_teacher,
            (tsf.user_id IS NOT NULL AND tsf.user_id = $2 AND tsf.status = 'active') AS is_class_teacher,
            ${SCHOOL_COLUMNS}
       FROM sections s
       JOIN classes c         ON c.id = s.class_id
       JOIN academic_years ay ON ay.id = s.academic_year_id
       JOIN branches b        ON b.id = s.branch_id
       JOIN tenants t         ON t.id = s.tenant_id
       LEFT JOIN staff_profiles tsf ON tsf.id = s.class_teacher_id
       LEFT JOIN users tu           ON tu.id = tsf.user_id
      WHERE s.id = $1 AND s.deleted_at IS NULL`,
    [sectionId, userId ?? null],
  );
  return rows[0] ?? null;
}

export async function getTerms(db, academicYearId) {
  const { rows } = await db.query(
    `SELECT id, name, sequence_no, start_date, end_date FROM academic_terms WHERE academic_year_id = $1 ORDER BY sequence_no`,
    [academicYearId],
  );
  return rows;
}

/** Every student placed in the class this year (all sections): needed for class rank. */
export async function getClassStudents(db, classId, academicYearId) {
  const { rows } = await db.query(
    `SELECT sp.id, sp.section_id, sp.roll_number, sp.admission_number, sp.date_of_birth, sp.father_name, sp.mother_name,
            sp.guardian_name, sp.pen_number, sp.apaar_id, concat_ws(' ', u.first_name, u.last_name) AS name,
            sec.name AS section_name
       FROM student_profiles sp
       JOIN users u ON u.id = sp.user_id
       LEFT JOIN sections sec ON sec.id = sp.section_id
      WHERE sp.class_id = $1 AND sp.academic_year_id = $2 AND sp.deleted_at IS NULL
        AND sp.status IN ('enrolled', 'suspended')
      ORDER BY sec.name, NULLIF(regexp_replace(sp.roll_number, '\\D', '', 'g'), '')::int NULLS LAST, name`,
    [classId, academicYearId],
  );
  return rows;
}

/** Subjects with a paper for this class this year, in display order. */
export async function getClassSubjects(db, classId, academicYearId) {
  const { rows } = await db.query(
    `SELECT DISTINCT sub.id, sub.name, sub.code, sub.is_graded_only, sub.display_order
       FROM exam_schedules es
       JOIN subjects sub ON sub.id = es.subject_id
      WHERE es.class_id = $1 AND es.academic_year_id = $2
      ORDER BY sub.display_order, sub.name`,
    [classId, academicYearId],
  );
  return rows;
}

/** All component marks for the class in the given terms (exams without a component code are ignored). */
export async function getClassMarks(db, classId, academicYearId, termIds) {
  const { rows } = await db.query(
    `SELECT m.student_id, m.subject_id, m.term_id, e.component_code AS component,
            m.marks_obtained::float8 AS marks_obtained, m.max_marks::float8 AS max_marks,
            m.is_absent, m.is_exempted, m.grade, es.exam_date
       FROM marks_entry m
       JOIN exam_schedules es ON es.id = m.exam_schedule_id
       JOIN exams e           ON e.id = m.exam_id
      WHERE es.class_id = $1 AND m.academic_year_id = $2 AND m.term_id = ANY ($3)
        AND e.component_code IS NOT NULL AND e.status <> 'draft'`,
    [classId, academicYearId, termIds],
  );
  return rows;
}

export async function getAttendanceCounts(db, studentIds, academicYearId, untilDate) {
  const { rows } = await db.query(
    `SELECT student_id,
            count(*) FILTER (WHERE status = 'present')::int  AS present,
            count(*) FILTER (WHERE status = 'late')::int     AS late,
            count(*) FILTER (WHERE status = 'half_day')::int AS half_day,
            count(*) FILTER (WHERE status = 'absent')::int   AS absent,
            count(*) FILTER (WHERE status = 'leave')::int    AS leave
       FROM student_attendance
      WHERE student_id = ANY ($1) AND academic_year_id = $2 AND attendance_date <= $3
      GROUP BY student_id`,
    [studentIds, academicYearId, untilDate],
  );
  return new Map(rows.map((r) => [r.student_id, r]));
}

/** Branch grade scale named `scaleName`, as [{ grade, min, gradePoint, passing }], or null. */
export async function getGradeScale(db, branchId, scaleName = 'cbse') {
  const { rows } = await db.query(
    `SELECT grade, min_percentage::float8 AS min, grade_point::float8 AS "gradePoint", is_passing AS passing, description
       FROM grade_scales WHERE branch_id = $1 AND scale_name = $2 ORDER BY min_percentage DESC`,
    [branchId, scaleName],
  );
  return rows.length ? rows : null;
}

export async function getNextClass(db, branchId, numericLevel) {
  if (numericLevel == null) return null;
  const { rows } = await db.query(
    `SELECT name, numeric_level FROM classes
      WHERE branch_id = $1 AND numeric_level = $2 + 1 AND deleted_at IS NULL AND status = 'active' LIMIT 1`,
    [branchId, numericLevel],
  );
  return rows[0] ?? null;
}

// ===================================================================== report cards: rows

export async function getReportCardStates(db, studentIds, academicYearId, termId) {
  const { rows } = await db.query(
    `SELECT student_id, id, status FROM report_cards
      WHERE student_id = ANY ($1) AND academic_year_id = $2 AND term_id IS NOT DISTINCT FROM $3`,
    [studentIds, academicYearId, termId],
  );
  return new Map(rows.map((r) => [r.student_id, r]));
}

/** Insert or refresh a draft/generated card. Remarks and a manual result are kept on refresh. */
export async function upsertReportCard(db, card) {
  const { rows } = await db.query(
    `INSERT INTO report_cards
            (tenant_id, branch_id, student_id, academic_year_id, term_id, class_id, section_id, total_marks, max_marks,
             overall_grade, grade_point, rank_in_section, rank_in_class, days_present, days_total, subject_summary,
             co_scholastic, result, status, generated_at, scheme_code, is_final, snapshot)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17::jsonb, $18,
             'generated', now(), $19, $20, $21::jsonb)
     ON CONFLICT ON CONSTRAINT uq_rc_student_term DO UPDATE
        SET class_id = EXCLUDED.class_id, section_id = EXCLUDED.section_id,
            total_marks = EXCLUDED.total_marks, max_marks = EXCLUDED.max_marks,
            overall_grade = EXCLUDED.overall_grade, grade_point = EXCLUDED.grade_point,
            rank_in_section = EXCLUDED.rank_in_section, rank_in_class = EXCLUDED.rank_in_class,
            days_present = EXCLUDED.days_present, days_total = EXCLUDED.days_total,
            subject_summary = EXCLUDED.subject_summary, co_scholastic = EXCLUDED.co_scholastic,
            -- keep a result the school set by hand; otherwise take the computed suggestion
            result = CASE WHEN report_cards.result_is_manual THEN report_cards.result ELSE EXCLUDED.result END,
            status = 'generated', generated_at = now(), scheme_code = EXCLUDED.scheme_code,
            is_final = EXCLUDED.is_final, snapshot = EXCLUDED.snapshot
      WHERE report_cards.status IN ('draft', 'generated')
     RETURNING id`,
    [
      card.tenantId, card.branchId, card.studentId, card.academicYearId, card.termId, card.classId, card.sectionId,
      card.totalMarks, card.maxMarks, card.overallGrade, card.gradePoint, card.rankInSection, card.rankInClass,
      card.daysPresent, card.daysTotal, JSON.stringify(card.subjectSummary), JSON.stringify(card.coScholastic),
      card.result, card.schemeCode, card.isFinal, JSON.stringify(card.snapshot),
    ],
  );
  return rows[0]?.id ?? null;
}

export async function getReportCardForUser(db, id, userId) {
  const { rows } = await db.query(
    `SELECT rc.*,
            EXISTS (SELECT 1 FROM sections s JOIN staff_profiles sf ON sf.id = s.class_teacher_id
                     WHERE s.id = rc.section_id AND sf.user_id = $2 AND sf.status = 'active') AS is_class_teacher,
            sp.user_id AS student_user_id
       FROM report_cards rc
       JOIN student_profiles sp ON sp.id = rc.student_id
      WHERE rc.id = $1`,
    [id, userId],
  );
  return rows[0] ?? null;
}

export async function updateReportCard(db, id, patch) {
  const { rows } = await db.query(
    `UPDATE report_cards
        SET teacher_remarks   = CASE WHEN $2::boolean THEN $3 ELSE teacher_remarks END,
            principal_remarks = CASE WHEN $4::boolean THEN $5 ELSE principal_remarks END,
            result            = COALESCE($6::result_status, result),
            result_is_manual  = result_is_manual OR $6 IS NOT NULL
      WHERE id = $1 AND status IN ('draft', 'generated')
      RETURNING id`,
    [id, 'teacherRemarks' in patch, patch.teacherRemarks ?? null, 'principalRemarks' in patch, patch.principalRemarks ?? null, patch.result ?? null],
  );
  return rows.length > 0;
}

/** Lock the generated (unpublished) cards of a section/term; returns their ids. */
export async function lockPublishable(db, { sectionId, academicYearId, termId }) {
  const { rows } = await db.query(
    `SELECT id FROM report_cards
      WHERE section_id = $1 AND academic_year_id = $2 AND term_id IS NOT DISTINCT FROM $3 AND status = 'generated'
      ORDER BY id FOR UPDATE`,
    [sectionId, academicYearId, termId],
  );
  return rows.map((r) => r.id);
}

/** Publish the given cards, each with its own verification code (kept if one already exists). */
export async function publishReportCards(db, { ids, codes, userId }) {
  const { rowCount } = await db.query(
    `UPDATE report_cards rc
        SET status = 'published', published_at = now(), published_by = $3,
            verification_code = COALESCE(rc.verification_code, x.code)
       FROM unnest($1::uuid[], $2::text[]) AS x(id, code)
      WHERE rc.id = x.id`,
    [ids, codes, userId],
  );
  return rowCount;
}

export async function listReportCardsForStudent(db, studentId, { publishedOnly }) {
  const { rows } = await db.query(
    `SELECT rc.id, rc.academic_year_id, ay.name AS academic_year, rc.term_id, t.name AS term_name, rc.is_final,
            rc.percentage::text, rc.overall_grade, rc.result, rc.status, rc.published_at
       FROM report_cards rc
       JOIN academic_years ay ON ay.id = rc.academic_year_id
       LEFT JOIN academic_terms t ON t.id = rc.term_id
      WHERE rc.student_id = $1 AND ($2::boolean IS FALSE OR rc.status = 'published')
      ORDER BY ay.start_date DESC, t.sequence_no DESC NULLS FIRST`,
    [studentId, publishedOnly],
  );
  return rows;
}

/** Report cards of one section for a term (termId null = annual / final cards), in roll order. */
export async function listSectionReportCards(db, { sectionId, academicYearId, termId }) {
  const { rows } = await db.query(
    `SELECT rc.id, rc.student_id, concat_ws(' ', u.first_name, u.last_name) AS name, sp.roll_number, rc.status,
            rc.percentage::float8 AS percentage, rc.overall_grade, rc.rank_in_section, rc.result, rc.teacher_remarks, rc.published_at
       FROM report_cards rc
       JOIN student_profiles sp ON sp.id = rc.student_id
       JOIN users u             ON u.id = sp.user_id
      WHERE rc.section_id = $1 AND rc.academic_year_id = $2 AND rc.term_id IS NOT DISTINCT FROM $3
      ORDER BY NULLIF(regexp_replace(sp.roll_number, '\\D', '', 'g'), '')::int NULLS LAST, name`,
    [sectionId, academicYearId, termId],
  );
  return rows;
}

// ===================================================================== certificates: inputs

/** Everything the TC / bonafide needs about a student, locked when issuing. */
export async function getStudentRecord(db, studentId, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `SELECT sp.*, concat_ws(' ', u.first_name, u.last_name) AS name,
            c.name AS class_name, c.numeric_level, sec.name AS section_name,
            ac.name AS admission_class_name, ac.numeric_level AS admission_class_level,
            ay.id AS current_year_id, ay.name AS academic_year, ay.start_date AS year_start, ay.end_date AS year_end,
            concat_ws(' ', pu.first_name, pu.last_name) AS parent_name,
            ${SCHOOL_COLUMNS}
       FROM student_profiles sp
       JOIN users u            ON u.id = sp.user_id
       JOIN branches b         ON b.id = sp.branch_id
       JOIN tenants t          ON t.id = sp.tenant_id
       LEFT JOIN classes c     ON c.id = sp.class_id
       LEFT JOIN sections sec  ON sec.id = sp.section_id
       LEFT JOIN classes ac    ON ac.id = sp.admission_class_id
       LEFT JOIN academic_years ay ON ay.id = COALESCE(sp.academic_year_id,
                 (SELECT id FROM academic_years WHERE branch_id = sp.branch_id AND is_current LIMIT 1))
       LEFT JOIN users pu      ON pu.id = sp.parent_id
      WHERE sp.id = $1 AND sp.deleted_at IS NULL
      ${forUpdate ? 'FOR UPDATE OF sp' : ''}`,
    [studentId],
  );
  return rows[0] ?? null;
}

/** Latest annual (final) report card of the student, for "last exam taken with result". */
export async function getLatestFinalResult(db, studentId) {
  const { rows } = await db.query(
    `SELECT rc.result, rc.status, ay.name AS academic_year, c.name AS class_name, c.numeric_level, rc.percentage::float8 AS percentage
       FROM report_cards rc
       JOIN academic_years ay ON ay.id = rc.academic_year_id
       JOIN classes c         ON c.id = rc.class_id
      WHERE rc.student_id = $1 AND rc.is_final AND rc.status = 'published'
      ORDER BY ay.start_date DESC LIMIT 1`,
    [studentId],
  );
  return rows[0] ?? null;
}

/** How many times a final report card said 'detained' for the class the student is in now. */
export async function countDetentionsInClass(db, studentId, classId) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM report_cards
      WHERE student_id = $1 AND class_id = $2 AND is_final AND status = 'published' AND result IN ('detained', 'fail')`,
    [studentId, classId],
  );
  return rows[0].n;
}

export async function getSubjectsStudied(db, studentId, academicYearId) {
  const { rows } = await db.query(
    `SELECT DISTINCT sub.name, sub.display_order
       FROM marks_entry m JOIN subjects sub ON sub.id = m.subject_id
      WHERE m.student_id = $1 AND m.academic_year_id = $2 AND NOT sub.is_graded_only AND NOT m.is_exempted
      ORDER BY sub.display_order, sub.name`,
    [studentId, academicYearId],
  );
  return rows.map((r) => r.name);
}

/** Fee position: outstanding balance, last month fully covered, concessions on record. */
export async function getFeePosition(db, studentId) {
  const { rows } = await db.query(
    `SELECT
        COALESCE((SELECT sum(balance_amount) FROM fee_invoices WHERE student_id = $1 AND status IN ('unpaid', 'partially_paid')), 0)::text AS outstanding,
        (SELECT max(i.due_date) FROM fee_invoices i
          WHERE i.student_id = $1 AND i.status = 'paid'
            AND i.due_date < COALESCE((SELECT min(due_date) FROM fee_invoices
                                        WHERE student_id = $1 AND status IN ('unpaid', 'partially_paid')), 'infinity'::date)) AS paid_up_to,
        (SELECT string_agg(DISTINCT COALESCE(a.concession_reason, a.concession_type::text), ', ')
           FROM student_fee_allocations a
          WHERE a.student_id = $1 AND a.concession_type <> 'none') AS concessions`,
    [studentId],
  );
  return rows[0];
}

// ===================================================================== certificates: rows

export async function insertCertificate(db, cert) {
  const { rows } = await db.query(
    `INSERT INTO certificates
            (tenant_id, branch_id, student_id, certificate_type, certificate_number, verification_code, content, content_sha256, issued_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
     RETURNING id`,
    [cert.tenantId, cert.branchId, cert.studentId, cert.type, cert.number, cert.verificationCode, JSON.stringify(cert.content), cert.sha256, cert.issuedBy],
  );
  return rows[0].id;
}

export async function markStudentLeft(db, studentId, { leavingDate }) {
  await db.query(
    `UPDATE student_profiles SET status = 'transferred', date_of_leaving = $2 WHERE id = $1`,
    [studentId, leavingDate],
  );
}

export async function getActiveTc(db, studentId) {
  const { rows } = await db.query(
    `SELECT id, certificate_number FROM certificates
      WHERE student_id = $1 AND certificate_type = 'transfer_certificate' AND status = 'issued'`,
    [studentId],
  );
  return rows[0] ?? null;
}

export async function getCertificate(db, id, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM certificates WHERE id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id],
  );
  return rows[0] ?? null;
}

export async function recordPrint(db, id) {
  const { rows } = await db.query(
    `UPDATE certificates SET print_count = print_count + 1, last_printed_at = now() WHERE id = $1 RETURNING print_count`,
    [id],
  );
  return rows[0].print_count;
}

export async function cancelCertificate(db, id, { userId, reason }) {
  await db.query(
    `UPDATE certificates SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3 WHERE id = $1`,
    [id, userId, reason],
  );
}

export async function listCertificates(db, { scope, studentId, type, limit = 50 }) {
  const { rows } = await db.query(
    `SELECT c.id, c.certificate_type, c.certificate_number, c.status, c.issued_at, c.print_count, c.student_id,
            c.content->'student'->>'name' AS student_name, c.content->'student'->>'admissionNumber' AS admission_number
       FROM certificates c
      WHERE ($1::uuid IS NULL OR c.tenant_id = $1)
        AND ($2::uuid[] IS NULL OR c.branch_id = ANY ($2))
        AND ($3::uuid IS NULL OR c.student_id = $3)
        AND ($4::certificate_type IS NULL OR c.certificate_type = $4)
      ORDER BY c.issued_at DESC LIMIT $5`,
    [scope.tenantId, scope.branchIds, studentId ?? null, type ?? null, limit],
  );
  return rows;
}

// ===================================================================== public verification

export async function findByVerificationCode(code) {
  const cert = await pool.query(
    `SELECT 'certificate' AS kind, c.certificate_type AS type, c.certificate_number AS number, c.status::text,
            c.issued_at, c.cancelled_at, c.content_sha256, c.content->'student'->>'name' AS student_name,
            c.content->'student'->>'className' AS class_name, c.content->'school'->>'name' AS school_name
       FROM certificates c WHERE c.verification_code = $1`,
    [code],
  );
  if (cert.rows[0]) return cert.rows[0];
  const rc = await pool.query(
    `SELECT 'report_card' AS kind, CASE WHEN rc.is_final THEN 'annual_report_card' ELSE 'term_report_card' END AS type,
            rc.snapshot->'student'->>'admissionNumber' || ' / ' || ay.name AS number, rc.status::text,
            rc.published_at AS issued_at, NULL::timestamptz AS cancelled_at, NULL AS content_sha256,
            rc.snapshot->'student'->>'name' AS student_name, rc.snapshot->'student'->>'className' AS class_name,
            rc.snapshot->'school'->>'name' AS school_name, rc.percentage::text AS percentage, rc.overall_grade, rc.result::text
       FROM report_cards rc JOIN academic_years ay ON ay.id = rc.academic_year_id
      WHERE rc.verification_code = $1 AND rc.status IN ('published', 'revoked')`,
    [code],
  );
  return rc.rows[0] ?? null;
}
