import { query } from '../../db/pool.js';

const ROLL_ORDER = `NULLIF(regexp_replace(sp.roll_number, '\\D', '', 'g'), '')::int NULLS LAST`;

const SORTS = {
  name: `u.first_name, u.last_name, sp.admission_number`,
  admission: `sp.admission_number`,
  class: `c.display_order NULLS LAST, c.name, s.name, ${ROLL_ORDER}, u.first_name`,
};

const STATUS_FILTERS = {
  active: `sp.status IN ('enrolled', 'suspended')`,
  left: `sp.status IN ('transferred', 'withdrawn', 'graduated')`,
  all: 'TRUE',
};

export async function listStudents({ scope, filters, like }) {
  const { classId, sectionId, status, sort, page, limit } = filters;
  const { rows } = await query(
    `SELECT sp.id, u.first_name, u.last_name, concat_ws(' ', u.first_name, u.last_name) AS name,
            sp.admission_number, sp.roll_number, sp.gender, sp.date_of_birth, sp.admission_date, sp.status,
            c.id AS class_id, c.name AS class_name, s.id AS section_id, s.name AS section_name,
            concat_ws(' ', pu.first_name, pu.last_name) AS parent_name, pu.phone AS parent_phone, pu.id AS parent_id,
            count(*) OVER () AS total_count
       FROM student_profiles sp
       JOIN users u         ON u.id = sp.user_id
       LEFT JOIN classes c  ON c.id = sp.class_id
       LEFT JOIN sections s ON s.id = sp.section_id
       LEFT JOIN users pu   ON pu.id = sp.parent_id
      WHERE sp.deleted_at IS NULL
        AND ($1::uuid   IS NULL OR sp.tenant_id = $1)
        AND ($2::uuid[] IS NULL OR sp.branch_id = ANY ($2))
        AND ($3::uuid   IS NULL OR sp.class_id = $3)
        AND ($4::uuid   IS NULL OR sp.section_id = $4)
        AND ${STATUS_FILTERS[status]}
        AND ($5::text IS NULL
             OR concat_ws(' ', u.first_name, u.last_name) ILIKE $5
             OR sp.admission_number ILIKE $5
             OR sp.roll_number ILIKE $5
             OR pu.phone ILIKE $5)
      ORDER BY ${SORTS[sort]}
      LIMIT $6 OFFSET $7`,
    [scope.tenantId, scope.branchIds, classId ?? null, sectionId ?? null, like, limit, (page - 1) * limit],
  );
  return rows;
}

export async function getStudent(db, studentId, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `SELECT sp.id, sp.tenant_id, sp.branch_id, sp.user_id, sp.admission_number, sp.admission_date, sp.roll_number,
            sp.gender, sp.date_of_birth, sp.status, sp.date_of_leaving, sp.blood_group, sp.address,
            sp.class_id, sp.section_id, sp.academic_year_id, sp.parent_id,
            sp.father_name, sp.mother_name, sp.guardian_name, sp.social_category, sp.pen_number, sp.apaar_id,
            u.first_name, u.last_name, concat_ws(' ', u.first_name, u.last_name) AS name,
            c.name AS class_name, s.name AS section_name,
            ay.id AS year_id, ay.name AS year_name,
            pu.id AS parent_user_id, concat_ws(' ', pu.first_name, pu.last_name) AS parent_name, pu.phone AS parent_phone, pu.email AS parent_email
       FROM student_profiles sp
       JOIN users u         ON u.id = sp.user_id
       LEFT JOIN classes c  ON c.id = sp.class_id
       LEFT JOIN sections s ON s.id = sp.section_id
       LEFT JOIN academic_years ay ON ay.id = COALESCE(sp.academic_year_id,
                 (SELECT y.id FROM academic_years y WHERE y.branch_id = sp.branch_id AND y.is_current LIMIT 1))
       LEFT JOIN users pu   ON pu.id = sp.parent_id
      WHERE sp.id = $1 AND sp.deleted_at IS NULL
      ${forUpdate ? 'FOR UPDATE OF sp' : ''}`,
    [studentId],
  );
  return rows[0] ?? null;
}

/**
 * Same numbers as one row of GET /fees/students: current year, total = invoiced (not
 * cancelled) + not yet invoiced, paid, pending = open balance + not yet invoiced, overdue.
 */
