import { pool } from '../../db/pool.js';

/**
 * settings_audit_log: who changed which setting, when, and what changed. Secrets are never
 * written here (callers pass masked values), so the log can be shown to every admin.
 */

const MAX_CHANGES = 60;
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** { "device.lateAfter": ["08:15", "08:30"], ... } for the paths whose value differs. */
export function diffValues(before, after, prefix = '', out = {}) {
  if (Object.keys(out).length >= MAX_CHANGES) return out;
  if (isPlainObject(before) && isPlainObject(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      diffValues(before[key], after[key], prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }
  if (JSON.stringify(before ?? null) !== JSON.stringify(after ?? null)) out[prefix || '(value)'] = [before ?? null, after ?? null];
  return out;
}

/**
 * @param {import('pg').PoolClient|{query: Function}} db
 * @param {{ tenantId?: string|null, branchId?: string|null, actorUserId?: string|null, area: string, action: string,
 *           summary: string, changes?: object|null }} entry
 */
export async function recordAudit(db, entry) {
  await (db ?? pool).query(
    `INSERT INTO settings_audit_log (tenant_id, branch_id, actor_user_id, area, action, summary, changes)
     VALUES ($1, $2, $3, $4, $5, left($6, 300), $7)`,
    [
      entry.tenantId ?? null, entry.branchId ?? null, entry.actorUserId ?? null, entry.area, entry.action, entry.summary,
      entry.changes && Object.keys(entry.changes).length ? JSON.stringify(entry.changes) : null,
    ],
  );
}

export async function listAudit(db, { tenantId, branchIds = null, area = null, page = 1, limit = 50 }) {
  const { rows } = await db.query(
    `SELECT a.id, a.area, a.action, a.summary, a.changes, a.created_at, a.branch_id, b.name AS branch_name,
            NULLIF(concat_ws(' ', u.first_name, u.last_name), '') AS actor_name, u.role AS actor_role,
            count(*) OVER ()::int AS total_count
       FROM settings_audit_log a
       LEFT JOIN users u    ON u.id = a.actor_user_id
       LEFT JOIN branches b ON b.id = a.branch_id
      WHERE a.tenant_id IS NOT DISTINCT FROM $1
        AND ($2::uuid[] IS NULL OR a.branch_id IS NULL OR a.branch_id = ANY ($2))
        AND ($3::text IS NULL OR a.area = $3)
      ORDER BY a.created_at DESC
      LIMIT $4 OFFSET $5`,
    [tenantId ?? null, branchIds, area, limit, (page - 1) * limit],
  );
  return rows;
}
