import { ROLES } from '../../config/roles.js';
import { pool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';

/**
 * Who may change which settings.
 *
 *   school owner (super_admin of the school)   everything, school-wide and per branch
 *   branch admin                               their own branch; school-wide settings too when the school has ONE branch
 *                                              (a single-campus school's principal runs everything)
 *   platform admin (super_admin, no school)    any school, with ?tenantId= (support)
 *
 * Returns { tenantId, branches, canEditSchool, ownBranchId }.
 */
export async function settingsScope(auth, { tenantId: requestedTenantId } = {}) {
  let tenantId = auth.tenantId;
  if (!tenantId) {
    if (auth.role !== ROLES.SUPER_ADMIN) throw AppError.forbidden();
    if (!requestedTenantId) throw new AppError(422, 'TENANT_REQUIRED', 'Choose a school (tenantId) to manage its settings');
    tenantId = requestedTenantId;
  } else if (requestedTenantId && requestedTenantId !== tenantId) {
    throw AppError.forbidden('You can only access your own organisation', 'TENANT_SCOPE_VIOLATION');
  }

  const { rows } = await pool.query(
    `SELECT b.id, b.name, b.code, b.is_head_office, t.name AS school_name, t.code AS school_code, t.timezone
       FROM tenants t
       LEFT JOIN branches b ON b.tenant_id = t.id AND b.deleted_at IS NULL AND b.status = 'active'
      WHERE t.id = $1 AND t.deleted_at IS NULL
      ORDER BY b.is_head_office DESC, b.name`,
    [tenantId],
  );
  if (rows.length === 0) throw AppError.notFound('School not found', 'TENANT_NOT_FOUND');
  const branches = rows.filter((r) => r.id).map((r) => ({ id: r.id, name: r.name, code: r.code, isHeadOffice: r.is_head_office }));
  const canEditSchool = auth.role === ROLES.SUPER_ADMIN || (auth.role === ROLES.BRANCH_ADMIN && branches.length <= 1);
  const visible = auth.role === ROLES.BRANCH_ADMIN ? branches.filter((b) => b.id === auth.branchId) : branches;
  return {
    tenantId,
    school: { name: rows[0].school_name, code: rows[0].school_code, timezone: rows[0].timezone },
    branches: visible,
    allBranchCount: branches.length,
    canEditSchool,
    ownBranchId: auth.role === ROLES.BRANCH_ADMIN ? auth.branchId : null,
  };
}

/** 403 unless the caller may change school-wide settings. */
export function assertSchoolEditor(scope, what = 'school-wide settings') {
  if (!scope.canEditSchool) {
    throw AppError.forbidden(`Only the school owner can change ${what}`, 'OWNER_ONLY');
  }
}

/**
 * The branch a branch-level write targets: undefined/null = school-wide (owner), uuid = that branch
 * (branch admins: their own only). Returns null for school-wide.
 */
export function targetBranch(scope, branchId) {
  if (branchId === undefined || branchId === null) {
    assertSchoolEditor(scope);
    return null;
  }
  if (!scope.branches.some((b) => b.id === branchId)) {
    throw AppError.notFound('Branch not found', 'BRANCH_NOT_FOUND');
  }
  return branchId;
}
