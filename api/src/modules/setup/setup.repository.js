import { pool } from '../../db/pool.js';

/**
 * SQL for academic setup and the school profile. Every function takes `db` (pool or a
 * transaction client) first; ids are checked against the branch by the service.
 */

// ===================================================================== academic years + terms

export async function listYears(db, branchId) {
  const { rows } = await db.query(
    `SELECT ay.id, ay.tenant_id, ay.branch_id, ay.name, ay.start_date, ay.end_date, ay.is_current, ay.status,
            (SELECT count(*)::int FROM sections s WHERE s.academic_year_id = ay.id AND s.deleted_at IS NULL) AS section_count,
            (SELECT count(*)::int FROM student_profiles sp
              WHERE sp.academic_year_id = ay.id AND sp.deleted_at IS NULL AND sp.status IN ('enrolled', 'suspended')) AS student_count
       FROM academic_years ay
      WHERE ay.branch_id = $1
      ORDER BY ay.start_date DESC`,
    [branchId],
  );
  return rows;
}

export async function listTerms(db, branchId) {
  const { rows } = await db.query(
    `SELECT t.id, t.academic_year_id, t.name, t.sequence_no, t.start_date, t.end_date,
            (SELECT count(*)::int FROM exams e WHERE e.term_id = t.id) AS exam_count
       FROM academic_terms t
      WHERE t.branch_id = $1
      ORDER BY t.sequence_no`,
    [branchId],
  );
  return rows;
}

export async function getYear(db, id, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `SELECT id, tenant_id, branch_id, name, start_date, end_date, is_current FROM academic_years WHERE id = $1 ${forUpdate ? 'FOR UPDATE' : ''}`,
    [id],
  );
  return rows[0] ?? null;
}

export async function currentYear(db, branchId) {
  const { rows } = await db.query(`SELECT id, name, start_date, end_date FROM academic_years WHERE branch_id = $1 AND is_current`, [branchId]);
  return rows[0] ?? null;
}

export async function latestYear(db, branchId) {
  const { rows } = await db.query(`SELECT id, name, start_date, end_date FROM academic_years WHERE branch_id = $1 ORDER BY end_date DESC LIMIT 1`, [branchId]);
  return rows[0] ?? null;
}

