import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { pool, withTransaction } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { logger } from '../../utils/logger.js';
import { normalizePhone } from '../notifications/phone.js';
import { ROLES } from '../../config/roles.js';
import {
  assertStaffAccess, conflict, loadSectionInScope, loadTeacherScope, notAssigned, pageMeta, staffScope, unprocessable,
} from '../shared/access.js';
import { hasSection } from '../shared/teacher-scope.helpers.js';
import { attendanceStats, likePattern, nextRollNumber, nextSequenceCode, splitName } from '../shared/school-ops.helpers.js';
import * as repo from './students.repository.js';

const BCRYPT_COST = 12;
const invalid = (field, message) => AppError.badRequest('Validation failed', { body: { [field]: [message] } }, 'VALIDATION_ERROR');

/** "098100 55555" -> { e164: '+919810055555', national: '9810055555' }, or a 400 on `field`. */
function parsePhone(input, field) {
  try {
    const e164 = normalizePhone(input);
    if (!e164.startsWith('+91')) return { e164, national: e164.slice(1) };
    return { e164, national: e164.slice(3) };
  } catch (err) {
    throw invalid(field, err.message);
  }
}

function mapListRow(r) {
  return {
    id: r.id,
    name: r.name,
    firstName: r.first_name,
    lastName: r.last_name,
    admissionNumber: r.admission_number,
    rollNumber: r.roll_number,
    gender: r.gender,
    dateOfBirth: r.date_of_birth,
    admissionDate: r.admission_date,
    status: r.status,
    class: r.class_id ? { id: r.class_id, name: r.class_name } : null,
    section: r.section_id ? { id: r.section_id, name: r.section_name } : null,
    parent: r.parent_id ? { name: r.parent_name, phone: r.parent_phone } : null,
  };
}

// =====================================================================
// Queries
// =====================================================================

/** Teacher: only students of their sections (class teacher or subject teacher). */
export async function listStudents(auth, { branchId, search, ...filters }) {
  const scope = await staffScope(auth, { branchId });
  let sectionIds = null;
  if (auth.role === ROLES.TEACHER) {
    if (filters.sectionId) await loadSectionInScope(pool, auth, filters.sectionId);
    sectionIds = [...(await loadTeacherScope(pool, auth)).sectionIds];
  }
  const rows = await repo.listStudents({ scope, filters, like: likePattern(search), sectionIds });
  const total = rows.length ? Number(rows[0].total_count) : 0;
  return { data: rows.map(mapListRow), meta: pageMeta(filters, total) };
}

async function buildDetail(db, s) {
  const [fees, counts, transport, cards, certs] = await Promise.all([
    repo.studentFeeTotals(db, s.id),
    repo.attendanceCounts(db, s.id, s.year_id),
    repo.transportFor(db, s.id),
    repo.reportCardsFor(db, s.id),
    repo.certificatesFor(db, s.id),
  ]);
  const address = s.address && Object.keys(s.address).length > 0 ? s.address : null;
  return {
    id: s.id,
    name: s.name,
    firstName: s.first_name,
    lastName: s.last_name,
    admissionNumber: s.admission_number,
    admissionDate: s.admission_date,
    rollNumber: s.roll_number,
    gender: s.gender,
    dateOfBirth: s.date_of_birth,
    status: s.status,
    dateOfLeaving: s.date_of_leaving,
    bloodGroup: s.blood_group,
    address,
    class: s.class_id ? { id: s.class_id, name: s.class_name } : null,
    section: s.section_id ? { id: s.section_id, name: s.section_name } : null,
    academicYear: s.year_id ? { id: s.year_id, name: s.year_name } : null,
    fatherName: s.father_name,
    motherName: s.mother_name,
    guardianName: s.guardian_name,
    socialCategory: s.social_category,
    penNumber: s.pen_number,
    apaarId: s.apaar_id,
    parent: s.parent_user_id ? { userId: s.parent_user_id, name: s.parent_name, phone: s.parent_phone, email: s.parent_email } : null,
    fees,
    attendance: attendanceStats(counts),
    transport: transport
      ? { routeId: transport.route_id, routeName: transport.route_name, stopName: transport.stop_name, pickupTime: transport.pickup_time }
      : null,
    reportCards: cards.map((c) => ({
      id: c.id,
      label: c.is_final ? 'Annual' : c.term_name ?? 'Report card',
      status: c.status,
      percentage: c.percentage,
      grade: c.overall_grade,
      publishedAt: c.published_at,
    })),
    certificates: certs.map((c) => ({
      id: c.id,
      type: c.certificate_type,
      number: c.certificate_number,
      status: c.status,
      issuedAt: c.issued_at,
    })),
  };
}

