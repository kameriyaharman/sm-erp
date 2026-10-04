import { createHash } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { pool, withTransaction } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { ROLES } from '../../config/roles.js';
import { logger } from '../../utils/logger.js';
import { assertStaffAccess, conflict, resolveWriteBranch, unprocessable } from '../shared/access.js';
import { checkImage, describeUsage, MAX_LOGO_BYTES, nextAcademicYear, usedBy, yearName } from './profile.helpers.js';
import * as repo from './setup.repository.js';

// Unique / exclusion constraints -> the sentence the office sees (409).
const CONSTRAINT_MESSAGES = {
  uq_academic_years_branch_name: 'An academic year with this name already exists',
  ex_academic_years_no_overlap: 'These dates overlap another academic year',
  uq_terms_year_name: 'This year already has a term with this name',
  uq_terms_year_seq: 'This year already has a term with this number',
  ex_terms_no_overlap: 'These dates overlap another term of the year',
  uq_classes_branch_name: 'A class with this name already exists',
  uq_classes_branch_code: 'Another class already uses this code',
  uq_sections_year_class_name: 'This class already has a section with this name this year',
  uq_subjects_branch_code: 'Another subject already uses this code',
};

/** Runs `fn`, turning duplicate / overlap errors from Postgres into a 409 with a plain message. */
async function friendly(fn) {
  try {
    return await fn();
  } catch (err) {
    if ((err.code === '23505' || err.code === '23P01') && CONSTRAINT_MESSAGES[err.constraint]) {
      throw conflict('DUPLICATE', CONSTRAINT_MESSAGES[err.constraint], { constraint: err.constraint });
    }
    throw err;
  }
}

function inUse(what, counts, hint) {
  const usage = usedBy(counts);
  return conflict('IN_USE', `${what} can't be deleted: ${describeUsage(usage)} ${Object.values(usage).reduce((a, b) => a + b, 0) === 1 ? 'uses' : 'use'} it.${hint ? ` ${hint}` : ''}`, { usage });
}

const branchOf = (auth, branchId) => resolveWriteBranch(auth, branchId);

/** A row of the caller's scope, else 404. */
function own(auth, row, label, code) {
  assertStaffAccess(auth, row, `${label} not found`, code);
  return row;
}

// =====================================================================
// Academic years and terms
// =====================================================================

const termOut = (t) => ({ id: t.id, name: t.name, sequenceNo: t.sequence_no, startDate: t.start_date, endDate: t.end_date, examCount: t.exam_count ?? 0 });

export async function listYears(auth, { branchId }) {
  const branch = await branchOf(auth, branchId);
  const [years, terms] = await Promise.all([repo.listYears(pool, branch.branchId), repo.listTerms(pool, branch.branchId)]);
  const latest = years[0];
  return {
    data: years.map((y) => ({
      id: y.id,
      name: y.name,
      startDate: y.start_date,
      endDate: y.end_date,
      isCurrent: y.is_current,
      sectionCount: y.section_count,
      studentCount: y.student_count,
      terms: terms.filter((t) => t.academic_year_id === y.id).map(termOut),
    })),
    meta: {
      branchId: branch.branchId,
      suggestedNext: nextAcademicYear(latest ? { startDate: latest.start_date, endDate: latest.end_date } : null),
    },
  };
}

export async function createYear(auth, { branchId }, input) {
  const branch = await branchOf(auth, branchId);
  const name = input.name ?? yearName(input.startDate, input.endDate);
  const result = await friendly(() => withTransaction(async (db) => {
    await repo.lockBranchYears(db, branch.branchId);
    let from = null;
    if (input.copyFromYearId) {
      from = own(auth, await repo.getYear(db, input.copyFromYearId), 'Academic year', 'YEAR_NOT_FOUND');
      if (from.branch_id !== branch.branchId) throw AppError.notFound('Academic year not found', 'YEAR_NOT_FOUND');
    }
    const current = await repo.currentYear(db, branch.branchId);
    const makeCurrent = input.makeCurrent || !current;   // a branch's first year is current
    const id = await repo.insertYear(db, { ...branch, name, startDate: input.startDate, endDate: input.endDate, isCurrent: false });
    if (makeCurrent) await repo.setCurrentYear(db, branch.branchId, id);
    const copied = from
      ? {
          sections: await repo.copySections(db, { ...branch, fromYearId: from.id, toYearId: id }),
          terms: await repo.copyTerms(db, { fromYearId: from.id, toYearId: id }),
        }
      : { sections: 0, terms: 0 };
    return { id, name, isCurrent: makeCurrent, copied };
  }));
  logger.info('Academic year created', { yearId: result.id, name, copied: result.copied, current: result.isCurrent, by: auth.userId });
  return result;
}

