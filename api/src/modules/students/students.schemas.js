import { z } from 'zod';
import { isoDate, optionalText, page, limit, text, uuid } from '../shared/schemas.js';
import { BLOOD_GROUPS, INDIAN_STATES, PINCODE_RE, aadhaarError, cleanAadhaar } from '../setup/profile.helpers.js';

export const SOCIAL_CATEGORIES = ['General', 'SC', 'ST', 'OBC', 'EWS'];
export const RELIGIONS = ['Hindu', 'Muslim', 'Christian', 'Sikh', 'Buddhist', 'Jain', 'Parsi', 'Jewish', 'Other', 'Prefer not to say'];
export const GUARDIAN_RELATIONS = ['Father', 'Mother', 'Grandfather', 'Grandmother', 'Uncle', 'Aunt', 'Brother', 'Sister', 'Other'];

export const listQuery = z
  .object({
    search: z.string().trim().min(1).max(100).optional(),
    classId: uuid.optional(),
    sectionId: uuid.optional(),
    branchId: uuid.optional(),
    status: z.enum(['active', 'left', 'all']).default('active'),
    gender: z.enum(['male', 'female', 'other']).optional(),
    transport: z.enum(['yes', 'no']).optional(),      // uses school transport (has a route) or not
    page,
    limit: limit(25, 100),
    sort: z.enum(['name', 'admission', 'class']).default('name'),
  })
  .strict();

const blankToNull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v);
const phone = z.string().trim().min(10).max(20);
const roll = z.string().trim().regex(/^[A-Za-z0-9-]{1,20}$/, 'Roll number: up to 20 letters, digits or -');

/** Optional text that may be cleared: "" / null -> null, absent -> undefined. */
const nullableText = (max) => z.preprocess(blankToNull, z.string().trim().max(max).nullable()).optional();
const nullablePhone = z.preprocess(blankToNull, phone.nullable()).optional();
const nullableEmail = z.preprocess(blankToNull, z.string().trim().toLowerCase().email('Enter a valid email').max(150).nullable()).optional();
const nullableEnum = (values) => z.preprocess(blankToNull, z.enum(values).nullable()).optional();
const nullableDate = z.preprocess(blankToNull, isoDate.nullable()).optional();

const aadhaar = z.preprocess(
  (v) => (v === null || v === undefined ? v : cleanAadhaar(v)),
  z.string().nullable().superRefine((v, ctx) => {
    const problem = v === null ? null : aadhaarError(v);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  }),
).optional();

/** Full postal address; `null` clears it. */
export const address = z
  .object({
    line1: text(1, 200),
    line2: optionalText(200),
    city: text(1, 100),
    state: z.enum(INDIAN_STATES, { errorMap: () => ({ message: 'Choose a state or union territory' }) }),
    pincode: z.string().trim().regex(PINCODE_RE, 'PIN code is 6 digits'),
  })
  .strict();

const parentInfo = z
  .object({ name: nullableText(150), phone: nullablePhone, email: nullableEmail, occupation: nullableText(100) })
  .strict();

const guardianInfo = z
  .object({ name: nullableText(150), relation: nullableEnum(GUARDIAN_RELATIONS), phone: nullablePhone })
  .strict();

const emergencyInfo = z
  .object({ name: nullableText(150), relation: nullableText(30), phone: nullablePhone })
  .strict();

const previousSchoolInfo = z
  .object({
    name: nullableText(255),
    board: nullableText(50),
    lastClassPassed: nullableText(30),
    tcNumber: nullableText(40),
    tcDate: nullableDate,
  })
  .strict();

const medicalInfo = z.object({ allergies: nullableText(255), notes: nullableText(1000) }).strict();

/** The profile fields shared by admission (POST) and edit (PATCH). */
const profileFields = {
  bloodGroup: nullableEnum(BLOOD_GROUPS),
  aadhaarNumber: aadhaar,
  religion: nullableEnum(RELIGIONS),
  motherTongue: nullableText(50),
  nationality: nullableText(50),
  house: nullableText(30),
  identificationMarks: nullableText(255),
  address: address.nullable().optional(),
  father: parentInfo.optional(),
  mother: parentInfo.optional(),
  guardian: guardianInfo.optional(),
  emergencyContact: emergencyInfo.optional(),
  previousSchool: previousSchoolInfo.optional(),
  medical: medicalInfo.optional(),
};

export const createBody = z
  .object({
    firstName: text(1, 100),
    lastName: optionalText(100),
    gender: z.enum(['male', 'female', 'other']),
    dateOfBirth: isoDate,
    classId: uuid,
    sectionId: uuid,
    rollNumber: roll.optional(),
    admissionNumber: z.string().trim().regex(/^[A-Za-z0-9/_-]{1,30}$/, 'Admission number: up to 30 letters, digits, / _ or -').optional(),
    admissionDate: isoDate.optional(),
    // Kept for older clients; `father.name` / `mother.name` win when both are sent.
    fatherName: optionalText(150),
    motherName: optionalText(150),
    socialCategory: z.enum(SOCIAL_CATEGORIES).optional(),
    penNumber: z.preprocess(blankToNull, z.string().trim().regex(/^[A-Za-z0-9]{1,20}$/, 'Invalid PEN').nullable()).optional(),
    apaarId: z.preprocess(blankToNull, z.string().trim().regex(/^\d{12}$/, 'APAAR ID is 12 digits').nullable()).optional(),
    // The primary contact: gets the parent login account and the school's SMS.
    parent: z
      .object({
        name: text(2, 150),
        phone,
        email: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().email().max(150).optional()),
      })
      .strict(),
    applyFeeStructure: z.boolean().default(true),
    ...profileFields,
  })
  .strict()
  .refine((b) => !b.admissionDate || b.dateOfBirth < b.admissionDate, { message: 'Date of birth must be before the admission date', path: ['dateOfBirth'] });

export const updateBody = z
  .object({
    firstName: text(1, 100).optional(),
    lastName: nullableText(100),
    gender: z.enum(['male', 'female', 'other']).optional(),
    dateOfBirth: isoDate.optional(),
    // Another class of the same academic year needs a section of that class.
    classId: uuid.optional(),
    sectionId: uuid.optional(),
    rollNumber: roll.optional(),
    admissionDate: isoDate.optional(),
    fatherName: nullableText(150),
    motherName: nullableText(150),
    guardianName: nullableText(150),
    socialCategory: z.enum(SOCIAL_CATEGORIES).nullable().optional(),
    penNumber: z.preprocess(blankToNull, z.string().trim().regex(/^[A-Za-z0-9]{1,20}$/, 'Invalid PEN').nullable()).optional(),
    apaarId: z.preprocess(blankToNull, z.string().trim().regex(/^\d{12}$/, 'APAAR ID is 12 digits').nullable()).optional(),
    parentPhone: phone.optional(),
    ...profileFields,
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update')
  .refine((b) => !b.classId || b.sectionId, { message: 'Choose a section of the new class', path: ['sectionId'] });
