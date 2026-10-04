import { z } from 'zod';
import { isoDate, text, uuid } from '../shared/schemas.js';
import { INDIAN_STATES, PINCODE_RE } from './profile.helpers.js';

const blankToNull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v);
const nullableText = (max) => z.preprocess(blankToNull, z.string().trim().max(max).nullable());

/** Every setup endpoint works on one branch: the caller's, or ?branchId= for the owner. */
export const branchQuery = z.object({ branchId: uuid.optional() }).strict();
export const idParams = z.object({ id: uuid }).strict();

// ===================================================================== years + terms

const yearName = z.string().trim().regex(/^\d{4}(-\d{2,4})?$/, 'Use a name like 2027-28');

export const createYearBody = z
  .object({
    name: yearName.optional(),                  // default: "2027-28" from the dates
    startDate: isoDate,
    endDate: isoDate,
    // Copy sections (with class teachers) and terms from this year; null = start empty.
    copyFromYearId: uuid.nullable().optional(),
    makeCurrent: z.boolean().default(false),
  })
  .strict()
  .refine((b) => b.endDate > b.startDate, { message: 'The year must end after it starts', path: ['endDate'] })
  .refine((b) => daysBetween(b.startDate, b.endDate) <= 550, { message: 'An academic year can be at most 18 months long', path: ['endDate'] });

export const updateYearBody = z
  .object({ name: yearName.optional(), startDate: isoDate.optional(), endDate: isoDate.optional() })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update');

export const createTermBody = z
  .object({
    academicYearId: uuid,
    name: text(1, 50),
    sequenceNo: z.number().int().min(1).max(12).optional(),
    startDate: isoDate,
    endDate: isoDate,
  })
  .strict()
  .refine((b) => b.endDate > b.startDate, { message: 'The term must end after it starts', path: ['endDate'] });

export const updateTermBody = z
  .object({
    name: text(1, 50).optional(),
    sequenceNo: z.number().int().min(1).max(12).optional(),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update');

// ===================================================================== classes + sections

const classCode = z.preprocess(blankToNull, z.string().trim().regex(/^[A-Za-z0-9-]{1,20}$/, 'Code: up to 20 letters, digits or -').nullable());
// LKG = -1, UKG = 0, Nursery = -2 ... Class 12 = 12
const numericLevel = z.number().int().min(-3).max(12).nullable();

export const classesQuery = z.object({ branchId: uuid.optional(), yearId: uuid.optional() }).strict();

export const createClassBody = z
  .object({
    name: text(1, 50),
    code: classCode.optional(),
    numericLevel: numericLevel.optional(),
    displayOrder: z.number().int().min(0).max(999).optional(),
  })
  .strict();

export const updateClassBody = z
  .object({
    name: text(1, 50).optional(),
    code: classCode.optional(),
    numericLevel: numericLevel.optional(),
    displayOrder: z.number().int().min(0).max(999).optional(),
    status: z.enum(['active', 'inactive']).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update');

const sectionName = z.string().trim().min(1).max(20);
const capacity = z.number().int().min(1).max(200).nullable();
const room = nullableText(20);

export const createSectionBody = z
  .object({
    classId: uuid,
    academicYearId: uuid.optional(),             // default: the current year
    name: sectionName,
    capacity: capacity.optional(),
    roomNumber: room.optional(),
    classTeacherStaffId: uuid.nullable().optional(),
  })
  .strict();

export const updateSectionBody = z
  .object({
    name: sectionName.optional(),
    capacity: capacity.optional(),
    roomNumber: room.optional(),
    classTeacherStaffId: uuid.nullable().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update');

// ===================================================================== subjects

const subjectCode = z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,20}$/, 'Code: up to 20 letters, digits or -');
const subjectType = z.enum(['theory', 'practical', 'both', 'activity']);

export const createSubjectBody = z
  .object({
    name: text(1, 100),
    code: subjectCode,
    subjectType: subjectType.default('theory'),
    isGradedOnly: z.boolean().default(false),
    displayOrder: z.number().int().min(0).max(999).optional(),
  })
  .strict();

export const updateSubjectBody = z
  .object({
    name: text(1, 100).optional(),
    code: subjectCode.optional(),
    subjectType: subjectType.optional(),
    isGradedOnly: z.boolean().optional(),
    displayOrder: z.number().int().min(0).max(999).optional(),
    status: z.enum(['active', 'inactive']).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update');

// ===================================================================== school profile

const thisYear = new Date().getFullYear();

export const schoolProfileBody = z
  .object({
    schoolName: text(2, 150).optional(),         // the tenant's name: owner only
    branchName: text(2, 150),
    address: z
      .object({
        line1: text(1, 255),
        line2: nullableText(255).optional(),
        city: text(1, 100),
        state: z.enum(INDIAN_STATES, { errorMap: () => ({ message: 'Choose a state or union territory' }) }),
        pincode: z.string().trim().regex(PINCODE_RE, 'PIN code is 6 digits'),
      })
      .strict(),
    phone: z.preprocess(blankToNull, z.string().trim().regex(/^[+\d][\d\s-]{6,18}$/, 'Enter a valid phone number').nullable()),
    email: z.preprocess(blankToNull, z.string().trim().toLowerCase().email('Enter a valid email').max(150).nullable()),
    website: z.preprocess(blankToNull, z.string().trim().max(150).regex(/^(https?:\/\/)?[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(\/\S*)?$/, 'Enter a website like www.school.edu.in').nullable()),
    affiliationNo: nullableText(50),
    schoolCode: nullableText(20),
    udiseCode: z.preprocess(blankToNull, z.string().trim().regex(/^\d{11}$/, 'UDISE+ code is 11 digits').nullable()),
    principalName: nullableText(150),
    board: nullableText(60),
    establishedYear: z.number().int().min(1800, 'Enter a year after 1800').max(thisYear, 'The year cannot be in the future').nullable(),
    mediumOfInstruction: nullableText(30),
  })
  .strict();

// ===================================================================== my account

export const updateMeBody = z
  .object({
    firstName: text(1, 100).optional(),
    lastName: nullableText(100).optional(),
    phone: z.preprocess(blankToNull, z.string().trim().min(10).max(20).nullable()).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update');

export const changePasswordBody = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password').max(128),
    newPassword: z.string().min(10, 'Use at least 10 characters').max(72, 'Use at most 72 characters'),
    client: z.enum(['web', 'mobile']).default('web'),
  })
  .strict();

function daysBetween(a, b) {
  return (Date.parse(b) - Date.parse(a)) / 86_400_000;
}