export async function studentFeeTotals(db, studentId) {
  const { rows } = await db.query(
    `WITH st AS (
       SELECT sp.id, ay.id AS year_id
         FROM student_profiles sp
         JOIN academic_years ay ON ay.branch_id = sp.branch_id AND ay.is_current
        WHERE sp.id = $1
     ),
     unbilled AS (
       SELECT COALESCE(sum(a.net_amount), 0) AS amount
         FROM student_fee_allocations a JOIN st ON st.id = a.student_id AND st.year_id = a.academic_year_id
        WHERE a.is_active AND NOT EXISTS (SELECT 1 FROM fee_invoice_items it WHERE it.allocation_id = a.id)
     ),
     billed AS (
       SELECT COALESCE(sum(i.net_amount), 0) AS invoiced,
              COALESCE(sum(i.paid_amount), 0) AS paid,
              COALESCE(sum(i.balance_amount) FILTER (WHERE i.status IN ('unpaid', 'partially_paid')), 0) AS open_balance,
              COALESCE(sum(i.balance_amount) FILTER (WHERE i.status IN ('unpaid', 'partially_paid') AND i.due_date < CURRENT_DATE), 0) AS overdue
         FROM fee_invoices i JOIN st ON st.id = i.student_id AND st.year_id = i.academic_year_id
        WHERE i.status <> 'cancelled'
     )
     SELECT (b.invoiced + u.amount)::numeric(14,2)::text     AS total_fee,
            b.paid::numeric(14,2)::text                      AS paid,
            (b.open_balance + u.amount)::numeric(14,2)::text AS pending,
            b.overdue::numeric(14,2)::text                   AS overdue
       FROM billed b, unbilled u`,
    [studentId],
  );
  const r = rows[0];
  return { totalFee: r.total_fee, paid: r.paid, pending: r.pending, overdue: r.overdue };
}

export async function attendanceCounts(db, studentId, academicYearId, { from, to } = {}) {
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE status = 'present')::int  AS present,
            count(*) FILTER (WHERE status = 'absent')::int   AS absent,
            count(*) FILTER (WHERE status = 'late')::int     AS late,
            count(*) FILTER (WHERE status = 'leave')::int    AS leave,
            count(*) FILTER (WHERE status = 'half_day')::int AS half_day
       FROM student_attendance
      WHERE student_id = $1
        AND ($2::uuid IS NULL OR academic_year_id = $2)
        AND ($3::date IS NULL OR attendance_date >= $3)
        AND ($4::date IS NULL OR attendance_date <= $4)`,
    [studentId, academicYearId ?? null, from ?? null, to ?? null],
  );
  return rows[0];
}

export async function transportFor(db, studentId) {
  const { rows } = await db.query(
    `SELECT r.id AS route_id, r.name AS route_name, st.name AS stop_name, to_char(st.pickup_time, 'HH24:MI') AS pickup_time
       FROM student_transport x
       JOIN transport_routes r ON r.id = x.route_id AND r.deleted_at IS NULL
       JOIN transport_stops st ON st.id = x.stop_id
      WHERE x.student_id = $1`,
    [studentId],
  );
  return rows[0] ?? null;
}

export async function reportCardsFor(db, studentId) {
  const { rows } = await db.query(
    `SELECT rc.id, rc.is_final, t.name AS term_name, ay.name AS year_name, rc.status,
            rc.percentage::float8 AS percentage, rc.overall_grade, rc.published_at
       FROM report_cards rc
       JOIN academic_years ay ON ay.id = rc.academic_year_id
       LEFT JOIN academic_terms t ON t.id = rc.term_id
      WHERE rc.student_id = $1
      ORDER BY ay.start_date DESC, t.sequence_no DESC NULLS FIRST`,
    [studentId],
  );
  return rows;
}

export async function certificatesFor(db, studentId) {
  const { rows } = await db.query(
    `SELECT id, certificate_type, certificate_number, status, issued_at
       FROM certificates WHERE student_id = $1 ORDER BY issued_at DESC`,
    [studentId],
  );
  return rows;
}

// ---------------------------------------------------------------- admission

export async function getSectionForAdmission(db, sectionId) {
  const { rows } = await db.query(
    `SELECT s.id, s.tenant_id, s.branch_id, s.class_id, s.academic_year_id, ay.is_current,
            (now() AT TIME ZONE t.timezone)::date AS today
       FROM sections s
       JOIN academic_years ay ON ay.id = s.academic_year_id
       JOIN tenants t ON t.id = s.tenant_id
      WHERE s.id = $1 AND s.deleted_at IS NULL`,
    [sectionId],
  );
  return rows[0] ?? null;
}

/** Serialises admissions per branch (admission / roll numbers are read-then-written). */
export async function lockBranchAdmissions(db, branchId) {
  await db.query(`SELECT pg_advisory_xact_lock(hashtext('admission:' || $1::text))`, [branchId]);
}

export async function recentAdmissionNumbers(db, branchId) {
  const { rows } = await db.query(
    `SELECT admission_number FROM student_profiles WHERE branch_id = $1 ORDER BY created_at DESC, admission_number DESC LIMIT 500`,
    [branchId],
  );
  return rows.map((r) => r.admission_number);
}

export async function admissionNumberExists(db, branchId, admissionNumber) {
  const { rows } = await db.query(
    `SELECT 1 FROM student_profiles WHERE branch_id = $1 AND lower(admission_number) = lower($2)`,
    [branchId, admissionNumber],
  );
  return rows.length > 0;
}

export async function sectionRolls(db, sectionId) {
  const { rows } = await db.query(`SELECT roll_number FROM student_profiles WHERE section_id = $1 AND roll_number IS NOT NULL`, [sectionId]);
  return rows.map((r) => r.roll_number);
}

export async function rollTaken(db, sectionId, roll, exceptStudentId = null) {
  const { rows } = await db.query(
    `SELECT 1 FROM student_profiles WHERE section_id = $1 AND roll_number = $2 AND ($3::uuid IS NULL OR id <> $3)`,
    [sectionId, roll, exceptStudentId],
  );
  return rows.length > 0;
}

/** A parent account in the tenant with this mobile (matches stored +91 / 0 / bare 10-digit forms). */
export async function findParentByPhone(db, tenantId, national10) {
  const { rows } = await db.query(
    `SELECT id FROM users
      WHERE tenant_id = $1 AND role = 'parent' AND deleted_at IS NULL
        AND regexp_replace(phone, '\\D', '', 'g') IN ($2, '91' || $2, '0' || $2)
      ORDER BY created_at
      LIMIT 1`,
    [tenantId, national10],
  );
  return rows[0]?.id ?? null;
}

export async function insertUser(db, u) {
  const { rows } = await db.query(
    `INSERT INTO users (tenant_id, branch_id, role, email, phone, username, password_hash, first_name, last_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [u.tenantId, u.branchId ?? null, u.role, u.email ?? null, u.phone ?? null, u.username ?? null, u.passwordHash, u.firstName, u.lastName ?? null],
  );
  return rows[0].id;
}

