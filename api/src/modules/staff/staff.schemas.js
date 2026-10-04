import { z } from 'zod';
import { isoDate, optionalText, text, uuid } from '../shared/schemas.js';

export const listQuery = z
  .object({
    role: z.enum(['teacher', 'branch_admin', 'super_admin']).optional(),
    status: z.enum(['active', 'inactive']).optional(),
    subjectId: uuid.optional(),     // teaches this subject (current year)
    classId: uuid.optional(),       // teaches in, or is class teacher of, a section of this class (current year)
    sectionId: uuid.optional(),     // ... of this section
    search: z.string().trim().min(1).max(100).optional(),   // name, email, phone, designation, department, employee code
    branchId: uuid.optional(),
  })
  .strict();

export const createBody = z
  .object({
    firstName: text(1, 100),
    lastName: text(1, 100),
    email: z.string().trim().email().max(150),
    phone: optionalText(20),
    designation: text(1, 100),
    department: optionalText(100),
    employeeCode: z.string().trim().regex(/^[A-Za-z0-9/_-]{1,30}$/, 'Employee code: up to 30 letters, digits, / _ or -').optional(),
    dateOfJoining: isoDate.optional(),
    role: z.enum(['teacher', 'branch_admin']),
    password: z.string().min(10).max(128),
    branchId: uuid.optional(),            // super_admin only; default = head office
  })
  .strict();

export const updateBody = z
  .object({
    designation: text(1, 100).optional(),
    department: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(100).nullable()).optional(),
    phone: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(20).nullable()).optional(),
    status: z.enum(['active', 'inactive']).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update');
