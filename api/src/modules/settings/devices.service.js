import { pool, withTransaction } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { logger } from '../../utils/logger.js';
import { assertModule } from '../saas/entitlements.js';
import { newDeviceKey } from '../devices/punch.service.js';
import { recordAudit } from './audit.js';
import { settingsScope, targetBranch } from './scope.js';

/**
 * Settings -> Devices: attendance devices of a branch, their keys, and the card / device-user
 * numbers of students and staff. Branch admins manage their own branch; the owner any branch.
 */

const KIND_LABEL = { rfid: 'RFID card reader', biometric: 'Biometric (fingerprint)', face: 'Face recognition', qr: 'QR scanner', gate_app: 'Gate app' };

function view(row) {
  return {
    id: row.id,
    branchId: row.branch_id,
    branchName: row.branch_name ?? null,
    name: row.name,
    kind: row.kind,
    kindLabel: KIND_LABEL[row.kind],
    protocol: row.protocol,
    serialNumber: row.serial_number,
    keyPrefix: row.api_key_prefix,
    location: row.location,
    appliesTo: row.applies_to,
    status: row.status,
    lastSeenAt: row.last_seen_at,
    lastIp: row.last_ip,
    punchesToday: row.punches_today ?? 0,
    createdAt: row.created_at,
  };
}

async function scopeFor(auth, tenantId) {
  const scope = await settingsScope(auth, { tenantId });
  await assertModule(scope.tenantId, 'device_attendance');
  return scope;
}

export async function listDevices(auth, { tenantId, branchId }) {
  const scope = await scopeFor(auth, tenantId);
  if (branchId) targetBranch(scope, branchId);
  const branchIds = branchId ? [branchId] : scope.branches.map((b) => b.id);
  const { rows } = await pool.query(
    `SELECT d.*, b.name AS branch_name,
            (SELECT count(*)::int FROM device_punches p
              WHERE p.device_id = d.id AND p.created_at >= date_trunc('day', now() AT TIME ZONE t.timezone) AT TIME ZONE t.timezone) AS punches_today
       FROM attendance_devices d
       JOIN branches b ON b.id = d.branch_id
       JOIN tenants t  ON t.id = d.tenant_id
      WHERE d.tenant_id = $1 AND d.branch_id = ANY ($2) AND d.deleted_at IS NULL
      ORDER BY b.name, d.name`,
    [scope.tenantId, branchIds],
  );
  return { branches: scope.branches, devices: rows.map(view) };
}

