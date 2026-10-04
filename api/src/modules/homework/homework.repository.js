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

/**
 * Newest first. scope: { tenantId, branchIds } (null = any); sectionId optional;
 * sectionIds (array) limits to those sections (null = no limit).
 */
export async function listHomework({ scope, sectionId, sectionIds = null, page, limit, filters = {} }) {
  const { classId, subjectId, dateField = 'assigned', from, to, search } = filters;
  const like = search ? `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  // assigned_at is a timestamp: compare its day in the school's time zone.
  const day = dateField === 'due' ? 'h.due_date' : `(h.assigned_at AT TIME ZONE COALESCE((SELECT t.timezone FROM tenants t WHERE t.id = h.tenant_id), 'Asia/Kolkata'))::date`;
  const { rows } = await query(
    `${SELECT}, count(*) OVER () AS total_count
     ${FROM}
      WHERE h.deleted_at IS NULL
        AND ($1::uuid IS NULL OR h.tenant_id = $1) AND ($2::uuid[] IS NULL OR h.branch_id = ANY ($2))
        AND ($3::uuid IS NULL OR h.section_id = $3)
        AND ($6::uuid[] IS NULL OR h.section_id = ANY ($6))
        AND ($7::uuid IS NULL OR s.class_id = $7)
        AND ($8::uuid IS NULL OR h.subject_id = $8)
        AND ($9::date IS NULL OR ${day} >= $9)
        AND ($10::date IS NULL OR ${day} <= $10)
        AND ($11::text IS NULL OR h.title ILIKE $11 OR h.details ILIKE $11)
      ORDER BY h.assigned_at DESC, h.id
      LIMIT $4 OFFSET $5`,
    [scope.tenantId, scope.branchIds, sectionId ?? null, limit, (page - 1) * limit, sectionIds,
      classId ?? null, subjectId ?? null, from ?? null, to ?? null, like],
  );
  return rows;
}

export async function getHomework(db, id, { lock = false } = {}) {
  const { rows } = await db.query(`${SELECT} ${FROM} WHERE h.id = $1 AND h.deleted_at IS NULL ${lock ? 'FOR UPDATE OF h' : ''}`, [id]);
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

// ---------------------------------------------------------------- attachments (bytes never in lists)

const ATTACHMENT_COLUMNS = `a.id, a.homework_id, a.file_name, a.mime_type, a.size_bytes, a.created_at`;

/** homework id -> attachment rows (no data), oldest first. */
export async function attachmentsFor(db, homeworkIds) {
  const out = new Map();
  if (homeworkIds.length === 0) return out;
  const { rows } = await (db ?? { query }).query(
    `SELECT ${ATTACHMENT_COLUMNS} FROM homework_attachments a WHERE a.homework_id = ANY ($1) ORDER BY a.created_at, a.id`,
    [homeworkIds],
  );
  for (const r of rows) {
    if (!out.has(r.homework_id)) out.set(r.homework_id, []);
    out.get(r.homework_id).push(r);
  }
  return out;
}

export async function countAttachments(db, homeworkId) {
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM homework_attachments WHERE homework_id = $1`, [homeworkId]);
  return rows[0].n;
}

export async function insertAttachment(db, a) {
  const { rows } = await db.query(
    `INSERT INTO homework_attachments (homework_id, tenant_id, branch_id, file_name, mime_type, size_bytes, data, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, homework_id, file_name, mime_type, size_bytes, created_at`,
    [a.homeworkId, a.tenantId, a.branchId, a.fileName, a.mimeType, a.data.length, a.data, a.uploadedBy],
  );
  return rows[0];
}

/** One attachment with its (live) homework, without the bytes. */
export async function getAttachment(db, id) {
  const { rows } = await db.query(
    `SELECT ${ATTACHMENT_COLUMNS}, a.tenant_id, a.branch_id, a.uploaded_by,
            h.section_id, h.created_by AS homework_created_by
       FROM homework_attachments a
       JOIN homework h ON h.id = a.homework_id AND h.deleted_at IS NULL
      WHERE a.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function attachmentData(db, id) {
  const { rows } = await db.query(`SELECT data FROM homework_attachments WHERE id = $1`, [id]);
  return rows[0]?.data ?? null;
}

export async function deleteAttachment(db, id) {
  await db.query(`DELETE FROM homework_attachments WHERE id = $1`, [id]);
}

/** The parent (primary or guardian) has a child in this section. */
export async function parentHasChildInSection(db, { userId, tenantId, sectionId }) {
  const { rows } = await db.query(
    `SELECT 1 FROM student_profiles sp
      WHERE sp.section_id = $3 AND sp.tenant_id = $2 AND sp.deleted_at IS NULL
        AND (sp.parent_id = $1 OR EXISTS (SELECT 1 FROM student_guardians g WHERE g.student_id = sp.id AND g.guardian_user_id = $1)
             OR sp.user_id = $1)   -- student portal: their own section
      LIMIT 1`,
    [userId, tenantId, sectionId],
  );
  return rows.length > 0;
}
