import { z } from 'zod';
import { isoDate, optionalText, text, uuid } from '../shared/schemas.js';

export const listQuery = z.object({ branchId: uuid.optional() }).strict();

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