export async function insertStudentProfile(db, s) {
  const { rows } = await db.query(
    `INSERT INTO student_profiles (tenant_id, branch_id, user_id, admission_number, admission_date, roll_number, academic_year_id,
                                   class_id, section_id, parent_id, date_of_birth, gender, father_name, mother_name, social_category,
                                   admission_class_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $8)
     RETURNING id`,
    [s.tenantId, s.branchId, s.userId, s.admissionNumber, s.admissionDate, s.rollNumber, s.academicYearId, s.classId, s.sectionId,
      s.parentId, s.dateOfBirth, s.gender, s.fatherName ?? null, s.motherName ?? null, s.socialCategory ?? null],
  );
  return rows[0].id;
}

/** Fee allocations from the class's fee structure for the year (no concession). */
export async function allocateFeeStructure(db, { tenantId, branchId, studentId, classId, academicYearId }) {
  const { rowCount } = await db.query(
    `INSERT INTO student_fee_allocations (tenant_id, branch_id, student_id, academic_year_id, fee_head_id, fee_structure_id,
                                          installment_no, due_date, base_amount)
     SELECT $1, $2, $3, $5, fs.fee_head_id, fs.id, fs.installment_no, fs.due_date, fs.amount
       FROM fee_structures fs
      WHERE fs.class_id = $4 AND fs.academic_year_id = $5 AND fs.branch_id = $2 AND fs.status = 'active'`,
    [tenantId, branchId, studentId, classId, academicYearId],
  );
  return rowCount;
}

// ---------------------------------------------------------------- update

export async function updateStudentUser(db, userId, { firstName, lastName }) {
  await db.query(
    `UPDATE users SET first_name = COALESCE($2, first_name), last_name = CASE WHEN $3 THEN $4 ELSE last_name END WHERE id = $1`,
    [userId, firstName ?? null, lastName !== undefined, lastName ?? null],
  );
}

const PROFILE_COLUMNS = {
  gender: 'gender',
  dateOfBirth: 'date_of_birth',
  sectionId: 'section_id',
  rollNumber: 'roll_number',
  fatherName: 'father_name',
  motherName: 'mother_name',
  guardianName: 'guardian_name',
  socialCategory: 'social_category',
  penNumber: 'pen_number',
  apaarId: 'apaar_id',
  parentId: 'parent_id',
};

export async function updateStudentProfile(db, studentId, patch) {
  const entries = Object.entries(patch).filter(([k, v]) => PROFILE_COLUMNS[k] && v !== undefined);
  if (entries.length === 0) return;
  const sets = entries.map(([k], i) => `${PROFILE_COLUMNS[k]} = $${i + 2}`);
  await db.query(`UPDATE student_profiles SET ${sets.join(', ')} WHERE id = $1`, [studentId, ...entries.map(([, v]) => v)]);
}

export async function updateUserPhone(db, userId, phone) {
  await db.query(`UPDATE users SET phone = $2 WHERE id = $1`, [userId, phone]);
}
