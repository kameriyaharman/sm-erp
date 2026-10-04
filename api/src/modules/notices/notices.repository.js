import { query } from '../../db/pool.js';

const SELECT = `
  SELECT n.id, n.tenant_id, n.branch_id, n.title, n.body, n.audience, n.class_id, c.name AS class_name, n.pinned, n.created_at,
         concat_ws(' ', u.first_name, u.last_name) AS created_by_name
    FROM notices n
    LEFT JOIN classes c ON c.id = n.class_id
    LEFT JOIN users u   ON u.id = n.created_by`;

/** Admins: everything in scope. */
export async function listForAdmin(scope, limit) {
  const { rows } = await query(
    `${SELECT}
      WHERE n.deleted_at IS NULL AND ($1::uuid IS NULL OR n.tenant_id = $1) AND ($2::uuid[] IS NULL OR n.branch_id = ANY ($2))
      ORDER BY n.pinned DESC, n.created_at DESC LIMIT $3`,
    [scope.tenantId, scope.branchIds, limit],
  );
  return rows;
}

/** Teachers: their branch, audience all | teachers. */
export async function listForTeacher(auth, limit) {
  const { rows } = await query(
    `${SELECT}
      WHERE n.deleted_at IS NULL AND n.tenant_id = $1 AND n.branch_id = $2 AND n.audience IN ('all', 'teachers')
      ORDER BY n.pinned DESC, n.created_at DESC LIMIT $3`,
    [auth.tenantId, auth.branchId, limit],
  );
  return rows;
}

/** Parents: branches of their children, audience all | parents, whole-school or one of their children's classes. */
export async function listForParent(auth, limit) {
  const { rows } = await query(
    `WITH kids AS (
       SELECT sp.branch_id, sp.class_id FROM student_profiles sp
        WHERE sp.deleted_at IS NULL AND sp.tenant_id = $1 AND sp.status IN ('enrolled', 'suspended')
          AND (sp.parent_id = $2 OR EXISTS (SELECT 1 FROM student_guardians g WHERE g.student_id = sp.id AND g.guardian_user_id = $2)
               OR sp.user_id = $2)
     )
     ${SELECT}
      WHERE n.deleted_at IS NULL AND n.tenant_id = $1 AND n.audience IN ('all', 'parents')
        AND n.branch_id IN (SELECT branch_id FROM kids)
        AND (n.class_id IS NULL OR n.class_id IN (SELECT class_id FROM kids WHERE class_id IS NOT NULL))
      ORDER BY n.pinned DESC, n.created_at DESC LIMIT $3`,
    [auth.tenantId, auth.userId, limit],
  );
  return rows;
}

export async function getNotice(db, id) {
  const { rows } = await db.query(`${SELECT} WHERE n.id = $1 AND n.deleted_at IS NULL`, [id]);
  return rows[0] ?? null;
}

export async function classInBranch(db, classId, branchId) {
  const { rows } = await db.query(`SELECT id FROM classes WHERE id = $1 AND branch_id = $2 AND deleted_at IS NULL`, [classId, branchId]);
  return rows.length > 0;
}

export async function insertNotice(db, n) {
  const { rows } = await db.query(
    `INSERT INTO notices (tenant_id, branch_id, title, body, audience, class_id, pinned, broadcast_batch_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [n.tenantId, n.branchId, n.title, n.body, n.audience, n.classId ?? null, n.pinned, n.batchId ?? null, n.createdBy],
  );
  return rows[0].id;
}

export async function softDelete(db, id) {
  await db.query(`UPDATE notices SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, [id]);
}

/** Parent user ids of students currently in a class. */
export async function parentIdsOfClass(db, classId) {
  const { rows } = await db.query(
    `SELECT sp.parent_id AS id FROM student_profiles sp
      WHERE sp.class_id = $1 AND sp.deleted_at IS NULL AND sp.status = 'enrolled' AND sp.parent_id IS NOT NULL
     UNION
     SELECT g.guardian_user_id FROM student_guardians g JOIN student_profiles sp ON sp.id = g.student_id
      WHERE sp.class_id = $1 AND sp.deleted_at IS NULL AND sp.status = 'enrolled' AND g.receives_notices`,
    [classId],
  );
  return new Set(rows.map((r) => r.id));
}
