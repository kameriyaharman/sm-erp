import { AppError } from '../errors/AppError.js';
import { ROLES } from '../config/roles.js';
import { query } from '../db/pool.js';

/**
 * Turns the caller's identity plus optional ?tenantId / ?branchId filters into the
 * data scope a query is allowed to touch. Role checks say *whether* you may call an
 * endpoint; this says *whose rows* you may see.
 *
 * Returns { tenantId: uuid|null, branchIds: uuid[]|null }  (null = unrestricted)
 *
 *   branch_admin              -> own branch only (asking for another branch is a 403)
 *   super_admin (tenant)      -> any branch of own tenant
 *   super_admin (platform)    -> any tenant / branch
 */
export async function resolveBranchScope(auth, { tenantId: requestedTenantId, branchId: requestedBranchId } = {}) {
  switch (auth.role) {
    case ROLES.BRANCH_ADMIN: {
      if (requestedBranchId && requestedBranchId !== auth.branchId) {
        throw AppError.forbidden('You can only access your own branch', 'BRANCH_SCOPE_VIOLATION');
      }
      return { tenantId: auth.tenantId, branchIds: [auth.branchId] };
    }

    case ROLES.SUPER_ADMIN: {
      const tenantId = auth.tenantId ?? requestedTenantId ?? null;
      if (auth.tenantId && requestedTenantId && requestedTenantId !== auth.tenantId) {
        throw AppError.forbidden('You can only access your own organisation', 'TENANT_SCOPE_VIOLATION');
      }
      if (!requestedBranchId) return { tenantId, branchIds: null };

      const { rows } = await query(
        `SELECT id FROM branches
          WHERE id = $1 AND ($2::uuid IS NULL OR tenant_id = $2) AND deleted_at IS NULL`,
        [requestedBranchId, tenantId],
      );
      // 404, not 403: don't confirm that another tenant's branch exists.
      if (rows.length === 0) throw AppError.notFound('Branch not found', 'BRANCH_NOT_FOUND');
      return { tenantId, branchIds: [requestedBranchId] };
    }

    default:
      throw AppError.forbidden('Your role cannot access branch-level data', 'INSUFFICIENT_ROLE');
  }
}

/**
 * Row-level check for a single record that belongs to a branch.
 * Throws 404 (not 403) when out of scope, so callers can't probe for other
 * schools' or branches' records by id.
 */
export function assertBranchAccess(auth, { tenantId, branchId }, notFoundMessage = 'Record not found') {
  const allowed =
    (auth.role === ROLES.SUPER_ADMIN && (auth.tenantId === null || auth.tenantId === tenantId)) ||
    (auth.role === ROLES.BRANCH_ADMIN && auth.branchId === branchId);

  if (!allowed) throw AppError.notFound(notFoundMessage);
}