export async function getStudent(auth, studentId) {
  const s = await repo.getStudent(pool, studentId);
  assertStaffAccess(auth, s, 'Student not found', 'STUDENT_NOT_FOUND');
  if (auth.role === ROLES.TEACHER && !(s.section_id && hasSection(await loadTeacherScope(pool, auth), s.section_id))) {
    throw notAssigned('This student is not in one of your classes');
  }
  return buildDetail(pool, s);
}

// =====================================================================
// Admission
// =====================================================================

export async function admitStudent(auth, input) {
  const parentPhone = parsePhone(input.parent.phone, 'parent');
  // bcrypt is slow on purpose: hash before taking locks.
  const [studentHash, parentHash] = await Promise.all([
    bcrypt.hash(randomUUID(), BCRYPT_COST),
    bcrypt.hash(randomUUID(), BCRYPT_COST),
  ]);

  const result = await withTransaction(async (db) => {
    const section = await repo.getSectionForAdmission(db, input.sectionId);
    assertStaffAccess(auth, section, 'Section not found', 'SECTION_NOT_FOUND');
    if (section.class_id !== input.classId) {
      throw unprocessable('SECTION_NOT_IN_CLASS', 'The section does not belong to the selected class', { sectionId: input.sectionId });
    }
    if (!section.is_current) {
      throw unprocessable('SECTION_NOT_CURRENT', 'Admissions go into a section of the current academic year');
    }
    const admissionDate = input.admissionDate ?? section.today;
    if (input.dateOfBirth >= admissionDate) throw invalid('dateOfBirth', 'Date of birth must be before the admission date');

    await repo.lockBranchAdmissions(db, section.branch_id);

    let admissionNumber = input.admissionNumber;
    if (admissionNumber) {
      if (await repo.admissionNumberExists(db, section.branch_id, admissionNumber)) {
        throw conflict('CONFLICT', `Admission number ${admissionNumber} is already in use`, { admissionNumber });
      }
    } else {
      admissionNumber = nextSequenceCode(await repo.recentAdmissionNumbers(db, section.branch_id), 'ADM-0001');
      while (await repo.admissionNumberExists(db, section.branch_id, admissionNumber)) {
        admissionNumber = nextSequenceCode([admissionNumber], 'ADM-0001');
      }
    }

    let rollNumber = input.rollNumber;
    if (rollNumber) {
      if (await repo.rollTaken(db, section.id, rollNumber)) {
        throw conflict('ROLL_NUMBER_TAKEN', `Roll number ${rollNumber} is already used in this section`, { rollNumber });
      }
    } else {
      rollNumber = nextRollNumber(await repo.sectionRolls(db, section.id));
    }

    // Parent: reuse the family's account (siblings) or create one that cannot log in yet.
    let parentId = await repo.findParentByPhone(db, section.tenant_id, parentPhone.national);
    const parentCreated = !parentId;
    if (!parentId) {
      const { firstName, lastName } = splitName(input.parent.name);
      parentId = await repo.insertUser(db, {
        tenantId: section.tenant_id,
        role: 'parent',
        email: input.parent.email,
        phone: parentPhone.e164,
        passwordHash: parentHash,
        firstName,
        lastName,
      });
    }

    const userId = await repo.insertUser(db, {
      tenantId: section.tenant_id,
      branchId: section.branch_id,
      role: 'student',
      username: admissionNumber.toLowerCase(),
      passwordHash: studentHash,
      firstName: input.firstName,
      lastName: input.lastName,
    });

    const studentId = await repo.insertStudentProfile(db, {
      tenantId: section.tenant_id,
      branchId: section.branch_id,
      userId,
      admissionNumber,
      admissionDate,
      rollNumber,
      academicYearId: section.academic_year_id,
      classId: section.class_id,
      sectionId: section.id,
      parentId,
      dateOfBirth: input.dateOfBirth,
      gender: input.gender,
      fatherName: input.fatherName,
      motherName: input.motherName,
      socialCategory: input.socialCategory,
    });

    const allocations = input.applyFeeStructure
      ? await repo.allocateFeeStructure(db, {
          tenantId: section.tenant_id,
          branchId: section.branch_id,
          studentId,
          classId: section.class_id,
          academicYearId: section.academic_year_id,
        })
      : 0;

    return { studentId, tenantId: section.tenant_id, admissionNumber, parentCreated, allocations };
  });

  logger.info('Student admitted', {
    studentId: result.studentId,
    admissionNumber: result.admissionNumber,
    parentCreated: result.parentCreated,
    feeAllocations: result.allocations,
    by: auth.userId,
  });
  const detail = await buildDetail(pool, await repo.getStudent(pool, result.studentId));
  return { detail, tenantId: result.tenantId };
}

