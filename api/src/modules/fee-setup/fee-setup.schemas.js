import { z } from 'zod';
import { isoDate, optionalText, rupees, text, uuid } from '../shared/schemas.js';
import { FREQUENCIES } from './schedule.helpers.js';

const MAX_PAISE = 99_999_999_999;
const amount = rupees.refine((p) => p >= 0, 'Amount cannot be negative').refine((p) => p <= MAX_PAISE, 'Amount is too large');
const RECURRING = ['monthly', 'quarterly', 'half_yearly', 'annual'];

// ---------------------------------------------------------------- fee heads

const code = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .transform((v) => v.toUpperCase())
  .refine((v) => /^[A-Z0-9][A-Z0-9_-]*$/.test(v), 'Use letters, digits, - or _ (e.g. TUI, ANNUAL-CHG)');

export const branchQuery = z.object({ branchId: uuid.optional() }).strict();

export const createHeadBody = z
  .object({
    name: text(2, 100),
    code,
    type: z.enum(['recurring', 'one_time']),
    defaultFrequency: z.enum(RECURRING).optional(),     // recurring only; default quarterly
    refundable: z.boolean().default(false),
    optional: z.boolean().default(false),               // e.g. transport: not every student pays it
    description: optionalText(500),
    displayOrder: z.coerce.number().int().min(0).max(999).optional(),
    branchId: uuid.optional(),
  })
  .strict()
  .refine((b) => !(b.type === 'one_time' && b.defaultFrequency), { message: 'A one-time fee has no frequency', path: ['defaultFrequency'] });

export const updateHeadBody = z
  .object({
    name: text(2, 100).optional(),
    code: code.optional(),
    type: z.enum(['recurring', 'one_time']).optional(),
    defaultFrequency: z.enum(RECURRING).optional(),
    refundable: z.boolean().optional(),
    optional: z.boolean().optional(),
    description: z.union([optionalText(500), z.null()]),
    displayOrder: z.coerce.number().int().min(0).max(999).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: 'Nothing to change' })
  .refine((b) => !(b.type === 'one_time' && b.defaultFrequency), { message: 'A one-time fee has no frequency', path: ['defaultFrequency'] });

// ---------------------------------------------------------------- structure

export const structureQuery = z
  .object({ classId: uuid, academicYearId: uuid.optional() })
  .strict();

export const overviewQuery = z
  .object({ academicYearId: uuid.optional(), branchId: uuid.optional() })
  .strict();

const structureRow = z
  .object({
    feeHeadId: uuid,
    frequency: z.enum(FREQUENCIES),
    installmentNo: z.coerce.number().int().min(1).max(12),
    label: optionalText(50),
    amount,
    dueDate: isoDate,
  })
  .strict();

export const saveStructureBody = z
  .object({
    classId: uuid,
    academicYearId: uuid.optional(),
    rows: z.array(structureRow).max(300),
    // true: run everything, report the impact, change nothing (for the "this will update N students" prompt)
    dryRun: z.boolean().default(false),
  })
  .strict();

export const copyStructureBody = z
  .object({
    fromClassId: uuid,
    fromAcademicYearId: uuid.optional(),
    toClassId: uuid,
    toAcademicYearId: uuid.optional(),
    overwrite: z.boolean().default(false),
  })
  .strict();

export const scheduleQuery = z
  .object({
    frequency: z.enum(FREQUENCIES),
    amount: amount.optional(),            // per instalment
    total: amount.optional(),             // for the year, split exactly
    dueDay: z.coerce.number().int().min(1).max(31).default(10),
    academicYearId: uuid.optional(),
    branchId: uuid.optional(),
  })
  .strict()
  .refine((q) => (q.amount === undefined) !== (q.total === undefined), { message: 'Pass either amount or total', path: ['amount'] });

export const applyPreviewQuery = z
  .object({ classId: uuid, academicYearId: uuid.optional() })
  .strict();

export const applyBody = z
  .object({
    classId: uuid,
    academicYearId: uuid.optional(),
    studentIds: z.array(uuid).min(1).max(500).optional(),   // default: every enrolled student of the class
  })
  .strict();

// ---------------------------------------------------------------- concessions

const percent = z
  .union([z.number(), z.string().trim().regex(/^\d+(\.\d{1,2})?$/, 'Invalid percentage')])
  .transform(Number)
  .refine((v) => v > 0 && v <= 100, 'Percentage must be more than 0 and at most 100')
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'At most 2 decimals');

const ruleBase = { feeHeadId: uuid.nullable().default(null), reason: text(2, 255) };

export const concessionRule = z.discriminatedUnion('type', [
  z.object({ ...ruleBase, type: z.literal('percentage'), value: percent }).strict(),
  z.object({ ...ruleBase, type: z.literal('flat'), value: rupees.refine((p) => p > 0, 'Amount must be greater than 0').refine((p) => p <= MAX_PAISE, 'Amount is too large') }).strict(),
  z.object({ ...ruleBase, type: z.literal('full_waiver') }).strict(),
]);

export const concessionQuery = z.object({ academicYearId: uuid.optional() }).strict();

export const saveConcessionBody = z
  .object({
    academicYearId: uuid.optional(),
    approvedBy: optionalText(150),          // as on the approval, e.g. "Principal"
    concessions: z.array(concessionRule).max(30),
  })
  .strict()
  .superRefine((b, ctx) => {
    const seen = new Set();
    b.concessions.forEach((c, i) => {
      const key = c.feeHeadId ?? 'all';
      if (seen.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['concessions', i, 'feeHeadId'], message: 'Only one concession per fee head' });
      seen.add(key);
    });
    if (b.concessions.length > 0 && !b.approvedBy) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['approvedBy'], message: 'Who approved this concession?' });
    }
  });
