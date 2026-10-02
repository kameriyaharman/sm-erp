import { z } from 'zod';

/** Zod building blocks shared by the school-operations modules. */

export const uuid = z.string().uuid();

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date');

export const isoMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM');

export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM (24 h)');

export const text = (min, max) => z.string().trim().min(min).max(max);

/** Optional free text: "" becomes undefined. */
export const optionalText = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(max).optional());

export const page = z.coerce.number().int().min(1).default(1);
export const limit = (def = 25, max = 100) => z.coerce.number().int().min(1).max(max).default(def);

/**
 * Rupees as a number or numeric string, at most 2 decimals, converted to integer paise
 * (same rule as the fees module).
 */
export const rupees = z
  .union([z.number(), z.string().trim().regex(/^\d+(\.\d{1,2})?$/, 'Invalid amount')])
  .transform((value, ctx) => {
    const paise = Math.round(Number(value) * 100);
    if (!Number.isFinite(paise) || Math.abs(Number(value) * 100 - paise) > 1e-6) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Amount can have at most 2 decimal places' });
      return z.NEVER;
    }
    return paise;
  });

export const idParams = z.object({ id: uuid }).strict();
export const studentParams = z.object({ studentId: uuid }).strict();
