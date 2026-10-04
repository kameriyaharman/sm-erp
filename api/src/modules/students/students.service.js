import bcrypt from 'bcryptjs';
import { createHash, randomUUID } from 'node:crypto';
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
import { addressOut, checkImage, maskAadhaar, MAX_PHOTO_BYTES } from '../setup/profile.helpers.js';
import { profileColumns } from './student-profile.js';
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

async function assertAadhaarFree(db, tenantId, aadhaar, exceptStudentId = null) {
  if (!aadhaar) return;
  const owner = await repo.aadhaarOwner(db, tenantId, aadhaar, exceptStudentId);
  if (owner) {
    throw conflict('AADHAAR_TAKEN', `This Aadhaar number is already recorded for student ${owner}`, { admissionNumber: owner });
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
    address: addressOut(s.address),
    aadhaarMasked: maskAadhaar(s.aadhaar_number),
    religion: s.religion,
    motherTongue: s.mother_tongue,
    nationality: s.nationality,
    house: s.house,
    identificationMarks: s.identification_marks,
    photo: s.photo_updated_at ? { url: `/students/${s.id}/photo`, updatedAt: s.photo_updated_at } : null,
    class: s.class_id ? { id: s.class_id, name: s.class_name } : null,
    section: s.section_id ? { id: s.section_id, name: s.section_name } : null,
    academicYear: s.year_id ? { id: s.year_id, name: s.year_name } : null,
    fatherName: s.father_name,
    motherName: s.mother_name,
    guardianName: s.guardian_name,
    socialCategory: s.social_category,
    penNumber: s.pen_number,
    apaarId: s.apaar_id,
    father: { name: s.father_name, phone: s.father_phone, email: s.father_email, occupation: s.father_occupation },
    mother: { name: s.mother_name, phone: s.mother_phone, email: s.mother_email, occupation: s.mother_occupation },
    guardian: { name: s.guardian_name, relation: s.guardian_relation, phone: s.guardian_phone },
    emergencyContact: s.emergency_contact_name || s.emergency_contact_phone
      ? { name: s.emergency_contact_name, relation: s.emergency_contact_relation, phone: s.emergency_contact_phone }
      : null,
    previousSchool: s.previous_school || s.last_class_passed || s.tc_number
      ? { name: s.previous_school, board: s.previous_school_board, lastClassPassed: s.last_class_passed, tcNumber: s.tc_number, tcDate: s.tc_date }
      : null,
    medical: { bloodGroup: s.blood_group, allergies: s.allergies, notes: s.medical_notes },
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
  const extra = profileColumns(input);
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
    await assertAadhaarFree(db, section.tenant_id, extra.aadhaar_number);

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
      fatherName: extra.father_name,
      motherName: extra.mother_name,
      socialCategory: input.socialCategory,
    });
    await repo.updateStudentProfile(db, studentId, extra);

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
  const profile = profileColumns(patch);
  const warnings = [];

  const tenantId = await withTransaction(async (db) => {
    const s = await repo.getStudent(db, studentId, { forUpdate: true });
    assertStaffAccess(auth, s, 'Student not found', 'STUDENT_NOT_FOUND');

    if (patch.gender !== undefined) profile.gender = patch.gender;
    if (patch.dateOfBirth !== undefined) profile.date_of_birth = patch.dateOfBirth;
    if (patch.admissionDate !== undefined) profile.admission_date = patch.admissionDate;
    await assertAadhaarFree(db, s.tenant_id, profile.aadhaar_number, s.id);

    const classChange = Boolean(patch.classId && patch.classId !== s.class_id);
    const sectionChange = Boolean(patch.sectionId && patch.sectionId !== s.section_id);
    let targetSection = s.section_id;
    if (classChange || sectionChange) {
      const section = await repo.getSectionForAdmission(db, patch.sectionId);
      if (!section || section.branch_id !== s.branch_id) throw AppError.notFound('Section not found', 'SECTION_NOT_FOUND');
      if (section.class_id !== (patch.classId ?? s.class_id)) {
        throw unprocessable('SECTION_NOT_IN_CLASS', 'The section does not belong to the selected class', { sectionId: patch.sectionId });
      }
      if (s.academic_year_id ? section.academic_year_id !== s.academic_year_id : !section.is_current) {
        throw unprocessable('SECTION_NOT_IN_YEAR', 'A student can only move to a section of the same academic year. Use promotion to move to the next year.');
      }
      await repo.lockBranchAdmissions(db, s.branch_id);
      profile.section_id = section.id;
      profile.class_id = section.class_id;
      if (!s.academic_year_id) profile.academic_year_id = section.academic_year_id;
      targetSection = section.id;
      // Keep the roll number if it is free in the new section, else take the next one.
      if (!patch.rollNumber) {
        profile.roll_number = s.roll_number && !(await repo.rollTaken(db, section.id, s.roll_number, s.id))
          ? s.roll_number
          : nextRollNumber(await repo.sectionRolls(db, section.id));
      }
      if (section.class_id !== s.class_id && s.academic_year_id) {
        const invoices = await repo.countInvoices(db, s.id, s.academic_year_id);
        warnings.push({
          code: 'FEES_NOT_CHANGED',
          message: invoices > 0
            ? `Class changed. The ${invoices} fee invoice${invoices === 1 ? '' : 's'} already raised this year are unchanged; adjust them in Fees if the new class pays a different fee.`
            : 'Class changed. The fee instalments from the old class are unchanged; adjust them in Fees if the new class pays a different fee.',
        });
      }
    }
    if (patch.rollNumber) {
      if (!targetSection) throw unprocessable('NO_SECTION', 'Place the student in a section before giving a roll number');
      if (await repo.rollTaken(db, targetSection, patch.rollNumber, s.id)) {
        throw conflict('ROLL_NUMBER_TAKEN', `Roll number ${patch.rollNumber} is already used in this section`, { rollNumber: patch.rollNumber });
      }
      profile.roll_number = patch.rollNumber;
    }

    if (parentPhone) {
      // Link to the family account with this mobile; otherwise update the linked parent's mobile.
      const existing = await repo.findParentByPhone(db, s.tenant_id, parentPhone.national);
      if (existing) profile.parent_id = existing;
      else if (s.parent_user_id) await repo.updateUserPhone(db, s.parent_user_id, parentPhone.e164);
      else throw unprocessable('PARENT_NOT_FOUND', 'No parent account has this mobile number. Admit the student with parent details first.');
    }

    const dob = patch.dateOfBirth ?? s.date_of_birth;
    const admitted = patch.admissionDate ?? s.admission_date;
    if (dob >= admitted) throw invalid('dateOfBirth', 'Date of birth must be before the admission date');
    if (s.date_of_leaving && patch.admissionDate && patch.admissionDate > s.date_of_leaving) {
      throw invalid('admissionDate', 'Admission date must be before the date of leaving');
    }

    if (patch.firstName !== undefined || patch.lastName !== undefined) {
      await repo.updateStudentUser(db, s.user_id, { firstName: patch.firstName, lastName: patch.lastName });
    }
    await repo.updateStudentProfile(db, s.id, profile);
    return s.tenant_id;
  });

  return { detail: await buildDetail(pool, await repo.getStudent(pool, studentId)), tenantId, warnings };
}

