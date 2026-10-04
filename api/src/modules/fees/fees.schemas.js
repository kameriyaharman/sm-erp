import { z } from 'zod';

const uuid = z.string().uuid();

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date');

/**
 * Money arrives as a number or numeric string in rupees with at most 2 decimals,
 * and is converted to integer paise so no arithmetic ever touches floats.
 */
const rupees = z
  .union([z.number(), z.string().trim().regex(/^\d+(\.\d{1,2})?$/, 'Invalid amount')])
  .transform((value, ctx) => {
    const paise = Math.round(Number(value) * 100);
    if (!Number.isFinite(paise) || Math.abs(Number(value) * 100 - paise) > 1e-6) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Amount can have at most 2 decimal places' });
      return z.NEVER;
    }
    return paise;
  });

const positiveRupees = rupees.refine((paise) => paise > 0, 'Amount must be greater than 0');
const nonNegativeRupees = rupees.refine((paise) => paise >= 0, 'Amount cannot be negative');

// ---------------------------------------------------------------- list / dues

export const listStudentFeesQuery = z
  .object({
    tenantId: uuid.optional(),
    branchId: uuid.optional(),
    academicYearId: uuid.optional(),       // default: each branch's current year
    classId: uuid.optional(),
    sectionId: uuid.optional(),
    search: z.string().trim().min(1).max(100).optional(),
    status: z.enum(['all', 'pending', 'overdue', 'paid']).default('all'),
    sort: z.enum(['pending', 'name', 'admission']).default('pending'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const studentParams = z.object({ studentId: uuid }).strict();
export const invoiceParams = z.object({ invoiceId: uuid }).strict();

// ---------------------------------------------------------------- invoices

export const createInvoiceBody = z
  .object({
    studentId: uuid,
    academicYearId: uuid.optional(),        // default: the student's current year
    // Bill these specific allocations. Omit to bill every unbilled allocation
    // due on or before `billUpTo` (or all of them when billUpTo is omitted).
    allocationIds: z.array(uuid).min(1).max(100).optional(),
    billUpTo: isoDate.optional(),
    // Extra one-off lines (lab breakage, lost ID card, ...)
    items: z
      .array(
        z
          .object({
            feeHeadId: uuid,
            description: z.string().trim().max(255).optional(),
            amount: positiveRupees,
            concessionAmount: nonNegativeRupees.default(0),
          })
          .strict()
          .refine((item) => item.concessionAmount <= item.amount, {
            message: 'Concession cannot exceed the amount',
            path: ['concessionAmount'],
          }),
      )
      .max(50)
      .default([]),
    dueDate: isoDate.optional(),            // default: earliest due date among billed allocations
    periodLabel: z.string().trim().max(50).optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine((body) => !(body.allocationIds && body.billUpTo), {
    message: 'Pass either allocationIds or billUpTo, not both',
    path: ['billUpTo'],
  });

// ---------------------------------------------------------------- payments

const OFFLINE_INSTRUMENTS = ['cheque', 'demand_draft'];

export const collectPaymentBody = z
  .object({
    studentId: uuid,
    amount: positiveRupees,
    paymentMode: z.enum(['cash', 'upi', 'card', 'bank_transfer', 'cheque', 'demand_draft']),
    // Settle these invoices (oldest due first). Omit to settle the student's open invoices oldest first.
    invoiceIds: z.array(uuid).min(1).max(50).optional(),
    instrumentNumber: z.string().trim().min(1).max(50).optional(),
    instrumentDate: isoDate.optional(),
    bankName: z.string().trim().max(100).optional(),
    remarks: z.string().trim().max(255).optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (OFFLINE_INSTRUMENTS.includes(body.paymentMode)) {
      if (!body.instrumentNumber) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['instrumentNumber'], message: 'Cheque/DD number is required' });
      }
      if (!body.bankName) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['bankName'], message: 'Bank name is required' });
      }
    }
  });

export const idempotencyHeaders = z
  .object({
    'idempotency-key': z
      .string({ required_error: 'Idempotency-Key header is required' })
      .regex(/^[A-Za-z0-9_-]{8,100}$/, 'Idempotency-Key must be 8–100 characters of A–Z, a–z, 0–9, _ or -'),
  })
  .passthrough();

// ---------------------------------------------------------------- analytics

export const analyticsQuery = z
  .object({
    tenantId: uuid.optional(),
    branchId: uuid.optional(),
    academicYearId: uuid.optional(),
  })
  .strict();

// ---------------------------------------------------------------- one-off charges

/**
 * POST /fees/charges: bill a one-off amount to one student or to a class / section
 * (one invoice per student). batchId makes the request idempotent; dryRun previews it.
 */
export const chargeBody = z
  .object({
    scope: z.union([
      z.object({ studentId: uuid }).strict(),
      z.object({ classId: uuid, sectionId: uuid.optional() }).strict(),
    ]),
    feeHeadId: uuid,
    description: z.string().trim().min(2, 'Describe the charge (e.g. Annual picnic)').max(255),
    amount: positiveRupees,
    dueDate: isoDate,
    batchId: uuid.optional(),            // required to bill; the same batchId never bills a student twice
    dryRun: z.boolean().default(false),  // preview: students, total, already charged
  })
  .strict()
  .refine((b) => b.dryRun || b.batchId, { message: 'batchId is required', path: ['batchId'] });
