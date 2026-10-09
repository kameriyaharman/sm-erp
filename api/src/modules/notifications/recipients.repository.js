import { pool } from '../../db/pool.js';

/**
 * Recipients for sendGeneralNotice. Scoped to a tenant (and optionally a branch).
 * Parents have no branch of their own, so "parents of branch X" means parents
 * or notice-receiving guardians of students enrolled in branch X.
 *
 * @returns {Promise<{ userId: string, name: string, phone: string | null, branchId: string | null }[]>}
 */
export async function findNoticeRecipients({ role, tenantId, branchId }) {
  if (role === 'parent') {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (pu.id) pu.id AS user_id, concat_ws(' ', pu.first_name, pu.last_name) AS name, pu.phone, pu.email, sp.branch_id
         FROM student_profiles sp
         JOIN users pu
           ON pu.deleted_at IS NULL AND pu.status = 'active'
          AND (pu.id = sp.parent_id
               OR pu.id IN (SELECT g.guardian_user_id FROM student_guardians g
                             WHERE g.student_id = sp.id AND g.receives_notices))
        WHERE sp.deleted_at IS NULL AND sp.status = 'enrolled'
          AND ($1::uuid IS NULL OR sp.tenant_id = $1)
          AND ($2::uuid IS NULL OR sp.branch_id = $2)
        ORDER BY pu.id, sp.branch_id`,
      [tenantId ?? null, branchId ?? null],
    );
    return rows.map((r) => ({ userId: r.user_id, name: r.name, phone: r.phone, email: r.email, branchId: r.branch_id }));
  }

  const { rows } = await pool.query(
    `SELECT u.id AS user_id, concat_ws(' ', u.first_name, u.last_name) AS name, u.phone, u.email, u.branch_id
       FROM users u
      WHERE u.role = $1::user_role AND u.deleted_at IS NULL AND u.status = 'active'
        AND ($2::uuid IS NULL OR u.tenant_id = $2)
        AND ($3::uuid IS NULL OR u.branch_id = $3)`,
    [role, tenantId ?? null, branchId ?? null],
  );
  return rows.map((r) => ({ userId: r.user_id, name: r.name, phone: r.phone, email: r.email, branchId: r.branch_id }));
}