export async function updateYear(auth, id, patch) {
  return friendly(() => withTransaction(async (db) => {
    const y = own(auth, await repo.getYear(db, id, { forUpdate: true }), 'Academic year', 'YEAR_NOT_FOUND');
    const start = patch.startDate ?? y.start_date;
    const end = patch.endDate ?? y.end_date;
    if (end <= start) throw AppError.badRequest('Validation failed', { body: { endDate: ['The year must end after it starts'] } }, 'VALIDATION_ERROR');
    const outside = await repo.termsOutside(db, id, start, end);
    if (outside.length) throw unprocessable('TERMS_OUTSIDE_YEAR', `${outside.join(', ')} would fall outside the new dates. Change the term dates first.`);
    await repo.updateYear(db, id, patch);
    return { id, updated: true };
  }));
}

export async function makeCurrentYear(auth, id) {
  return withTransaction(async (db) => {
    const y = own(auth, await repo.getYear(db, id), 'Academic year', 'YEAR_NOT_FOUND');
    await repo.lockBranchYears(db, y.branch_id);
    const before = await repo.currentYear(db, y.branch_id);
    await repo.setCurrentYear(db, y.branch_id, id);
    logger.info('Current academic year changed', { from: before?.id ?? null, to: id, by: auth.userId });
    return { id, isCurrent: true, previous: before ? { id: before.id, name: before.name } : null };
  });
}

export async function deleteYear(auth, id) {
  await withTransaction(async (db) => {
    const y = own(auth, await repo.getYear(db, id, { forUpdate: true }), 'Academic year', 'YEAR_NOT_FOUND');
    if (y.is_current) throw conflict('YEAR_IS_CURRENT', `${y.name} is the current year. Make another year current before deleting it.`);
    const usage = await repo.yearUsage(db, id);
    if (Object.keys(usedBy(usage)).length) throw inUse(`Academic year ${y.name}`, usage);
    await repo.deleteYear(db, id);   // its terms go with it
  });
}

function assertTermInYear(start, end, yearStart, yearEnd) {
  if (start < yearStart || end > yearEnd) {
    throw AppError.badRequest('Validation failed', { body: { startDate: [`The term must lie within the academic year (${yearStart} to ${yearEnd})`] } }, 'VALIDATION_ERROR');
  }
}

export async function createTerm(auth, input) {
  return friendly(() => withTransaction(async (db) => {
    const y = own(auth, await repo.getYear(db, input.academicYearId, { forUpdate: true }), 'Academic year', 'YEAR_NOT_FOUND');
    assertTermInYear(input.startDate, input.endDate, y.start_date, y.end_date);
    const sequenceNo = input.sequenceNo ?? (await repo.nextTermSequence(db, y.id));
    const id = await repo.insertTerm(db, { tenantId: y.tenant_id, branchId: y.branch_id, academicYearId: y.id, name: input.name, sequenceNo, startDate: input.startDate, endDate: input.endDate });
    return { id, name: input.name, sequenceNo, startDate: input.startDate, endDate: input.endDate };
  }));
}

export async function updateTerm(auth, id, patch) {
  return friendly(() => withTransaction(async (db) => {
    const t = own(auth, await repo.getTerm(db, id), 'Term', 'TERM_NOT_FOUND');
    const start = patch.startDate ?? t.start_date;
    const end = patch.endDate ?? t.end_date;
    if (end <= start) throw AppError.badRequest('Validation failed', { body: { endDate: ['The term must end after it starts'] } }, 'VALIDATION_ERROR');
    assertTermInYear(start, end, t.year_start, t.year_end);
    await repo.updateTerm(db, id, patch);
    return { id, updated: true };
  }));
}

