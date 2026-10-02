import { AppError } from '../errors/AppError.js';
import { ALL_ROLES } from '../config/roles.js';

/**
 * Role-based access control. Must run after `authenticate`.
 *
 *   router.get('/defaulters', authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.BRANCH_ADMIN), handler)
 *
 * Misconfiguration (no roles, unknown role name) throws at startup, not per request,
 * so a typo can never silently open or close an endpoint.
 */
export function authorize(...allowedRoles) {
  const roles = allowedRoles.flat();

  if (roles.length === 0) {
    throw new Error('authorize() requires at least one role');
  }
  const unknown = roles.filter((role) => !ALL_ROLES.includes(role));
  if (unknown.length > 0) {
    throw new Error(`authorize() received unknown role(s): ${unknown.join(', ')}`);
  }

  const allowed = new Set(roles);

  return function authorizeMiddleware(req, _res, next) {
    if (!req.auth) {
      return next(AppError.unauthorized());
    }
    if (!allowed.has(req.auth.role)) {
      return next(AppError.forbidden('Your role does not have access to this resource', 'INSUFFICIENT_ROLE'));
    }
    return next();
  };
}
