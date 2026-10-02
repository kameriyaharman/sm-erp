import { query } from '../../db/pool.js';

// $1 tenant (null = any), $2 branch ids (null = any)
const SCOPE = `($1::uuid IS NULL OR x.tenant_id = $1) AND ($2::uuid[] IS NULL OR x.branch_id = ANY ($2))`;
const scoped = (alias) => SCOPE.replaceAll('x.', `${alias}.`);

export async function listClasses(scope) {
  const { rows } = await query(
    `SELECT c.id, c.name, c.numeric_level
       FROM classes c
      WHERE c.deleted_at IS NULL AND c.status = 'active' AND ${scoped('c')}
      ORDER BY c.display_order, c.name`,
    [scope.tenantId, scope.branchIds],
  );
  return rows;
}

/** Current-year sections with live student counts and class teacher. */
export async function listCurrentSections(scope) {
  const { rows } = await query(
    `SELECT s.id, s.name, s.class_id, s.capacity, c.name AS class_name,
            sf.id AS staff_id, sf.user_id AS teacher_user_id,
            concat_ws(' ', tu.first_name, tu.last_name) AS teacher_name,
            (SELECT count(*)::int FROM student_profiles sp
              WHERE sp.section_id = s.id AND sp.deleted_at IS NULL AND sp.status IN ('enrolled', 'suspended')) AS student_count
       FROM sections s
       JOIN classes c         ON c.id = s.class_id
       JOIN academic_years ay ON ay.id = s.academic_year_id AND ay.is_current
       LEFT JOIN staff_profiles sf ON sf.id = s.class_teacher_id
       LEFT JOIN users tu          ON tu.id = sf.user_id
      WHERE s.deleted_at IS NULL AND ${scoped('s')}
      ORDER BY s.name`,
    [scope.tenantId, scope.branchIds],
  );
  return rows;
}

export async function listSubjects(scope) {
  const { rows } = await query(
    `SELECT s.id, s.name, s.code, s.is_graded_only, s.display_order
       FROM subjects s
      WHERE s.status = 'active' AND ${scoped('s')}
      ORDER BY s.display_order, s.name`,
    [scope.tenantId, scope.branchIds],
  );
  return rows;
}

export async function listCurrentTerms(scope) {
  const { rows } = await query(
    `SELECT t.id, t.name, t.sequence_no, t.start_date, t.end_date
       FROM academic_terms t
       JOIN academic_years ay ON ay.id = t.academic_year_id AND ay.is_current
      WHERE ${scoped('t')}
      ORDER BY t.sequence_no, t.name`,
    [scope.tenantId, scope.branchIds],
  );
  return rows;
}

export async function listFeeHeads(scope) {
  const { rows } = await query(
    `SELECT f.id, f.name, f.code
       FROM fee_heads f
      WHERE f.status = 'active' AND ${scoped('f')}
      ORDER BY f.display_order, f.name`,
    [scope.tenantId, scope.branchIds],
  );
  return rows;
}
