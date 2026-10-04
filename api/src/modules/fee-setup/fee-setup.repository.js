/**
 * SQL for fee heads, class-wise fee structures, applying structures to students and
 * per-student concession rules. Money leaves as numeric strings.
 * "Invoiced" allocation = one that a fee_invoice_items row points at (its money is frozen).
 */

const INVOICED = `EXISTS (SELECT 1 FROM fee_invoice_items it WHERE it.allocation_id = a.id)`;

// =====================================================================
// Lookups
// =====================================================================

export async function getClass(db, classId) {
  const { rows } = await db.query(
    `SELECT c.id, c.tenant_id, c.branch_id, c.name, c.numeric_level FROM classes c WHERE c.id = $1 AND c.deleted_at IS NULL`,
    [classId],
  );
  return rows[0] ?? null;
}

/** The given year of the branch, or its current year. */
export async function getYear(db, { branchId, academicYearId }) {
  const { rows } = await db.query(
    `SELECT ay.id, ay.name, ay.start_date, ay.end_date, ay.is_current
       FROM academic_years ay
      WHERE ay.branch_id = $1 AND CASE WHEN $2::uuid IS NULL THEN ay.is_current ELSE ay.id = $2 END`,
    [branchId, academicYearId ?? null],
  );
  return rows[0] ?? null;
}

export async function getStudent(db, studentId) {
  const { rows } = await db.query(
    `SELECT sp.id, sp.tenant_id, sp.branch_id, sp.academic_year_id, sp.admission_number, sp.class_id, sp.status,
            concat_ws(' ', u.first_name, u.last_name) AS name, c.name AS class_name, s.name AS section_name
       FROM student_profiles sp
       JOIN users u ON u.id = sp.user_id
       LEFT JOIN classes c  ON c.id = sp.class_id
       LEFT JOIN sections s ON s.id = sp.section_id
      WHERE sp.id = $1 AND sp.deleted_at IS NULL`,
    [studentId],
  );
  return rows[0] ?? null;
}

// =====================================================================
// Fee heads
// =====================================================================

const HEAD_COLUMNS = `h.id, h.tenant_id, h.branch_id, h.name, h.code, h.description, h.default_frequency, h.is_optional, h.is_refundable,
       h.display_order, h.status`;

export async function listHeads(db, branchId) {
  const { rows } = await db.query(
    `SELECT ${HEAD_COLUMNS},
            (SELECT count(DISTINCT fs.class_id)::int FROM fee_structures fs JOIN academic_years ay ON ay.id = fs.academic_year_id
              WHERE fs.fee_head_id = h.id AND fs.status = 'active' AND ay.is_current) AS classes,
            (SELECT count(*)::int FROM student_fee_allocations a WHERE a.fee_head_id = h.id AND a.is_active) AS allocations
       FROM fee_heads h
      WHERE h.branch_id = $1
      ORDER BY (h.status <> 'active'), h.display_order, h.name`,
    [branchId],
  );
  return rows;
}

export async function getHead(db, id, { lock = false } = {}) {
  const { rows } = await db.query(`SELECT ${HEAD_COLUMNS} FROM fee_heads h WHERE h.id = $1 ${lock ? 'FOR UPDATE' : ''}`, [id]);
  return rows[0] ?? null;
}

export async function headsByIds(db, branchId, ids) {
  const { rows } = await db.query(`SELECT ${HEAD_COLUMNS} FROM fee_heads h WHERE h.branch_id = $1 AND h.id = ANY ($2)`, [branchId, ids]);
  return rows;
}

export async function nextHeadOrder(db, branchId) {
  const { rows } = await db.query(`SELECT COALESCE(max(display_order), 0) + 1 AS n FROM fee_heads WHERE branch_id = $1`, [branchId]);
  return rows[0].n;
}