export async function insertYear(db, y) {
  const { rows } = await db.query(
    `INSERT INTO academic_years (tenant_id, branch_id, name, start_date, end_date, is_current)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [y.tenantId, y.branchId, y.name, y.startDate, y.endDate, y.isCurrent],
  );
  return rows[0].id;
}

export async function updateYear(db, id, { name, startDate, endDate }) {
  await db.query(
    `UPDATE academic_years SET name = COALESCE($2, name), start_date = COALESCE($3, start_date), end_date = COALESCE($4, end_date) WHERE id = $1`,
    [id, name ?? null, startDate ?? null, endDate ?? null],
  );
}

/** Lock the branch's years so two "make current" calls can't interleave. */
export async function lockBranchYears(db, branchId) {
  await db.query(`SELECT pg_advisory_xact_lock(hashtext('academic-years:' || $1::text))`, [branchId]);
}

export async function setCurrentYear(db, branchId, id) {
  await db.query(`UPDATE academic_years SET is_current = false WHERE branch_id = $1 AND is_current AND id <> $2`, [branchId, id]);
  await db.query(`UPDATE academic_years SET is_current = true, status = 'active' WHERE id = $1`, [id]);
}

export async function deleteYear(db, id) {
  await db.query(`DELETE FROM academic_years WHERE id = $1`, [id]);
}

/** Terms falling outside [start, end]. */
export async function termsOutside(db, yearId, startDate, endDate) {
  const { rows } = await db.query(
    `SELECT name FROM academic_terms WHERE academic_year_id = $1 AND (start_date < $2 OR end_date > $3) ORDER BY sequence_no`,
    [yearId, startDate, endDate],
  );
  return rows.map((r) => r.name);
}

export async function yearUsage(db, id) {
  const { rows } = await db.query(
    // Empty sections (and their timetables / teacher assignments) go with the year; anything with records blocks.
    `SELECT (SELECT count(*) FROM student_profiles WHERE academic_year_id = $1)        AS students,
            (SELECT count(*) FROM homework h JOIN sections s ON s.id = h.section_id
              WHERE s.academic_year_id = $1 AND h.deleted_at IS NULL)                  AS homework,
            (SELECT count(*) FROM fee_structures WHERE academic_year_id = $1)          AS "feeStructures",
            (SELECT count(*) FROM student_fee_allocations WHERE academic_year_id = $1) AS "feeAllocations",
            (SELECT count(*) FROM fee_invoices WHERE academic_year_id = $1)            AS invoices,
            (SELECT count(*) FROM fee_receipts WHERE academic_year_id = $1)            AS receipts,
            (SELECT count(*) FROM exams WHERE academic_year_id = $1)                   AS exams,
            (SELECT count(*) FROM report_cards WHERE academic_year_id = $1)            AS "reportCards",
            (SELECT count(*) FROM student_attendance WHERE academic_year_id = $1)      AS attendance`,
    [id],
  );
  return rows[0];
}

/** Copies the sections (name, capacity, room, class teacher) of `fromYearId` into `toYearId`, active classes only. */
export async function copySections(db, { tenantId, branchId, fromYearId, toYearId }) {
  const { rowCount } = await db.query(
    `INSERT INTO sections (tenant_id, branch_id, academic_year_id, class_id, name, capacity, room_number, class_teacher_id)
     SELECT s.tenant_id, s.branch_id, $4, s.class_id, s.name, s.capacity, s.room_number, s.class_teacher_id
       FROM sections s
       JOIN classes c ON c.id = s.class_id AND c.deleted_at IS NULL AND c.status = 'active'
      WHERE s.academic_year_id = $3 AND s.branch_id = $2 AND s.tenant_id = $1 AND s.deleted_at IS NULL
     ON CONFLICT (academic_year_id, class_id, name) DO NOTHING`,
    [tenantId, branchId, fromYearId, toYearId],
  );
  return rowCount;
}

/** Copies terms, moved by the calendar gap between the two years' starts and clipped to the new year. */
export async function copyTerms(db, { fromYearId, toYearId }) {
  const { rowCount } = await db.query(
    `INSERT INTO academic_terms (tenant_id, branch_id, academic_year_id, name, sequence_no, start_date, end_date)
     SELECT t.tenant_id, t.branch_id, ny.id, t.name, t.sequence_no, x.s, x.e
       FROM academic_terms t
       JOIN academic_years oy ON oy.id = t.academic_year_id
       JOIN academic_years ny ON ny.id = $2
      CROSS JOIN LATERAL (
            -- calendar shift ("1 year"), so 31 Mar stays 31 Mar across a leap year
            SELECT GREATEST((t.start_date + age(ny.start_date, oy.start_date))::date, ny.start_date) AS s,
                   LEAST((t.end_date + age(ny.start_date, oy.start_date))::date, ny.end_date)       AS e) x
      WHERE t.academic_year_id = $1 AND x.s < x.e
     ON CONFLICT DO NOTHING`,
    [fromYearId, toYearId],
  );
  return rowCount;
}

export async function getTerm(db, id) {
  const { rows } = await db.query(
    `SELECT t.id, t.tenant_id, t.branch_id, t.academic_year_id, t.name, t.sequence_no, t.start_date, t.end_date,
            ay.start_date AS year_start, ay.end_date AS year_end
       FROM academic_terms t JOIN academic_years ay ON ay.id = t.academic_year_id
      WHERE t.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function nextTermSequence(db, yearId) {
  const { rows } = await db.query(`SELECT COALESCE(max(sequence_no), 0) + 1 AS n FROM academic_terms WHERE academic_year_id = $1`, [yearId]);
  return rows[0].n;
}

export async function insertTerm(db, t) {
  const { rows } = await db.query(
    `INSERT INTO academic_terms (tenant_id, branch_id, academic_year_id, name, sequence_no, start_date, end_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [t.tenantId, t.branchId, t.academicYearId, t.name, t.sequenceNo, t.startDate, t.endDate],
  );
  return rows[0].id;
}

export async function updateTerm(db, id, { name, sequenceNo, startDate, endDate }) {
  await db.query(
    `UPDATE academic_terms
        SET name = COALESCE($2, name), sequence_no = COALESCE($3, sequence_no),
            start_date = COALESCE($4, start_date), end_date = COALESCE($5, end_date)
      WHERE id = $1`,
    [id, name ?? null, sequenceNo ?? null, startDate ?? null, endDate ?? null],
  );
}

export async function termUsage(db, id) {
  const { rows } = await db.query(
    `SELECT (SELECT count(*) FROM exams WHERE term_id = $1)        AS exams,
            (SELECT count(*) FROM marks_entry WHERE term_id = $1)  AS marks,
            (SELECT count(*) FROM report_cards WHERE term_id = $1) AS "reportCards"`,
    [id],
  );
  return rows[0];
}

export async function deleteTerm(db, id) {
  await db.query(`DELETE FROM academic_terms WHERE id = $1`, [id]);
}

// ===================================================================== classes + sections

export async function listClasses(db, branchId) {
  const { rows } = await db.query(
    `SELECT c.id, c.name, c.code, c.numeric_level, c.display_order, c.status
       FROM classes c
      WHERE c.branch_id = $1 AND c.deleted_at IS NULL
      ORDER BY c.display_order, c.numeric_level NULLS LAST, c.name`,
    [branchId],
  );
  return rows;
}

export async function listSectionsOfYear(db, branchId, yearId) {
  const { rows } = await db.query(
    `SELECT s.id, s.class_id, s.name, s.capacity, s.room_number, s.class_teacher_id,
            concat_ws(' ', tu.first_name, tu.last_name) AS class_teacher_name,
            (SELECT count(*)::int FROM student_profiles sp
              WHERE sp.section_id = s.id AND sp.deleted_at IS NULL AND sp.status IN ('enrolled', 'suspended')) AS student_count
       FROM sections s
       LEFT JOIN staff_profiles sf ON sf.id = s.class_teacher_id
       LEFT JOIN users tu          ON tu.id = sf.user_id
      WHERE s.branch_id = $1 AND s.academic_year_id = $2 AND s.deleted_at IS NULL
      ORDER BY s.name`,
    [branchId, yearId],
  );
  return rows;
}

export async function getClass(db, id) {
  const { rows } = await db.query(
    `SELECT id, tenant_id, branch_id, name, code, numeric_level, display_order, status FROM classes WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return rows[0] ?? null;
}

export async function nextClassOrder(db, branchId) {
  const { rows } = await db.query(`SELECT COALESCE(max(display_order), 0) + 1 AS n FROM classes WHERE branch_id = $1 AND deleted_at IS NULL`, [branchId]);
  return rows[0].n;
}

export async function insertClass(db, c) {
  const { rows } = await db.query(
    `INSERT INTO classes (tenant_id, branch_id, name, code, numeric_level, display_order)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [c.tenantId, c.branchId, c.name, c.code ?? null, c.numericLevel ?? null, c.displayOrder],
  );
  return rows[0].id;
}

const CLASS_COLUMNS = { name: 'name', code: 'code', numericLevel: 'numeric_level', displayOrder: 'display_order', status: 'status' };
const SECTION_COLUMNS = { name: 'name', capacity: 'capacity', roomNumber: 'room_number', classTeacherStaffId: 'class_teacher_id' };
const SUBJECT_COLUMNS = { name: 'name', code: 'code', subjectType: 'subject_type', isGradedOnly: 'is_graded_only', displayOrder: 'display_order', status: 'status' };

async function patchRow(db, table, columns, id, patch) {
  const entries = Object.entries(patch).filter(([k, v]) => columns[k] && v !== undefined);
  if (entries.length === 0) return;
  const sets = entries.map(([k], i) => `${columns[k]} = $${i + 2}`);
  await db.query(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = $1`, [id, ...entries.map(([, v]) => v)]);
}

export const updateClass = (db, id, patch) => patchRow(db, 'classes', CLASS_COLUMNS, id, patch);
export const updateSection = (db, id, patch) => patchRow(db, 'sections', SECTION_COLUMNS, id, patch);
export const updateSubject = (db, id, patch) => patchRow(db, 'subjects', SUBJECT_COLUMNS, id, patch);

/** What still points at the class (or at any of its sections, all years). */
export async function classUsage(db, id) {
  const { rows } = await db.query(
    `WITH secs AS (SELECT id FROM sections WHERE class_id = $1)
     SELECT (SELECT count(*) FROM student_profiles WHERE class_id = $1 AND deleted_at IS NULL AND status IN ('enrolled', 'suspended')) AS students,
            (SELECT count(*) FROM student_profiles WHERE class_id = $1 AND NOT (deleted_at IS NULL AND status IN ('enrolled', 'suspended'))) AS "formerStudents",
            (SELECT count(*) FROM student_profiles WHERE admission_class_id = $1 AND class_id IS DISTINCT FROM $1) AS admissions,
            (SELECT count(*) FROM fee_structures WHERE class_id = $1)   AS "feeStructures",
            (SELECT count(*) FROM exam_schedules WHERE class_id = $1)   AS "examPapers",
            (SELECT count(*) FROM report_cards WHERE class_id = $1)     AS "reportCards",
            (SELECT count(*) FROM notices WHERE class_id = $1 AND deleted_at IS NULL) AS notices,
            (SELECT count(*) FROM student_attendance WHERE section_id IN (SELECT id FROM secs)) AS attendance,
            (SELECT count(*) FROM homework WHERE section_id IN (SELECT id FROM secs) AND deleted_at IS NULL) AS homework`,
    [id],
  );
  return rows[0];
}

/** Active students of the class in the current year (deactivating would hide them from pickers). */
export async function activeStudentsInClass(db, id) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM student_profiles WHERE class_id = $1 AND deleted_at IS NULL AND status IN ('enrolled', 'suspended')`,
    [id],
  );
  return rows[0].n;
}

export async function deleteClass(db, id) {
  await db.query(`DELETE FROM classes WHERE id = $1`, [id]);
}

export async function getSection(db, id) {
  const { rows } = await db.query(
    `SELECT s.id, s.tenant_id, s.branch_id, s.academic_year_id, s.class_id, s.name, s.capacity, s.room_number, s.class_teacher_id,
            c.name AS class_name,
            (SELECT count(*)::int FROM student_profiles sp
              WHERE sp.section_id = s.id AND sp.deleted_at IS NULL AND sp.status IN ('enrolled', 'suspended')) AS student_count
       FROM sections s JOIN classes c ON c.id = s.class_id
      WHERE s.id = $1 AND s.deleted_at IS NULL`,
    [id],
  );
  return rows[0] ?? null;
}

export async function insertSection(db, s) {
  const { rows } = await db.query(
    `INSERT INTO sections (tenant_id, branch_id, academic_year_id, class_id, name, capacity, room_number, class_teacher_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [s.tenantId, s.branchId, s.academicYearId, s.classId, s.name, s.capacity ?? null, s.roomNumber ?? null, s.classTeacherStaffId ?? null],
  );
  return rows[0].id;
}

export async function sectionUsage(db, id) {
  const { rows } = await db.query(
    `SELECT (SELECT count(*) FROM student_profiles WHERE section_id = $1 AND deleted_at IS NULL AND status IN ('enrolled', 'suspended')) AS students,
            (SELECT count(*) FROM student_profiles WHERE section_id = $1 AND NOT (deleted_at IS NULL AND status IN ('enrolled', 'suspended'))) AS "formerStudents",
            (SELECT count(*) FROM student_attendance WHERE section_id = $1) AS attendance,
            (SELECT count(*) FROM homework WHERE section_id = $1 AND deleted_at IS NULL) AS homework,
            (SELECT count(*) FROM exam_schedules WHERE section_id = $1) AS "examPapers",
            (SELECT count(*) FROM report_cards WHERE section_id = $1)   AS "reportCards"`,
    [id],
  );
  return rows[0];
}

export async function deleteSection(db, id) {
  await db.query(`DELETE FROM sections WHERE id = $1`, [id]);
}

/** Active staff profile of the branch (class teacher candidates), or null. */
export async function getStaffInBranch(db, staffId, branchId) {
  const { rows } = await db.query(
    `SELECT sf.id, concat_ws(' ', u.first_name, u.last_name) AS name
       FROM staff_profiles sf JOIN users u ON u.id = sf.user_id
      WHERE sf.id = $1 AND sf.branch_id = $2 AND sf.deleted_at IS NULL AND sf.status = 'active' AND u.deleted_at IS NULL`,
    [staffId, branchId],
  );
  return rows[0] ?? null;
}

export async function listStaffChoices(db, branchId) {
  const { rows } = await db.query(
    `SELECT sf.id AS staff_id, concat_ws(' ', u.first_name, u.last_name) AS name, sf.designation, u.role
       FROM staff_profiles sf JOIN users u ON u.id = sf.user_id
      WHERE sf.branch_id = $1 AND sf.deleted_at IS NULL AND sf.status = 'active' AND u.deleted_at IS NULL AND u.status = 'active'
      ORDER BY u.first_name, u.last_name`,
    [branchId],
  );
  return rows;
}

// ===================================================================== subjects

export async function listSubjects(db, branchId) {
  const { rows } = await db.query(
    `SELECT s.id, s.name, s.code, s.subject_type, s.is_graded_only, s.display_order, s.status,
            (SELECT count(*)::int FROM teacher_subject_assignments a WHERE a.subject_id = s.id) AS assignment_count,
            (SELECT count(*)::int FROM exam_schedules es WHERE es.subject_id = s.id) AS paper_count
       FROM subjects s
      WHERE s.branch_id = $1
      ORDER BY s.status, s.display_order, s.name`,
    [branchId],
  );
  return rows;
}

export async function getSubject(db, id) {
  const { rows } = await db.query(
    `SELECT id, tenant_id, branch_id, name, code, subject_type, is_graded_only, display_order, status FROM subjects WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function subjectNameTaken(db, branchId, name, exceptId = null) {
  const { rows } = await db.query(
    `SELECT 1 FROM subjects WHERE branch_id = $1 AND lower(name) = lower($2) AND ($3::uuid IS NULL OR id <> $3)`,
    [branchId, name, exceptId],
  );
  return rows.length > 0;
}

export async function nextSubjectOrder(db, branchId) {
  const { rows } = await db.query(`SELECT COALESCE(max(display_order), 0) + 1 AS n FROM subjects WHERE branch_id = $1`, [branchId]);
  return rows[0].n;
}

export async function insertSubject(db, s) {
  const { rows } = await db.query(
    `INSERT INTO subjects (tenant_id, branch_id, name, code, subject_type, is_graded_only, display_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [s.tenantId, s.branchId, s.name, s.code, s.subjectType, s.isGradedOnly, s.displayOrder],
  );
  return rows[0].id;
}

export async function subjectUsage(db, id) {
  const { rows } = await db.query(
    `SELECT (SELECT count(*) FROM exam_schedules WHERE subject_id = $1)              AS "examPapers",
            (SELECT count(*) FROM marks_entry WHERE subject_id = $1)                 AS marks,
            (SELECT count(*) FROM homework WHERE subject_id = $1 AND deleted_at IS NULL) AS homework,
            (SELECT count(*) FROM timetable_periods WHERE subject_id = $1)           AS timetable,
            (SELECT count(*) FROM teacher_subject_assignments WHERE subject_id = $1) AS assignments`,
    [id],
  );
  return rows[0];
}

export async function deleteSubject(db, id) {
  await db.query(`DELETE FROM subjects WHERE id = $1`, [id]);
}

// ===================================================================== school profile

export async function getSchoolProfile(db, branchId) {
  const { rows } = await db.query(
    `SELECT b.id AS branch_id, b.tenant_id, t.name AS school_name, b.name AS branch_name, b.code AS branch_code,
            b.address_line1, b.address_line2, b.city, b.state, b.postal_code, b.phone, b.email,
            b.website, b.affiliation_no, b.school_code, b.udise_code, b.principal_name, b.board,
            b.established_year, b.medium_of_instruction, b.settings->'documents' AS documents, b.updated_at,
            l.updated_at AS logo_updated_at
       FROM branches b
       JOIN tenants t ON t.id = b.tenant_id
       LEFT JOIN branch_logos l ON l.branch_id = b.id
      WHERE b.id = $1 AND b.deleted_at IS NULL`,
    [branchId],
  );
  return rows[0] ?? null;
}

/**
 * Writes the branch's profile columns. The same three facts used to live in
 * settings.documents (principalName, website, board); they are removed there so the
 * certificates read the columns.
 */
export async function updateSchoolProfile(db, branchId, p) {
  await db.query(
    `UPDATE branches
        SET name = $2, address_line1 = $3, address_line2 = $4, city = $5, state = $6, postal_code = $7,
            phone = $8, email = $9, website = $10, affiliation_no = $11, school_code = $12, udise_code = $13,
            principal_name = $14, board = $15, established_year = $16, medium_of_instruction = $17,
            settings = CASE WHEN settings ? 'documents'
                            THEN jsonb_set(settings, '{documents}', (settings->'documents') - 'principalName' - 'website' - 'board')
                            ELSE settings END
      WHERE id = $1`,
    [branchId, p.branchName, p.address.line1, p.address.line2, p.address.city, p.address.state, p.address.pincode,
      p.phone, p.email, p.website, p.affiliationNo, p.schoolCode, p.udiseCode,
      p.principalName, p.board, p.establishedYear, p.mediumOfInstruction],
  );
}

export async function updateTenantName(db, tenantId, name) {
  await db.query(`UPDATE tenants SET name = $2 WHERE id = $1`, [tenantId, name]);
}

export async function getLogo(db, branchId) {
  const { rows } = await db.query(`SELECT mime_type, size_bytes, sha256, data, updated_at FROM branch_logos WHERE branch_id = $1`, [branchId]);
  return rows[0] ?? null;
}

export async function upsertLogo(db, l) {
  const { rows } = await db.query(
    `INSERT INTO branch_logos (branch_id, tenant_id, mime_type, size_bytes, sha256, data, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (branch_id) DO UPDATE
        SET mime_type = EXCLUDED.mime_type, size_bytes = EXCLUDED.size_bytes, sha256 = EXCLUDED.sha256,
            data = EXCLUDED.data, uploaded_by = EXCLUDED.uploaded_by
     RETURNING updated_at`,
    [l.branchId, l.tenantId, l.mime, l.size, l.sha256, l.data, l.uploadedBy],
  );
  return rows[0].updated_at;
}

export async function deleteLogo(db, branchId) {
  const { rowCount } = await db.query(`DELETE FROM branch_logos WHERE branch_id = $1`, [branchId]);
  return rowCount > 0;
}

/** The branch logo as a Buffer for PDFs (null when none). Never throws: a PDF prints without a logo. */
export async function branchLogoBuffer(branchId) {
  if (!branchId) return null;
  try {
    const { rows } = await pool.query(`SELECT data FROM branch_logos WHERE branch_id = $1`, [branchId]);
    return rows[0]?.data ?? null;
  } catch {
    return null;
  }
}
