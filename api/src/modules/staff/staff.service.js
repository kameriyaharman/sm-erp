import bcrypt from 'bcryptjs';
import { pool, withTransaction } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { ROLES } from '../../config/roles.js';
import { logger } from '../../utils/logger.js';
import { assertStaffAccess, conflict, resolveWriteBranch, staffScope } from '../shared/access.js';
import { nextSequenceCode } from '../shared/school-ops.helpers.js';
import * as repo from './staff.repository.js';

function mapStaff(r) {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email,
    phone: r.phone,
    role: r.role,
    employeeCode: r.employee_code,
    designation: r.designation,
    department: r.department,
    dateOfJoining: r.date_of_joining,
    status: r.status,
    classTeacherOf: r.class_teacher_of,
    subjects: r.subjects,
  };
}

export async function listStaff(auth, { branchId }) {
  return (await repo.listStaff(await staffScope(auth, { branchId }))).map(mapStaff);
}

export async function createStaff(auth, input) {
  if (auth.role === ROLES.BRANCH_ADMIN && input.role !== ROLES.TEACHER) {
    throw AppError.forbidden('A branch admin can only add teachers', 'INSUFFICIENT_ROLE');
  }
  const { tenantId, branchId } = await resolveWriteBranch(auth, input.branchId);
  const passwordHash = await bcrypt.hash(input.password, 12);

  const id = await withTransaction(async (db) => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext('staff:' || $1::text))`, [branchId]);
    if (await repo.emailTaken(db, tenantId, input.email)) {
      throw conflict('CONFLICT', 'Another account in this school already uses this email', { email: input.email });
    }
    let employeeCode = input.employeeCode;
    if (employeeCode) {
      if (await repo.employeeCodeTaken(db, branchId, employeeCode)) {
        throw conflict('CONFLICT', `Employee code ${employeeCode} is already in use`, { employeeCode });
      }
    } else {
      employeeCode = nextSequenceCode(await repo.employeeCodes(db, branchId), 'EMP-001');
      while (await repo.employeeCodeTaken(db, branchId, employeeCode)) employeeCode = nextSequenceCode([employeeCode]);
    }
    return repo.insertStaff(db, { ...input, tenantId, branchId, employeeCode, passwordHash });
  });

  logger.info('Staff member added', { staffId: id, role: input.role, by: auth.userId });
  return mapStaff(await repo.getStaff(pool, id));
}

export async function updateStaff(auth, id, patch) {
  await withTransaction(async (db) => {
    const row = await repo.getStaff(db, id);
    assertStaffAccess(auth, row, 'Staff member not found', 'STAFF_NOT_FOUND');
    if (row.user_id === auth.userId && patch.status === 'inactive') {
      throw new AppError(422, 'CANNOT_DEACTIVATE_SELF', 'You cannot deactivate your own account');
    }
    await repo.updateStaff(db, row, patch);
  });
  return mapStaff(await repo.getStaff(pool, id));
}
