import { query } from '../../db/pool.js';

const SECTION_LABEL = `c.name || ' ' || s.name`;

/** Current-year assignments of one teacher, by class order then subject order. */
export async function listForStaff(db, staffId) {
  const { rows } = await (db ?? { query }).query(
    `SELECT a.id, a.section_id, ${SECTION_LABEL} AS section_label, a.subject_id, sub.name AS subject_name, sub.code AS subject_code
       FROM teacher_subject_assignments a
       JOIN academic_years ay ON ay.id = a.academic_year_id AND ay.is_current
       JOIN sections s  ON s.id = a.section_id AND s.deleted_at IS NULL
       JOIN classes c   ON c.id = s.class_id
       JOIN subjects sub ON sub.id = a.subject_id
      WHERE a.staff_id = $1
      ORDER BY c.display_order, c.name, s.name, sub.display_order, sub.name`,
    [staffId],
  );
  return rows;
}

export async function getStaffMember(db, staffId, { lock = false } = {}) {
  const { rows } = await db.query(
    `SELECT sf.id, sf.tenant_id, sf.branch_id, sf.status, sf.user_id, u.role, concat_ws(' ', u.first_name, u.last_name) AS name
       FROM staff_profiles sf JOIN users u ON u.id = sf.user_id
      WHERE sf.id = $1 AND sf.deleted_at IS NULL ${lock ? 'FOR UPDATE OF sf' : ''}`,
    [staffId],
  );
  return rows[0] ?? null;
}

export async function currentYear(db, branchId) {
  const { rows } = await db.query(`SELECT id, name FROM academic_years WHERE branch_id = $1 AND is_current`, [branchId]);
  return rows[0] ?? null;
}

/** Of `ids`, the sections of this branch and academic year. */
export async function sectionsInYear(db, branchId, yearId, ids) {
  const { rows } = await db.query(
    `SELECT id FROM sections WHERE branch_id = $1 AND academic_year_id = $2 AND id = ANY ($3) AND deleted_at IS NULL`,
    [branchId, yearId, ids],
  );
  return new Set(rows.map((r) => r.id));
}

export async function activeSubjects(db, branchId, ids) {
  const { rows } = await db.query(`SELECT id FROM subjects WHERE branch_id = $1 AND id = ANY ($2) AND status = 'active'`, [branchId, ids]);
  return new Set(rows.map((r) => r.id));
}

/** Current holders of the given (section, subject) pairs in a year. */
export async function holdersOf(db, yearId, pairs) {
  if (pairs.length === 0) return [];
  const { rows } = await db.query(
    `SELECT a.id, a.staff_id, a.section_id, a.subject_id, ${SECTION_LABEL} AS section_label, sub.name AS subject_name,
            concat_ws(' ', u.first_name, u.last_name) AS teacher_name
       FROM unnest($2::uuid[], $3::uuid[]) AS x(section_id, subject_id)
       JOIN teacher_subject_assignments a ON a.academic_year_id = $1 AND a.section_id = x.section_id AND a.subject_id = x.subject_id
       JOIN sections s        ON s.id = a.section_id
       JOIN classes c         ON c.id = s.class_id
       JOIN subjects sub      ON sub.id = a.subject_id
       JOIN staff_profiles sf ON sf.id = a.staff_id
       JOIN users u           ON u.id = sf.user_id
      ORDER BY c.display_order, s.name, sub.display_order`,
    [yearId, pairs.map((p) => p.sectionId), pairs.map((p) => p.subjectId)],
  );
  return rows;
}

/**
 * Replaces a teacher's assignments for the year with `pairs`. Rows of other teachers for
 * those pairs must already be gone (reassign) or absent.
 */