export async function insertHead(db, h) {
  const { rows } = await db.query(
    `INSERT INTO fee_heads (tenant_id, branch_id, name, code, description, default_frequency, is_optional, is_refundable, display_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [h.tenantId, h.branchId, h.name, h.code, h.description ?? null, h.defaultFrequency, h.optional, h.refundable, h.displayOrder],
  );
  return rows[0].id;
}

export async function updateHead(db, id, patch) {
  const map = {
    name: 'name', code: 'code', description: 'description', defaultFrequency: 'default_frequency',
    optional: 'is_optional', refundable: 'is_refundable', displayOrder: 'display_order', status: 'status',
  };
  const sets = [];
  const params = [id];
  for (const [key, column] of Object.entries(map)) {
    if (patch[key] === undefined) continue;
    params.push(patch[key]);
    sets.push(`${column} = $${params.length}`);
  }
  if (sets.length) await db.query(`UPDATE fee_heads SET ${sets.join(', ')} WHERE id = $1`, params);
}

/** Where a head is used: live structures (current / future years) and any money record. */
export async function headUsage(db, id) {
  const { rows } = await db.query(
    `SELECT (SELECT count(*)::int FROM fee_structures fs JOIN academic_years ay ON ay.id = fs.academic_year_id
              WHERE fs.fee_head_id = $1 AND fs.status = 'active' AND ay.end_date >= CURRENT_DATE) AS live_structures,
            (SELECT count(*)::int FROM fee_structures WHERE fee_head_id = $1)          AS structures,
            (SELECT count(*)::int FROM student_fee_allocations WHERE fee_head_id = $1) AS allocations,
            (SELECT count(*)::int FROM fee_invoice_items WHERE fee_head_id = $1)       AS invoice_items,
            (SELECT count(*)::int FROM student_fee_concessions WHERE fee_head_id = $1) AS concessions`,
    [id],
  );
  return rows[0];
}

export async function deleteHead(db, id) {
  await db.query(`DELETE FROM fee_heads WHERE id = $1`, [id]);
}

// =====================================================================
// Structure
// =====================================================================

/** Active structure rows of a class + year with how many students have / were billed for each. */
export async function structureRows(db, { classId, academicYearId }) {
  const { rows } = await db.query(
    `SELECT fs.id, fs.fee_head_id, h.name AS fee_head, h.code AS fee_head_code, h.status AS fee_head_status, h.display_order,
            fs.frequency, fs.installment_no, fs.installment_label, fs.amount::text, fs.due_date,
            count(a.id) FILTER (WHERE a.is_active)::int                 AS allocations,
            count(a.id) FILTER (WHERE a.is_active AND ${INVOICED})::int AS invoiced
       FROM fee_structures fs
       JOIN fee_heads h ON h.id = fs.fee_head_id
       LEFT JOIN student_fee_allocations a ON a.fee_structure_id = fs.id
      WHERE fs.class_id = $1 AND fs.academic_year_id = $2 AND fs.status = 'active'
      GROUP BY fs.id, h.id
      ORDER BY h.display_order, h.name, fs.installment_no`,
    [classId, academicYearId],
  );
  return rows;
}

export async function lockStructure(db, { classId, academicYearId }) {
  await db.query(`SELECT pg_advisory_xact_lock(hashtext('fee_structure:' || $1::text || ':' || $2::text))`, [classId, academicYearId]);
  const { rows } = await db.query(
    `SELECT fs.id, fs.fee_head_id, fs.frequency, fs.installment_no, fs.installment_label, fs.amount::text, fs.due_date, fs.status,
            (SELECT count(*)::int FROM student_fee_allocations a WHERE a.fee_structure_id = fs.id) AS allocations_any
       FROM fee_structures fs
      WHERE fs.class_id = $1 AND fs.academic_year_id = $2
      FOR UPDATE`,
    [classId, academicYearId],
  );
  return rows;
}

export async function insertStructureRow(db, r) {
  const { rows } = await db.query(
    `INSERT INTO fee_structures (tenant_id, branch_id, academic_year_id, class_id, fee_head_id, frequency, installment_no, installment_label, amount, due_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [r.tenantId, r.branchId, r.academicYearId, r.classId, r.feeHeadId, r.frequency, r.installmentNo, r.label, r.amount, r.dueDate],
  );
  return rows[0].id;
}

export async function updateStructureRow(db, id, r) {
  await db.query(
    `UPDATE fee_structures SET frequency = $2, installment_label = $3, amount = $4, due_date = $5, status = 'active' WHERE id = $1`,
    [id, r.frequency, r.label, r.amount, r.dueDate],
  );
}

export async function deactivateStructureRows(db, ids) {
  if (!ids.length) return 0;
  await db.query(`UPDATE fee_structures SET status = 'inactive' WHERE id = ANY ($1)`, [ids]);
  // Their not-yet-invoiced dues go away; invoiced ones stay exactly as billed.
  const { rowCount } = await db.query(
    `UPDATE student_fee_allocations a SET is_active = false
      WHERE a.fee_structure_id = ANY ($1) AND a.is_active AND NOT ${INVOICED}`,
    [ids],
  );
  return rowCount;
}

export async function deleteStructureRows(db, ids) {
  if (ids.length) await db.query(`DELETE FROM fee_structures WHERE id = ANY ($1)`, [ids]);
}

/**
 * Copies changed structure rows onto their un-invoiced allocations (amount, due date, and the
 * allocation's own concession re-computed on the new amount). `reactivate` rows also bring back
 * un-invoiced allocations that were switched off when the row was removed earlier.
 */
export async function propagateToAllocations(db, { changedIds, reactivateIds }) {
  const ids = [...new Set([...changedIds, ...reactivateIds])];
  if (!ids.length) return { updated: 0, invoicedUnchanged: 0, students: 0 };
  const { rows } = await db.query(
    `WITH upd AS (
       UPDATE student_fee_allocations a
          SET base_amount = fs.amount,
              due_date    = fs.due_date,
              is_active   = a.is_active OR fs.id = ANY ($2),
              concession_amount = CASE a.concession_type
                                    WHEN 'percentage'  THEN round(fs.amount * a.concession_value / 100, 2)
                                    WHEN 'flat'        THEN LEAST(a.concession_value, fs.amount)
                                    WHEN 'full_waiver' THEN fs.amount
                                    ELSE 0 END
         FROM fee_structures fs
        WHERE fs.id = a.fee_structure_id AND fs.id = ANY ($1)
          AND (a.is_active OR fs.id = ANY ($2))
          AND NOT ${INVOICED}
          AND (a.base_amount <> fs.amount OR a.due_date <> fs.due_date OR NOT a.is_active)
       RETURNING a.id, a.student_id
     )
     SELECT (SELECT count(*)::int FROM upd) AS updated,
            (SELECT count(DISTINCT student_id)::int FROM upd) AS students,
            (SELECT count(*)::int FROM student_fee_allocations a
              WHERE a.fee_structure_id = ANY ($3) AND a.is_active AND ${INVOICED}) AS invoiced_unchanged`,
    [ids, reactivateIds, changedIds],
  );
  return { updated: rows[0].updated, students: rows[0].students, invoicedUnchanged: rows[0].invoiced_unchanged };
}

/** Per class of the branch: structure total for the year, heads, students, and students set up. */
export async function overview(db, { branchId, academicYearId }) {
  const { rows } = await db.query(
    `WITH st AS (
       SELECT fs.class_id, sum(fs.amount) AS annual, count(*)::int AS rows, count(DISTINCT fs.fee_head_id)::int AS heads
         FROM fee_structures fs
        WHERE fs.academic_year_id = $2 AND fs.status = 'active'
        GROUP BY fs.class_id
     ),
     stu AS (
       SELECT sp.class_id, count(*)::int AS students,
              count(*) FILTER (WHERE NOT EXISTS (
                SELECT 1 FROM fee_structures fs
                 WHERE fs.class_id = sp.class_id AND fs.academic_year_id = $2 AND fs.status = 'active'
                   AND NOT EXISTS (SELECT 1 FROM student_fee_allocations a WHERE a.student_id = sp.id AND a.fee_structure_id = fs.id)
              ))::int AS fully_allocated
         FROM student_profiles sp
        WHERE sp.branch_id = $1 AND sp.academic_year_id = $2 AND sp.deleted_at IS NULL AND sp.status = 'enrolled'
        GROUP BY sp.class_id
     )
     SELECT c.id, c.name, c.numeric_level,
            COALESCE(st.annual, 0)::text AS annual, COALESCE(st.rows, 0) AS rows, COALESCE(st.heads, 0) AS heads,
            COALESCE(stu.students, 0) AS students, COALESCE(stu.fully_allocated, 0) AS fully_allocated
       FROM classes c
       LEFT JOIN st  ON st.class_id = c.id
       LEFT JOIN stu ON stu.class_id = c.id
      WHERE c.branch_id = $1 AND c.deleted_at IS NULL AND c.status = 'active'
      ORDER BY c.display_order, c.numeric_level NULLS LAST, c.name`,
    [branchId, academicYearId],
  );
  return rows;
}

export async function listYears(db, branchId) {
  const { rows } = await db.query(
    `SELECT id, name, start_date, end_date, is_current FROM academic_years WHERE branch_id = $1 ORDER BY start_date DESC`,
    [branchId],
  );
  return rows;
}

// =====================================================================
// Apply to students
// =====================================================================

/** Enrolled students of a class in a year, with whether they already have invoices. */
export async function classStudents(db, { classId, academicYearId, studentIds }) {
  const { rows } = await db.query(
    `SELECT sp.id, sp.admission_number, sp.roll_number, concat_ws(' ', u.first_name, u.last_name) AS name, s.name AS section_name,
            EXISTS (SELECT 1 FROM fee_invoices i WHERE i.student_id = sp.id AND i.academic_year_id = $2 AND i.status <> 'cancelled') AS has_invoices
       FROM student_profiles sp
       JOIN users u ON u.id = sp.user_id
       LEFT JOIN sections s ON s.id = sp.section_id
      WHERE sp.class_id = $1 AND sp.academic_year_id = $2 AND sp.deleted_at IS NULL AND sp.status = 'enrolled'
        AND ($3::uuid[] IS NULL OR sp.id = ANY ($3))
      ORDER BY s.name NULLS LAST, NULLIF(regexp_replace(sp.roll_number, '\\D', '', 'g'), '')::int NULLS LAST, name`,
    [classId, academicYearId, studentIds ?? null],
  );
  return rows;
}

/** (student, structure row) pairs that have no allocation yet. */
export async function missingAllocations(db, { classId, academicYearId, studentIds }) {
  const { rows } = await db.query(
    `SELECT s.id AS student_id, fs.id AS fee_structure_id, fs.fee_head_id, fs.installment_no, fs.due_date, fs.amount::text
       FROM unnest($3::uuid[]) AS s(id)
       JOIN fee_structures fs ON fs.class_id = $1 AND fs.academic_year_id = $2 AND fs.status = 'active'
      WHERE NOT EXISTS (SELECT 1 FROM student_fee_allocations a WHERE a.student_id = s.id AND a.fee_structure_id = fs.id)
      ORDER BY s.id, fs.due_date`,
    [classId, academicYearId, studentIds],
  );
  return rows;
}

export async function rulesFor(db, { studentIds, academicYearId }) {
  const { rows } = await db.query(
    `SELECT r.id, r.student_id, r.fee_head_id, h.name AS fee_head, r.concession_type, r.concession_value::text, r.reason,
            r.approved_by_name, r.approved_by, r.approved_at, NULLIF(concat_ws(' ', u.first_name, u.last_name), '') AS recorded_by
       FROM student_fee_concessions r
       LEFT JOIN fee_heads h ON h.id = r.fee_head_id
       LEFT JOIN users u ON u.id = r.approved_by
      WHERE r.student_id = ANY ($1) AND r.academic_year_id = $2
      ORDER BY (r.fee_head_id IS NOT NULL), h.display_order, h.name`,
    [studentIds, academicYearId],
  );
  return rows;
}

export async function insertAllocations(db, { tenantId, branchId, academicYearId, approvedBy, rows }) {
  if (!rows.length) return 0;
  const col = (k) => rows.map((r) => r[k]);
  const { rowCount } = await db.query(
    `INSERT INTO student_fee_allocations (tenant_id, branch_id, student_id, academic_year_id, fee_head_id, fee_structure_id, installment_no,
                                          due_date, base_amount, concession_type, concession_value, concession_amount, concession_reason,
                                          approved_by, approved_at)
     SELECT $1, $2, x.student_id, $3, x.fee_head_id, x.fee_structure_id, x.installment_no, x.due_date, x.base_amount,
            x.concession_type::concession_type, x.concession_value, x.concession_amount, x.concession_reason,
            CASE WHEN x.concession_type <> 'none' THEN $4::uuid END, CASE WHEN x.concession_type <> 'none' THEN now() END
       FROM unnest($5::uuid[], $6::uuid[], $7::uuid[], $8::int[], $9::date[], $10::numeric[], $11::text[], $12::numeric[], $13::numeric[], $14::text[])
            AS x(student_id, fee_head_id, fee_structure_id, installment_no, due_date, base_amount, concession_type, concession_value, concession_amount, concession_reason)
     ON CONFLICT (student_id, fee_structure_id) WHERE fee_structure_id IS NOT NULL DO NOTHING`,
    [tenantId, branchId, academicYearId, approvedBy, col('studentId'), col('feeHeadId'), col('feeStructureId'), col('installmentNo'), col('dueDate'),
      col('baseAmount'), col('concessionType'), col('concessionValue'), col('concessionAmount'), col('concessionReason')],
  );
  return rowCount;
}

// =====================================================================
// Concessions
// =====================================================================

export async function studentAllocations(db, { studentId, academicYearId, lock = false }) {
  const { rows } = await db.query(
    `SELECT a.id, a.fee_head_id, h.name AS fee_head, a.installment_no, a.due_date, a.base_amount::text, a.concession_type,
            a.concession_value::text, a.concession_amount::text, a.net_amount::text, a.concession_reason,
            fs.installment_label,
            (SELECT i.invoice_number FROM fee_invoice_items it JOIN fee_invoices i ON i.id = it.invoice_id WHERE it.allocation_id = a.id LIMIT 1) AS invoice_number
       FROM student_fee_allocations a
       JOIN fee_heads h ON h.id = a.fee_head_id
       LEFT JOIN fee_structures fs ON fs.id = a.fee_structure_id
      WHERE a.student_id = $1 AND a.academic_year_id = $2 AND a.is_active
      ORDER BY a.due_date, h.display_order, h.name
      ${lock ? 'FOR UPDATE OF a' : ''}`,
    [studentId, academicYearId],
  );
  return rows;
}

export async function replaceRules(db, { tenantId, branchId, studentId, academicYearId, approvedByName, userId, rules }) {
  await db.query(`DELETE FROM student_fee_concessions WHERE student_id = $1 AND academic_year_id = $2`, [studentId, academicYearId]);
  for (const r of rules) {
    await db.query(
      `INSERT INTO student_fee_concessions (tenant_id, branch_id, student_id, academic_year_id, fee_head_id, concession_type, concession_value,
                                            reason, approved_by_name, approved_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [tenantId, branchId, studentId, academicYearId, r.feeHeadId, r.type, r.value, r.reason, approvedByName ?? null, userId],
    );
  }
}

export async function setAllocationConcessions(db, { userId, rows }) {
  if (!rows.length) return;
  const col = (k) => rows.map((r) => r[k]);
  await db.query(
    `UPDATE student_fee_allocations a
        SET concession_type = x.t::concession_type, concession_value = x.v, concession_amount = x.amt, concession_reason = x.reason,
            approved_by = CASE WHEN x.t <> 'none' THEN $1::uuid END, approved_at = CASE WHEN x.t <> 'none' THEN now() END
       FROM unnest($2::uuid[], $3::text[], $4::numeric[], $5::numeric[], $6::text[]) AS x(id, t, v, amt, reason)
      WHERE a.id = x.id`,
    [userId, col('id'), col('type'), col('value'), col('amount'), col('reason')],
  );
}
