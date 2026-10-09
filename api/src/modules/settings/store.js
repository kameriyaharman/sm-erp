import { pool, withTransaction } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { invalidateEntitlements } from '../saas/entitlements.js';
import { diffValues, recordAudit } from './audit.js';
import { SECTIONS, resolveSection } from './sections.js';

/**
 * tenant_settings access. Reads are cached 15 s per (school, branch, section): the attendance
 * screen and the device punch API read the policy on every request. Writes on this replica
 * clear the cache immediately.
 */

const TTL_MS = 15_000;
const cache = new Map();
const keyOf = (tenantId, branchId, section) => `${tenantId}:${branchId ?? '-'}:${section}`;

function invalidate(tenantId) {
  for (const key of cache.keys()) if (key.startsWith(`${tenantId}:`)) cache.delete(key);
}

async function rowsFor(db, tenantId, section, branchId) {
  const { rows } = await db.query(
    `SELECT branch_id, value, version, updated_at, updated_by
       FROM tenant_settings
      WHERE tenant_id = $1 AND section = $2 AND (branch_id IS NULL OR branch_id = $3::uuid)`,
    [tenantId, section, branchId ?? null],
  );
  return { school: rows.find((r) => r.branch_id === null) ?? null, branch: branchId ? rows.find((r) => r.branch_id === branchId) ?? null : null };
}

/** Effective settings for a school (and branch): defaults <- school <- branch. */
export async function getSettings(tenantId, section, branchId = null, db = pool) {
  const key = keyOf(tenantId, branchId, section);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const { school, branch } = await rowsFor(db, tenantId, section, branchId);
  const value = resolveSection(section, school?.value, branch?.value);
  cache.set(key, { value, expires: Date.now() + TTL_MS });
  return value;
}

/**
 * What the settings screen needs for one level:
 *   value      effective value at this level
 *   own        what is saved at this level (null = inherits)
 *   inherited  the value this level would have without its own row (school level: the defaults)
 *   version    of the own row (0 = none yet), sent back on save
 */
export async function getSectionForEdit(tenantId, section, branchId = null) {
  const def = SECTIONS[section];
  const { school, branch } = await rowsFor(pool, tenantId, section, branchId);
  const own = branchId ? branch : school;
  return {
    section,
    label: def.label,
    branchId: branchId ?? null,
    branchable: def.branchable,
    value: resolveSection(section, school?.value, branchId ? branch?.value : null),
    own: own ? own.value : null,
    inherited: branchId ? resolveSection(section, school?.value, null) : structuredClone(def.defaults),
    version: own?.version ?? 0,
    updatedAt: own?.updated_at ?? null,
  };
}

/**
 * Saves a whole section at one level. `version` must match what the screen loaded (0 for a new
 * row): two admins editing at once get 409 SETTINGS_CHANGED instead of silently overwriting.
 */
export async function putSection({ tenantId, branchId = null, section, value, version, actorUserId, auditArea = section, summary }) {
  const def = SECTIONS[section];
  if (!def) throw AppError.notFound('Unknown settings section', 'SECTION_NOT_FOUND');
  if (branchId && !def.branchable) throw new AppError(422, 'NOT_BRANCHABLE', `${def.label} apply to the whole school`);
  const parsed = def.schema.safeParse(value);
  if (!parsed.success) {
    throw AppError.badRequest('Validation failed', { body: parsed.error.flatten().fieldErrors, issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }, 'VALIDATION_ERROR');
  }
  const next = parsed.data;

  const saved = await withTransaction(async (db) => {
    const { rows } = await db.query(
      `SELECT id, value, version FROM tenant_settings
        WHERE tenant_id = $1 AND section = $2 AND branch_id IS NOT DISTINCT FROM $3::uuid
        FOR UPDATE`,
      [tenantId, section, branchId],
    );
    const current = rows[0] ?? null;
    if ((current?.version ?? 0) !== version) {
      throw new AppError(409, 'SETTINGS_CHANGED', 'Someone else changed these settings after you opened them. Reload to see their changes, then save again.', {
        currentVersion: current?.version ?? 0,
      });
    }
    let row;
    if (current) {
      ({ rows: [row] } = await db.query(
        `UPDATE tenant_settings SET value = $2, version = version + 1, updated_by = $3 WHERE id = $1 RETURNING version, updated_at`,
        [current.id, JSON.stringify(next), actorUserId],
      ));
    } else {
      ({ rows: [row] } = await db.query(
        `INSERT INTO tenant_settings (tenant_id, branch_id, section, value, updated_by) VALUES ($1, $2, $3, $4, $5) RETURNING version, updated_at`,
        [tenantId, branchId, section, JSON.stringify(next), actorUserId],
      ));
    }
    const before = current?.value ?? (branchId ? null : def.defaults);
    const changes = diffValues(before ?? {}, next);
    await recordAudit(db, {
      tenantId,
      branchId,
      actorUserId,
      area: auditArea,
      action: 'update',
      summary: summary ?? `${def.label} updated${branchId ? ' for a branch' : ''} (${Object.keys(changes).length} change${Object.keys(changes).length === 1 ? '' : 's'})`,
      changes,
    });
    return row;
  });

  invalidate(tenantId);
  if (section === 'modules') invalidateEntitlements(tenantId);
  return { version: saved.version, updatedAt: saved.updated_at };
}

/** Removes a branch's own value so it follows the school-wide settings again. */
export async function resetBranchSection({ tenantId, branchId, section, actorUserId }) {
  const def = SECTIONS[section];
  const { rowCount } = await pool.query(`DELETE FROM tenant_settings WHERE tenant_id = $1 AND branch_id = $2 AND section = $3`, [tenantId, branchId, section]);
  if (rowCount > 0) {
    await recordAudit(pool, { tenantId, branchId, actorUserId, area: section, action: 'reset', summary: `${def.label}: branch now follows the school-wide settings` });
  }
  invalidate(tenantId);
  return rowCount > 0;
}

export { invalidate as invalidateSettingsCache };