export async function deleteTerm(auth, id) {
  await withTransaction(async (db) => {
    const t = own(auth, await repo.getTerm(db, id), 'Term', 'TERM_NOT_FOUND');
    const usage = await repo.termUsage(db, id);
    if (Object.keys(usedBy(usage)).length) throw inUse(t.name, usage);
    await repo.deleteTerm(db, id);
  });
}

// =====================================================================
// Classes and sections
// =====================================================================

export async function listClasses(auth, { branchId, yearId }) {
  const branch = await branchOf(auth, branchId);
  let year = null;
  if (yearId) {
    year = own(auth, await repo.getYear(pool, yearId), 'Academic year', 'YEAR_NOT_FOUND');
    if (year.branch_id !== branch.branchId) throw AppError.notFound('Academic year not found', 'YEAR_NOT_FOUND');
  } else {
    year = await repo.currentYear(pool, branch.branchId);
  }
  const [classes, sections, staff] = await Promise.all([
    repo.listClasses(pool, branch.branchId),
    year ? repo.listSectionsOfYear(pool, branch.branchId, year.id) : [],
    repo.listStaffChoices(pool, branch.branchId),
  ]);
  return {
    data: classes.map((c) => {
      const mine = sections.filter((s) => s.class_id === c.id);
      return {
        id: c.id,
        name: c.name,
        code: c.code,
        numericLevel: c.numeric_level,
        displayOrder: c.display_order,
        status: c.status,
        studentCount: mine.reduce((n, s) => n + s.student_count, 0),
        sections: mine.map((s) => ({
          id: s.id,
          name: s.name,
          capacity: s.capacity,
          roomNumber: s.room_number,
          studentCount: s.student_count,
          classTeacher: s.class_teacher_id ? { staffId: s.class_teacher_id, name: s.class_teacher_name } : null,
        })),
      };
    }),
    meta: {
      branchId: branch.branchId,
      academicYear: year ? { id: year.id, name: year.name } : null,
      staff: staff.map((s) => ({ staffId: s.staff_id, name: s.name, designation: s.designation, role: s.role })),
    },
  };
}

export async function createClass(auth, { branchId }, input) {
  const branch = await branchOf(auth, branchId);
  return friendly(async () => {
    const displayOrder = input.displayOrder ?? (await repo.nextClassOrder(pool, branch.branchId));
    const id = await repo.insertClass(pool, { ...branch, ...input, displayOrder });
    return { id, name: input.name, displayOrder };
  });
}

export async function updateClass(auth, id, patch) {
  return friendly(() => withTransaction(async (db) => {
    const c = own(auth, await repo.getClass(db, id), 'Class', 'CLASS_NOT_FOUND');
    if (patch.status === 'inactive' && c.status !== 'inactive') {
      const n = await repo.activeStudentsInClass(db, id);
      if (n > 0) throw conflict('CLASS_HAS_STUDENTS', `${c.name} has ${n} current student${n === 1 ? '' : 's'}. Move them to another class before deactivating it.`, { students: n });
    }
    await repo.updateClass(db, id, patch);
    return { id, updated: true };
  }));
}

export async function deleteClass(auth, id) {
  await withTransaction(async (db) => {
    const c = own(auth, await repo.getClass(db, id), 'Class', 'CLASS_NOT_FOUND');
    const usage = await repo.classUsage(db, id);
    if (Object.keys(usedBy(usage)).length) throw inUse(c.name, usage, 'Deactivate it instead to hide it from new admissions.');
    await repo.deleteClass(db, id);   // its (unused) sections go with it
  });
  logger.info('Class deleted', { classId: id, by: auth.userId });
}

/** "a" -> "A"; longer names ("Rose", "Science") are kept as typed. */
const sectionName = (name) => (name.length <= 2 ? name.toUpperCase() : name);

async function checkClassTeacher(db, staffId, branchId) {
  if (!staffId) return;
  const staff = await repo.getStaffInBranch(db, staffId, branchId);
  if (!staff) throw unprocessable('STAFF_NOT_FOUND', 'Choose an active teacher of this branch as class teacher');
}