export async function replaceForStaff(db, { staff, yearId, pairs, userId }) {
  await db.query(
    `DELETE FROM teacher_subject_assignments a
      WHERE a.staff_id = $1 AND a.academic_year_id = $2
        AND NOT EXISTS (SELECT 1 FROM unnest($3::uuid[], $4::uuid[]) AS x(section_id, subject_id)
                         WHERE x.section_id = a.section_id AND x.subject_id = a.subject_id)`,
    [staff.id, yearId, pairs.map((p) => p.sectionId), pairs.map((p) => p.subjectId)],
  );
  if (pairs.length === 0) return;
  await db.query(
    `INSERT INTO teacher_subject_assignments (tenant_id, branch_id, academic_year_id, staff_id, section_id, subject_id, assigned_by)
     SELECT $1, $2, $3, $4, x.section_id, x.subject_id, $7
       FROM unnest($5::uuid[], $6::uuid[]) AS x(section_id, subject_id)
     ON CONFLICT ON CONSTRAINT uq_tsa_section_subject DO NOTHING`,
    [staff.tenant_id, staff.branch_id, yearId, staff.id, pairs.map((p) => p.sectionId), pairs.map((p) => p.subjectId), userId],
  );
}

export async function deleteByIds(db, ids) {
  if (ids.length) await db.query(`DELETE FROM teacher_subject_assignments WHERE id = ANY ($1)`, [ids]);
}

/** Every active subject of the section's branch with the section's teacher for it (or null). */
export async function sectionSubjectTeachers(db, section) {
  const { rows } = await db.query(
    `SELECT sub.id AS subject_id, sub.name AS subject_name, sub.code AS subject_code,
            a.staff_id, concat_ws(' ', u.first_name, u.last_name) AS teacher_name
       FROM subjects sub
       LEFT JOIN teacher_subject_assignments a ON a.subject_id = sub.id AND a.section_id = $2 AND a.academic_year_id = $3
       LEFT JOIN staff_profiles sf ON sf.id = a.staff_id
       LEFT JOIN users u           ON u.id = sf.user_id
      WHERE sub.branch_id = $1 AND sub.status = 'active'
      ORDER BY sub.display_order, sub.name`,
    [section.branch_id, section.id, section.academic_year_id],
  );
  return rows;
}

/** Current-year sections a teacher is class teacher of. */
export async function classTeacherSections(db, staffId) {
  const { rows } = await db.query(
    `SELECT s.id, ${SECTION_LABEL} AS label
       FROM sections s
       JOIN classes c ON c.id = s.class_id
       JOIN academic_years ay ON ay.id = s.academic_year_id AND ay.is_current
      WHERE s.class_teacher_id = $1 AND s.deleted_at IS NULL
      ORDER BY c.display_order, c.name, s.name`,
    [staffId],
  );
  return rows;
}

/** A teacher's own periods across all current-year sections. */
export async function teacherPeriods(db, staffId) {
  const { rows } = await db.query(
    `SELECT tp.id, tp.weekday, tp.period_no, to_char(tp.start_time, 'HH24:MI') AS start, to_char(tp.end_time, 'HH24:MI') AS "end",
            tp.kind, tp.subject_id, sub.name AS subject_name, tp.label, tp.teacher_staff_id,
            concat_ws(' ', u.first_name, u.last_name) AS teacher_name, tp.room,
            tp.section_id, ${SECTION_LABEL} AS section_label
       FROM timetable_periods tp
       JOIN sections s        ON s.id = tp.section_id AND s.deleted_at IS NULL
       JOIN academic_years ay ON ay.id = s.academic_year_id AND ay.is_current
       JOIN classes c         ON c.id = s.class_id
       LEFT JOIN subjects sub ON sub.id = tp.subject_id
       LEFT JOIN staff_profiles sf ON sf.id = tp.teacher_staff_id
       LEFT JOIN users u           ON u.id = sf.user_id
      WHERE tp.teacher_staff_id = $1
      ORDER BY tp.weekday, tp.start_time, tp.period_no`,
    [staffId],
  );
  return rows;
}

export async function staffName(db, staffId) {
  const { rows } = await db.query(
    `SELECT concat_ws(' ', u.first_name, u.last_name) AS name FROM staff_profiles sf JOIN users u ON u.id = sf.user_id WHERE sf.id = $1`,
    [staffId],
  );
  return rows[0]?.name ?? null;
}
