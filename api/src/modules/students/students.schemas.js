import { z } from 'zod';
import { isoDate, optionalText, page, limit, text, uuid } from '../shared/schemas.js';

export const SOCIAL_CATEGORIES = ['General', 'SC', 'ST', 'OBC', 'EWS'];

export const listQuery = z
  .object({
    search: z.string().trim().min(1).max(100).optional(),
    classId: uuid.optional(),
    sectionId: uuid.optional(),
    branchId: uuid.optional(),
    status: z.enum(['active', 'left', 'all']).default('active'),
    page,
    limit: limit(25, 100),
    sort: z.enum(['name', 'admission', 'class']).default('name'),
  })
  .strict();

const phone = z.string().trim().min(10).max(20);
const roll = z.string().trim().regex(/^[A-Za-z0-9-]{1,20}$/, 'Roll number: up to 20 letters, digits or -');

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
    fatherName: optionalText(150),
    motherName: optionalText(150),
    socialCategory: z.enum(SOCIAL_CATEGORIES).optional(),
    parent: z
      .object({
        name: text(2, 150),
        phone,
        email: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().email().max(150).optional()),
      })
      .strict(),
    applyFeeStructure: z.boolean().default(true),
  })
  .strict()
  .refine((b) => !b.admissionDate || b.dateOfBirth < b.admissionDate, { message: 'Date of birth must be before the admission date', path: ['dateOfBirth'] });

const nullableText = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable());

export const updateBody = z
  .object({
    firstName: text(1, 100).optional(),
    lastName: nullableText(100).optional(),
    gender: z.enum(['male', 'female', 'other']).optional(),
    dateOfBirth: isoDate.optional(),
    sectionId: uuid.optional(),
    rollNumber: roll.optional(),
    fatherName: nullableText(150).optional(),
    motherName: nullableText(150).optional(),
    guardianName: nullableText(150).optional(),
    socialCategory: z.enum(SOCIAL_CATEGORIES).nullable().optional(),
    penNumber: z.preprocess((v) => (v === '' ? null : v), z.string().trim().regex(/^[A-Za-z0-9]{1,20}$/, 'Invalid PEN').nullable()).optional(),
    apaarId: z.preprocess((v) => (v === '' ? null : v), z.string().trim().regex(/^\d{12}$/, 'APAAR ID is 12 digits').nullable()).optional(),
    parentPhone: phone.optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update');