// =====================================================================
// Update
// =====================================================================

export async function updateStudent(auth, studentId, patch) {
  const parentPhone = patch.parentPhone ? parsePhone(patch.parentPhone, 'parentPhone') : null;

  const tenantId = await withTransaction(async (db) => {
    const s = await repo.getStudent(db, studentId, { forUpdate: true });
    assertStaffAccess(auth, s, 'Student not found', 'STUDENT_NOT_FOUND');

    const profile = {
      gender: patch.gender,
      dateOfBirth: patch.dateOfBirth,
      fatherName: patch.fatherName,
      motherName: patch.motherName,
      guardianName: patch.guardianName,
      socialCategory: patch.socialCategory,
      penNumber: patch.penNumber,
      apaarId: patch.apaarId,
    };

    const targetSection = patch.sectionId ?? s.section_id;
    if (patch.sectionId && patch.sectionId !== s.section_id) {
      const section = await repo.getSectionForAdmission(db, patch.sectionId);
      if (!section || section.branch_id !== s.branch_id) throw AppError.notFound('Section not found', 'SECTION_NOT_FOUND');
      if (section.class_id !== s.class_id || section.academic_year_id !== s.academic_year_id) {
        throw unprocessable('SECTION_NOT_IN_CLASS', 'A student can only move to another section of the same class and year');
      }
      await repo.lockBranchAdmissions(db, s.branch_id);
      profile.sectionId = patch.sectionId;
      // Keep the roll number if it is free in the new section, else take the next one.
      if (!patch.rollNumber) {
        profile.rollNumber = s.roll_number && !(await repo.rollTaken(db, patch.sectionId, s.roll_number, s.id))
          ? s.roll_number
          : nextRollNumber(await repo.sectionRolls(db, patch.sectionId));
      }
    }
    if (patch.rollNumber) {
      if (!targetSection) throw unprocessable('NO_SECTION', 'Place the student in a section before giving a roll number');
      if (await repo.rollTaken(db, targetSection, patch.rollNumber, s.id)) {
        throw conflict('ROLL_NUMBER_TAKEN', `Roll number ${patch.rollNumber} is already used in this section`, { rollNumber: patch.rollNumber });
      }
      profile.rollNumber = patch.rollNumber;
    }

    if (parentPhone) {
      // Link to the family account with this mobile; otherwise update the linked parent's mobile.
      const existing = await repo.findParentByPhone(db, s.tenant_id, parentPhone.national);
      if (existing) profile.parentId = existing;
      else if (s.parent_user_id) await repo.updateUserPhone(db, s.parent_user_id, parentPhone.e164);
      else throw unprocessable('PARENT_NOT_FOUND', 'No parent account has this mobile number. Admit the student with parent details first.');
    }

    const dob = patch.dateOfBirth ?? s.date_of_birth;
    if (dob >= s.admission_date) throw invalid('dateOfBirth', 'Date of birth must be before the admission date');

    if (patch.firstName !== undefined || patch.lastName !== undefined) {
      await repo.updateStudentUser(db, s.user_id, { firstName: patch.firstName, lastName: patch.lastName });
    }
    await repo.updateStudentProfile(db, s.id, profile);
    return s.tenant_id;
  });

  return { detail: await buildDetail(pool, await repo.getStudent(pool, studentId)), tenantId };
}