export async function createSection(auth, input) {
  return friendly(() => withTransaction(async (db) => {
    const c = own(auth, await repo.getClass(db, input.classId), 'Class', 'CLASS_NOT_FOUND');
    if (c.status !== 'active') throw unprocessable('CLASS_INACTIVE', `${c.name} is inactive. Activate it before adding sections.`);
    let yearId = input.academicYearId;
    if (yearId) {
      const y = await repo.getYear(db, yearId);
      if (!y || y.branch_id !== c.branch_id) throw AppError.notFound('Academic year not found', 'YEAR_NOT_FOUND');
    } else {
      const current = await repo.currentYear(db, c.branch_id);
      if (!current) throw unprocessable('NO_CURRENT_YEAR', 'Create an academic year first');
      yearId = current.id;
    }
    await checkClassTeacher(db, input.classTeacherStaffId, c.branch_id);
    const name = sectionName(input.name);
    const id = await repo.insertSection(db, { tenantId: c.tenant_id, branchId: c.branch_id, academicYearId: yearId, classId: c.id, ...input, name });
    return { id, name, label: `${c.name} ${name}` };
  }));
}

export async function updateSection(auth, id, patch) {
  return friendly(() => withTransaction(async (db) => {
    const s = own(auth, await repo.getSection(db, id), 'Section', 'SECTION_NOT_FOUND');
    if (patch.capacity && patch.capacity < s.student_count) {
      throw unprocessable('CAPACITY_TOO_LOW', `${s.class_name} ${s.name} already has ${s.student_count} students; the capacity can't be lower.`);
    }
    if (patch.classTeacherStaffId !== undefined) await checkClassTeacher(db, patch.classTeacherStaffId, s.branch_id);
    const name = patch.name === undefined ? undefined : sectionName(patch.name);
    await repo.updateSection(db, id, { ...patch, name });
    return { id, updated: true };
  }));
}

export async function deleteSection(auth, id) {
  await withTransaction(async (db) => {
    const s = own(auth, await repo.getSection(db, id), 'Section', 'SECTION_NOT_FOUND');
    const usage = await repo.sectionUsage(db, id);
    if (Object.keys(usedBy(usage)).length) throw inUse(`${s.class_name} ${s.name}`, usage);
    await repo.deleteSection(db, id);
  });
}

// =====================================================================
// Subjects
// =====================================================================

export async function listSubjects(auth, { branchId }) {
  const branch = await branchOf(auth, branchId);
  const rows = await repo.listSubjects(pool, branch.branchId);
  return {
    data: rows.map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      subjectType: s.subject_type,
      isGradedOnly: s.is_graded_only,
      displayOrder: s.display_order,
      status: s.status,
      teacherAssignments: s.assignment_count,
      examPapers: s.paper_count,
    })),
    meta: { branchId: branch.branchId },
  };
}

export async function createSubject(auth, { branchId }, input) {
  const branch = await branchOf(auth, branchId);
  if (await repo.subjectNameTaken(pool, branch.branchId, input.name)) throw conflict('DUPLICATE', `A subject named ${input.name} already exists`);
  return friendly(async () => {
    const displayOrder = input.displayOrder ?? (await repo.nextSubjectOrder(pool, branch.branchId));
    const id = await repo.insertSubject(pool, { ...branch, ...input, displayOrder });
    return { id, name: input.name, code: input.code, displayOrder };
  });
}

export async function updateSubject(auth, id, patch) {
  return friendly(() => withTransaction(async (db) => {
    const s = own(auth, await repo.getSubject(db, id), 'Subject', 'SUBJECT_NOT_FOUND');
    if (patch.name && (await repo.subjectNameTaken(db, s.branch_id, patch.name, id))) throw conflict('DUPLICATE', `A subject named ${patch.name} already exists`);
    await repo.updateSubject(db, id, patch);
    return { id, updated: true };
  }));
}

export async function deleteSubject(auth, id) {
  await withTransaction(async (db) => {
    const s = own(auth, await repo.getSubject(db, id), 'Subject', 'SUBJECT_NOT_FOUND');
    const usage = await repo.subjectUsage(db, id);
    if (Object.keys(usedBy(usage)).length) throw inUse(s.name, usage, 'Mark it inactive instead.');
    await repo.deleteSubject(db, id);
  });
}

// =====================================================================
// School profile + logo
// =====================================================================