// =====================================================================
// Photo and Aadhaar
// =====================================================================

/** Staff who may see the student (teachers: their sections) may see the photo. */
export async function getPhoto(auth, studentId) {
  await getStudentForRead(auth, studentId);
  const photo = await repo.getPhoto(pool, studentId);
  if (!photo) throw AppError.notFound('This student has no photo', 'PHOTO_NOT_FOUND');
  return photo;
}

async function getStudentForRead(auth, studentId) {
  const s = await repo.getStudent(pool, studentId);
  assertStaffAccess(auth, s, 'Student not found', 'STUDENT_NOT_FOUND');
  if (auth.role === ROLES.TEACHER && !(s.section_id && hasSection(await loadTeacherScope(pool, auth), s.section_id))) {
    throw notAssigned('This student is not in one of your classes');
  }
  return s;
}

export async function putPhoto(auth, studentId, file) {
  const s = await repo.getStudent(pool, studentId);
  assertStaffAccess(auth, s, 'Student not found', 'STUDENT_NOT_FOUND');
  const check = checkImage(file, { kinds: ['jpeg', 'png', 'webp'], maxBytes: MAX_PHOTO_BYTES, label: 'Photo' });
  if (!check.ok) throw new AppError(check.status, check.code, check.message);
  const sha256 = createHash('sha256').update(file.buffer).digest('hex');
  const updatedAt = await repo.upsertPhoto(pool, {
    studentId, tenantId: s.tenant_id, branchId: s.branch_id, mime: check.mime, size: file.buffer.length, sha256, data: file.buffer, uploadedBy: auth.userId,
  });
  logger.info('Student photo saved', { studentId, bytes: file.buffer.length, by: auth.userId });
  return { url: `/students/${studentId}/photo`, updatedAt, mimeType: check.mime, sizeBytes: file.buffer.length };
}

export async function deletePhoto(auth, studentId) {
  const s = await repo.getStudent(pool, studentId);
  assertStaffAccess(auth, s, 'Student not found', 'STUDENT_NOT_FOUND');
  if (!(await repo.deletePhoto(pool, studentId))) throw AppError.notFound('This student has no photo', 'PHOTO_NOT_FOUND');
}

/** Full Aadhaar for the school office (ADMINS). Every reveal is logged. */
export async function revealAadhaar(auth, studentId) {
  const s = await repo.getAadhaar(pool, studentId);
  assertStaffAccess(auth, s, 'Student not found', 'STUDENT_NOT_FOUND');
  logger.info('Aadhaar revealed', { studentId, admissionNumber: s.admission_number, by: auth.userId, role: auth.role });
  const n = s.aadhaar_number;
  return { aadhaarNumber: n ? `${n.slice(0, 4)} ${n.slice(4, 8)} ${n.slice(8)}` : null };
}
