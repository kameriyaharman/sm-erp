import { AppError } from '../../errors/AppError.js';
import { ROLES } from '../../config/roles.js';
import { query } from '../../db/pool.js';
import { resolveBranchScope } from '../../middleware/scope.js';
import { hasSection, makeTeacherScope } from './teacher-scope.helpers.js';

/**
 * Scope helpers for the school-operations modules. They extend middleware/scope.js
 * (admins only) with the teacher (own branch) and parent (own children) rules.
 */

export const ADMINS = [ROLES.SUPER_ADMIN, ROLES.BRANCH_ADMIN];
export const STAFF = [ROLES.SUPER_ADMIN, ROLES.BRANCH_ADMIN, ROLES.TEACHER];

export const isAdmin = (auth) => auth.role === ROLES.SUPER_ADMIN || auth.role === ROLES.BRANCH_ADMIN;

/**
 * Branches a staff caller may read: teacher = own branch, admins as resolveBranchScope.
 * Returns { tenantId, branchIds } (null = unrestricted), like resolveBranchScope.
 */
export async function staffScope(auth, { branchId } = {}) {
  if (auth.role === ROLES.TEACHER) {
    if (branchId && branchId !== auth.branchId) {
      throw AppError.forbidden('You can only access your own branch', 'BRANCH_SCOPE_VIOLATION');
    }
    return { tenantId: auth.tenantId, branchIds: [auth.branchId] };
  }
  return resolveBranchScope(auth, { branchId });
}

/** Row-level check for one branch-owned record; teacher = own branch. */
export function canAccessBranch(auth, { tenantId, branchId }) {
  switch (auth.role) {
    case ROLES.SUPER_ADMIN:
      return auth.tenantId === null || auth.tenantId === tenantId;
    case ROLES.BRANCH_ADMIN:
    case ROLES.TEACHER:
      return auth.branchId === branchId && auth.tenantId === tenantId;
    default:
      return false;
  }
}

/** 404 (never 403) when the record is outside the caller's scope. */
export function assertStaffAccess(auth, row, message = 'Record not found', code = 'NOT_FOUND') {
  if (!row || !canAccessBranch(auth, { tenantId: row.tenant_id, branchId: row.branch_id })) {
    throw AppError.notFound(message, code);
  }
}

/**
 * The branch a new record is written to. branch_admin / teacher: their own branch.
 * super_admin: `branchId` if given (must be in their tenant), else the tenant's head
 * office (or its only branch).
 */
export async function resolveWriteBranch(auth, branchId) {
  if (auth.role !== ROLES.SUPER_ADMIN) {
    if (branchId && branchId !== auth.branchId) {
      throw AppError.forbidden('You can only access your own branch', 'BRANCH_SCOPE_VIOLATION');
    }
    return { tenantId: auth.tenantId, branchId: auth.branchId };
  }
  const { rows } = await query(
    `SELECT id, tenant_id FROM branches
      WHERE deleted_at IS NULL AND ($1::uuid IS NULL OR tenant_id = $1) AND ($2::uuid IS NULL OR id = $2)
      ORDER BY is_head_office DESC, created_at
      LIMIT 2`,
    [auth.tenantId, branchId ?? null],
  );
  if (branchId) {
    if (rows.length === 0) throw AppError.notFound('Branch not found', 'BRANCH_NOT_FOUND');
    return { tenantId: rows[0].tenant_id, branchId: rows[0].id };
  }
  if (rows.length === 0 || !auth.tenantId) {
    throw new AppError(422, 'BRANCH_REQUIRED', 'Choose a branch (branchId) for this record');
  }
  return { tenantId: rows[0].tenant_id, branchId: rows[0].id };
}

/**
 * A parent's child, or 404. Children = students whose primary parent is the caller,
 * or who list the caller as a guardian (same rule as the parent home and payments).
 * A student signed in to the family portal gets only their own profile.
 */