function profileOut(p, auth) {
  const docs = p.documents ?? {};
  return {
    branchId: p.branch_id,
    schoolName: p.school_name,
    branchName: p.branch_name,
    branchCode: p.branch_code,
    address: { line1: p.address_line1, line2: p.address_line2, city: p.city, state: p.state, pincode: p.postal_code },
    phone: p.phone,
    email: p.email,
    // Columns win; settings.documents is where these lived before migration 011.
    website: p.website ?? docs.website ?? null,
    affiliationNo: p.affiliation_no,
    schoolCode: p.school_code,
    udiseCode: p.udise_code,
    principalName: p.principal_name ?? docs.principalName ?? null,
    board: p.board ?? docs.board ?? null,
    establishedYear: p.established_year,
    mediumOfInstruction: p.medium_of_instruction,
    logo: p.logo_updated_at ? { url: `/settings/school/logo?branchId=${p.branch_id}`, updatedAt: p.logo_updated_at } : null,
    canEditSchoolName: auth.role === ROLES.SUPER_ADMIN,
    updatedAt: p.updated_at,
  };
}

async function loadProfile(auth, branchId) {
  const branch = await branchOf(auth, branchId);
  const p = await repo.getSchoolProfile(pool, branch.branchId);
  if (!p) throw AppError.notFound('Branch not found', 'BRANCH_NOT_FOUND');
  return { branch, p };
}

export async function getSchoolProfile(auth, { branchId }) {
  const { p } = await loadProfile(auth, branchId);
  return profileOut(p, auth);
}

export async function updateSchoolProfile(auth, { branchId }, input) {
  const { branch, p } = await loadProfile(auth, branchId);
  if (input.schoolName !== undefined && input.schoolName !== p.school_name && auth.role !== ROLES.SUPER_ADMIN) {
    throw AppError.forbidden('Only the school owner can change the school name', 'INSUFFICIENT_ROLE');
  }
  await withTransaction(async (db) => {
    await repo.updateSchoolProfile(db, branch.branchId, {
      ...input,
      address: { ...input.address, line2: input.address.line2 ?? null },
    });
    if (input.schoolName !== undefined && input.schoolName !== p.school_name) await repo.updateTenantName(db, branch.tenantId, input.schoolName);
  });
  logger.info('School profile saved', { branchId: branch.branchId, by: auth.userId });
  return getSchoolProfile(auth, { branchId: branch.branchId });
}

/** PDFKit has to be able to place the picture, else certificates would fail to print later. */
function assertPdfCanUse(buffer) {
  try {
    new PDFDocument({ autoFirstPage: false }).openImage(buffer);
  } catch {
    throw new AppError(415, 'FILE_TYPE_NOT_ALLOWED', 'This picture cannot be printed on certificates. Save it again as a standard PNG or JPG.');
  }
}

export async function putLogo(auth, { branchId }, file) {
  const branch = await branchOf(auth, branchId);
  const check = checkImage(file, { kinds: ['png', 'jpeg'], maxBytes: MAX_LOGO_BYTES, label: 'The logo' });
  if (!check.ok) throw new AppError(check.status, check.code, check.message);
  assertPdfCanUse(file.buffer);
  const sha256 = createHash('sha256').update(file.buffer).digest('hex');
  const updatedAt = await repo.upsertLogo(pool, { ...branch, mime: check.mime, size: file.buffer.length, sha256, data: file.buffer, uploadedBy: auth.userId });
  return { url: `/settings/school/logo?branchId=${branch.branchId}`, updatedAt, mimeType: check.mime, sizeBytes: file.buffer.length };
}

export async function getLogo(auth, { branchId }) {
  // Staff (incl. teachers) of the branch may see the logo; resolveWriteBranch keeps them to their own branch.
  const branch = await branchOf(auth, branchId);
  const logo = await repo.getLogo(pool, branch.branchId);
  if (!logo) throw AppError.notFound('No logo uploaded', 'LOGO_NOT_FOUND');
  return logo;
}

export async function deleteLogo(auth, { branchId }) {
  const branch = await branchOf(auth, branchId);
  if (!(await repo.deleteLogo(pool, branch.branchId))) throw AppError.notFound('No logo uploaded', 'LOGO_NOT_FOUND');
}
