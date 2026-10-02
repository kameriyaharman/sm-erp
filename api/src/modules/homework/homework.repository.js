import { query } from '../../db/pool.js';

const SELECT = `
  SELECT h.id, h.tenant_id, h.branch_id, h.section_id, c.name || ' ' || s.name AS section_label,
         h.subject_id, sub.name AS subject_name, h.title, h.details, h.assigned_at, h.due_date, h.created_by,
         concat_ws(' ', u.first_name, u.last_name) AS teacher_name`;
const FROM = `
    FROM homework h
    JOIN sections s       ON s.id = h.section_id
    JOIN classes c        ON c.id = s.class_id
    LEFT JOIN subjects sub ON sub.id = h.subject_id
    LEFT JOIN users u      ON u.id = h.created_by`;

/** Newest first. scope: { tenantId, branchIds } (null = any); sectionId optional. */
export async function listHomework({ scope, sectionId, page, limit }) {
  const { rows } = await query(
    `${SELECT}, count(*) OVER () AS total_count
     ${FROM}
      WHERE h.deleted_at IS NULL
        AND ($1::uuid IS NULL OR h.tenant_id = $1) AND ($2::uuid[] IS NULL OR h.branch_id = ANY ($2))
        AND ($3::uuid IS NULL OR h.section_id = $3)
      ORDER BY h.assigned_at DESC, h.id
      LIMIT $4 OFFSET $5`,
    [scope.tenantId, scope.branchIds, sectionId ?? null, limit, (page - 1) * limit],
  );
  return rows;
}

export async function getHomework(db, id) {
  const { rows } = await db.query(`${SELECT} ${FROM} WHERE h.id = $1 AND h.deleted_at IS NULL`, [id]);
  return rows[0] ?? null;
}

export async function subjectInBranch(db, subjectId, branchId) {
  const { rows } = await db.query(`SELECT id FROM subjects WHERE id = $1 AND branch_id = $2 AND status = 'active'`, [subjectId, branchId]);
  return rows.length > 0;
}

export async function insertHomework(db, h) {
  const { rows } = await db.query(
    `INSERT INTO homework (tenant_id, branch_id, section_id, subject_id, title, details, due_date, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [h.tenantId, h.branchId, h.sectionId, h.subjectId ?? null, h.title, h.details ?? null, h.dueDate, h.createdBy],
  );
  return rows[0].id;
}

export async function softDelete(db, id) {
  await db.query(`UPDATE homework SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, [id]);
}