export async function createDevice(auth, input) {
  const scope = await scopeFor(auth, input.tenantId);
  const branchId = targetBranch(scope, input.branchId ?? scope.ownBranchId ?? scope.branches[0]?.id);
  const key = input.protocol === 'http' ? newDeviceKey() : null;
  let row;
  try {
    ({ rows: [row] } = await pool.query(
      `INSERT INTO attendance_devices (tenant_id, branch_id, name, kind, protocol, serial_number, api_key_hash, api_key_prefix, location, applies_to, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [scope.tenantId, branchId, input.name, input.kind, input.protocol, input.protocol === 'adms' ? input.serialNumber : null, key?.hash ?? null, key?.prefix ?? null, input.location ?? null, input.appliesTo, auth.userId],
    ));
  } catch (err) {
    if (err.code === '23505') throw new AppError(409, 'DEVICE_SERIAL_TAKEN', 'A device with this serial number is already registered (here or at another school).');
    throw err;
  }
  await recordAudit(pool, { tenantId: scope.tenantId, branchId, actorUserId: auth.userId, area: 'devices', action: 'create', summary: `Device added: ${input.name} (${KIND_LABEL[input.kind]}, ${input.protocol === 'adms' ? `serial ${input.serialNumber}` : 'key'})` });
  logger.info('Attendance device added', { tenantId: scope.tenantId, branchId, deviceId: row.id, kind: input.kind, protocol: input.protocol, by: auth.userId });
  // The key is shown ONCE.
  return { device: view(row), apiKey: key?.key ?? null };
}

async function loadDevice(scope, id) {
  const { rows } = await pool.query(`SELECT * FROM attendance_devices WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [id, scope.tenantId]);
  const row = rows[0];
  if (!row || !scope.branches.some((b) => b.id === row.branch_id)) throw AppError.notFound('Device not found', 'DEVICE_NOT_FOUND');
  return row;
}

export async function updateDevice(auth, id, input) {
  const scope = await scopeFor(auth, input.tenantId);
  const row = await loadDevice(scope, id);
  const { rows: [updated] } = await pool.query(
    `UPDATE attendance_devices
        SET name = COALESCE($2, name), location = CASE WHEN $3::boolean THEN $4 ELSE location END,
            applies_to = COALESCE($5, applies_to), status = COALESCE($6::record_status, status)
      WHERE id = $1 RETURNING *`,
    [id, input.name ?? null, input.location !== undefined, input.location ?? null, input.appliesTo ?? null, input.status ?? null],
  );
  await recordAudit(pool, { tenantId: scope.tenantId, branchId: row.branch_id, actorUserId: auth.userId, area: 'devices', action: 'update', summary: `Device ${updated.name} updated${input.status ? ` (${input.status})` : ''}` });
  return view(updated);
}

export async function rotateKey(auth, id, { tenantId }) {
  const scope = await scopeFor(auth, tenantId);
  const row = await loadDevice(scope, id);
  if (row.protocol !== 'http') throw new AppError(422, 'NO_KEY', 'ADMS devices are identified by their serial number and have no key');
  const key = newDeviceKey();
  await pool.query(`UPDATE attendance_devices SET api_key_hash = $2, api_key_prefix = $3 WHERE id = $1`, [id, key.hash, key.prefix]);
  await recordAudit(pool, { tenantId: scope.tenantId, branchId: row.branch_id, actorUserId: auth.userId, area: 'devices', action: 'rotate_key', summary: `New key for device ${row.name}; the old key stopped working` });
  return { apiKey: key.key, keyPrefix: key.prefix };
}

export async function deleteDevice(auth, id, { tenantId }) {
  const scope = await scopeFor(auth, tenantId);
  const row = await loadDevice(scope, id);
  // Archived, not deleted (its punches stay). The key is replaced by a random hash nobody holds; an
  // archived ADMS serial can be registered again (the unique index skips deleted rows).
  await pool.query(
    `UPDATE attendance_devices
        SET deleted_at = now(), status = 'archived',
            api_key_hash = CASE WHEN protocol = 'http' THEN $2 ELSE api_key_hash END
      WHERE id = $1`,
    [id, newDeviceKey().hash],
  );
  await recordAudit(pool, { tenantId: scope.tenantId, branchId: row.branch_id, actorUserId: auth.userId, area: 'devices', action: 'delete', summary: `Device removed: ${row.name}` });
  return { deleted: true };
}

// ------------------------------------------------------------------ punches

export async function listPunches(auth, { tenantId, deviceId, branchId, result, page, limit }) {
  const scope = await scopeFor(auth, tenantId);
  if (branchId) targetBranch(scope, branchId);
  const branchIds = branchId ? [branchId] : scope.branches.map((b) => b.id);
  const { rows } = await pool.query(
    `SELECT p.id, p.identifier, p.kind, p.punched_at, p.result, p.detail, p.created_at,
            d.name AS device_name,
            COALESCE(NULLIF(concat_ws(' ', su.first_name, su.last_name), ''), NULLIF(concat_ws(' ', fu.first_name, fu.last_name), '')) AS person_name,
            CASE WHEN p.student_id IS NOT NULL THEN 'student' WHEN p.staff_id IS NOT NULL THEN 'staff' END AS person_type,
            count(*) OVER ()::int AS total_count
       FROM device_punches p
       JOIN attendance_devices d ON d.id = p.device_id
       LEFT JOIN student_profiles sp ON sp.id = p.student_id
       LEFT JOIN users su            ON su.id = sp.user_id
       LEFT JOIN staff_profiles sf   ON sf.id = p.staff_id
       LEFT JOIN users fu            ON fu.id = sf.user_id
      WHERE p.tenant_id = $1 AND p.branch_id = ANY ($2)
        AND ($3::uuid IS NULL OR p.device_id = $3)
        AND ($4::text IS NULL OR p.result = $4)
      ORDER BY p.punched_at DESC
      LIMIT $5 OFFSET $6`,
    [scope.tenantId, branchIds, deviceId ?? null, result ?? null, limit, (page - 1) * limit],
  );
  const total = rows[0]?.total_count ?? 0;
  return {
    data: rows.map((r) => ({
      id: r.id,
      identifier: r.identifier,
      kind: r.kind,
      punchedAt: r.punched_at,
      result: r.result,
      detail: r.detail,
      device: r.device_name,
      person: r.person_type ? { type: r.person_type, name: r.person_name?.trim() || null } : null,
    })),
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

// ------------------------------------------------------------------ identifiers (card numbers)

export async function listIdentifiers(auth, { tenantId, branchId, search, page, limit }) {
  const scope = await scopeFor(auth, tenantId);
  const target = targetBranch(scope, branchId ?? scope.ownBranchId ?? scope.branches[0]?.id);
  const like = search ? `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const { rows } = await pool.query(
    `SELECT i.id, i.kind, i.value, i.created_at,
            CASE WHEN i.student_id IS NOT NULL THEN 'student' ELSE 'staff' END AS person_type,
            COALESCE(i.student_id, i.staff_id) AS person_id,
            COALESCE(sp.admission_number, sf.employee_code) AS number,
            COALESCE(NULLIF(concat_ws(' ', su.first_name, su.last_name), ''), NULLIF(concat_ws(' ', fu.first_name, fu.last_name), '')) AS name,
            count(*) OVER ()::int AS total_count
       FROM attendance_identifiers i
       LEFT JOIN student_profiles sp ON sp.id = i.student_id
       LEFT JOIN users su            ON su.id = sp.user_id
       LEFT JOIN staff_profiles sf   ON sf.id = i.staff_id
       LEFT JOIN users fu            ON fu.id = sf.user_id
      WHERE i.tenant_id = $1 AND i.branch_id = $2
        AND ($3::text IS NULL OR i.value ILIKE $3 OR sp.admission_number ILIKE $3 OR sf.employee_code ILIKE $3
             OR concat_ws(' ', su.first_name, su.last_name) ILIKE $3 OR concat_ws(' ', fu.first_name, fu.last_name) ILIKE $3)
      ORDER BY name
      LIMIT $4 OFFSET $5`,
    [scope.tenantId, target, like, limit, (page - 1) * limit],
  );
  const total = rows[0]?.total_count ?? 0;
  return {
    data: rows.map((r) => ({ id: r.id, kind: r.kind, value: r.value, person: { type: r.person_type, id: r.person_id, number: r.number, name: r.name?.trim() } })),
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/**
 * Bulk add / replace: rows of "admission number or employee code, card number". Each person gets
 * at most one identifier per kind (a new card replaces the old one). Returns what was saved and
 * which lines could not be matched.
 */
export async function saveIdentifiers(auth, { tenantId, branchId, kind, rows: lines }) {
  const scope = await scopeFor(auth, tenantId);
  const target = targetBranch(scope, branchId ?? scope.ownBranchId ?? scope.branches[0]?.id);
  const result = { saved: 0, replaced: 0, errors: [] };

  await withTransaction(async (db) => {
    for (const [i, line] of lines.entries()) {
      const number = String(line.number).trim();
      const value = String(line.value).trim();
      const { rows: [person] } = await db.query(
        `SELECT (SELECT id FROM student_profiles WHERE branch_id = $1 AND lower(admission_number) = lower($2) AND deleted_at IS NULL LIMIT 1) AS student_id,
                (SELECT id FROM staff_profiles   WHERE branch_id = $1 AND lower(employee_code)    = lower($2) AND deleted_at IS NULL LIMIT 1) AS staff_id`,
        [target, number],
      );
      const studentId = person?.student_id ?? null;
      const staffId = studentId ? null : person?.staff_id ?? null;
      if (!studentId && !staffId) {
        result.errors.push({ line: i + 1, number, message: 'No student (admission no.) or staff member (employee code) with this number in this branch' });
        continue;
      }
      const { rows: [taken] } = await db.query(
        `SELECT student_id, staff_id FROM attendance_identifiers WHERE tenant_id = $1 AND kind = $2 AND value = $3`,
        [scope.tenantId, kind, value],
      );
      if (taken && (taken.student_id !== studentId || taken.staff_id !== staffId)) {
        result.errors.push({ line: i + 1, number, message: `${value} already belongs to someone else` });
        continue;
      }
      if (taken) continue; // already this person's
      const { rowCount } = await db.query(
        `DELETE FROM attendance_identifiers WHERE tenant_id = $1 AND kind = $2 AND (student_id = $3 OR staff_id = $4)`,
        [scope.tenantId, kind, studentId, staffId],
      );
      await db.query(
        `INSERT INTO attendance_identifiers (tenant_id, branch_id, kind, value, student_id, staff_id, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [scope.tenantId, target, kind, value, studentId, staffId, auth.userId],
      );
      result.saved += 1;
      if (rowCount) result.replaced += 1;
    }
    if (result.saved) {
      await recordAudit(db, { tenantId: scope.tenantId, branchId: target, actorUserId: auth.userId, area: 'devices', action: 'identifiers', summary: `${result.saved} ${kind} number${result.saved === 1 ? '' : 's'} saved${result.replaced ? ` (${result.replaced} replaced)` : ''}` });
    }
  });
  return result;
}

export async function deleteIdentifier(auth, id, { tenantId }) {
  const scope = await scopeFor(auth, tenantId);
  const { rows: [row] } = await pool.query(`SELECT * FROM attendance_identifiers WHERE id = $1 AND tenant_id = $2`, [id, scope.tenantId]);
  if (!row || !scope.branches.some((b) => b.id === row.branch_id)) throw AppError.notFound('Not found', 'IDENTIFIER_NOT_FOUND');
  await pool.query(`DELETE FROM attendance_identifiers WHERE id = $1`, [id]);
  await recordAudit(pool, { tenantId: scope.tenantId, branchId: row.branch_id, actorUserId: auth.userId, area: 'devices', action: 'identifiers', summary: `${row.kind} number ${row.value} removed` });
  return { deleted: true };
}