export async function loadChildForParent(db, auth, studentId) {
  const { rows } = await db.query(
    `SELECT sp.id, sp.tenant_id, sp.branch_id, sp.class_id, sp.section_id, sp.academic_year_id, sp.roll_number,
            concat_ws(' ', u.first_name, u.last_name) AS name, c.name AS class_name, s.name AS section_name
       FROM student_profiles sp
       JOIN users u ON u.id = sp.user_id
       LEFT JOIN classes c  ON c.id = sp.class_id
       LEFT JOIN sections s ON s.id = sp.section_id
      WHERE sp.id = $1 AND sp.tenant_id = $3 AND sp.deleted_at IS NULL
        AND (sp.parent_id = $2
             OR EXISTS (SELECT 1 FROM student_guardians g WHERE g.student_id = sp.id AND g.guardian_user_id = $2)
             OR sp.user_id = $2)`,
    [studentId, auth.userId, auth.tenantId],
  );
  if (!rows[0]) throw AppError.notFound('Student not found', 'STUDENT_NOT_FOUND');
  return rows[0];
}

/** Section with class + current-year flag, scoped for staff (404 outside scope). */
export async function loadSectionForStaff(db, auth, sectionId) {
  const { rows } = await db.query(
    `SELECT s.id, s.name, s.tenant_id, s.branch_id, s.class_id, s.academic_year_id, s.class_teacher_id,
            c.name AS class_name, c.numeric_level, ay.is_current, ay.name AS academic_year,
            (now() AT TIME ZONE t.timezone)::date AS today, t.timezone
       FROM sections s
       JOIN classes c         ON c.id = s.class_id
       JOIN academic_years ay ON ay.id = s.academic_year_id
       JOIN tenants t         ON t.id = s.tenant_id
      WHERE s.id = $1 AND s.deleted_at IS NULL`,
    [sectionId],
  );
  assertStaffAccess(auth, rows[0], 'Section not found', 'SECTION_NOT_FOUND');
  return rows[0];
}

export const unprocessable = (code, message, details) => new AppError(422, code, message, details);
export const conflict = (code, message, details) => new AppError(409, code, message, details);

/** Paging meta in the shape every list endpoint uses. */
export const pageMeta = ({ page, limit }, total, extra = {}) => ({ page, limit, total, totalPages: Math.ceil(total / limit), ...extra });

// =====================================================================
// Teachers: subject + section scope (teacher_subject_assignments)
// =====================================================================

/**
 * The calling teacher's current-year scope: class-teacher sections and (section, subject)
 * assignments. A user without an active staff profile gets an empty scope.
 * Returns makeTeacherScope(...) (see teacher-scope.helpers.js).
 */
export async function loadTeacherScope(db, auth) {
  const { rows: [row] } = await db.query(
    `SELECT sf.id AS staff_id,
            COALESCE((SELECT array_agg(s.id)
                        FROM sections s
                        JOIN academic_years ay ON ay.id = s.academic_year_id AND ay.is_current
                       WHERE s.class_teacher_id = sf.id AND s.deleted_at IS NULL), '{}') AS class_teacher_of,
            COALESCE((SELECT json_agg(json_build_object('sectionId', a.section_id, 'subjectId', a.subject_id))
                        FROM teacher_subject_assignments a
                        JOIN academic_years ay ON ay.id = a.academic_year_id AND ay.is_current
                        JOIN sections s        ON s.id = a.section_id AND s.deleted_at IS NULL
                       WHERE a.staff_id = sf.id), '[]'::json) AS assignments
       FROM staff_profiles sf
       JOIN users u ON u.id = sf.user_id
      WHERE sf.user_id = $1 AND sf.tenant_id = $2 AND sf.deleted_at IS NULL AND sf.status = 'active'`,
    [auth.userId, auth.tenantId],
  );
  return makeTeacherScope({
    staffId: row?.staff_id ?? null,
    classTeacherOf: row?.class_teacher_of ?? [],
    assignments: row?.assignments ?? [],
  });
}

export const notAssigned = (message = 'You are not assigned to this class or subject') =>
  AppError.forbidden(message, 'NOT_ASSIGNED');

/**
 * Section the caller may read: admins by branch scope; a teacher only their own sections
 * (class teacher or teaches a subject there). Other branch -> 404, own branch but not
 * theirs -> 403 NOT_ASSIGNED. Returns the loadSectionForStaff row (+ teacherScope for teachers).
 */
export async function loadSectionInScope(db, auth, sectionId) {
  const section = await loadSectionForStaff(db, auth, sectionId);
  if (auth.role !== ROLES.TEACHER) return section;
  const teacherScope = await loadTeacherScope(db, auth);
  if (!hasSection(teacherScope, section.id)) throw notAssigned('This section is not one of your classes');
  return { ...section, teacherScope };
}
