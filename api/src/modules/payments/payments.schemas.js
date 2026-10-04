import { z } from 'zod';

const uuid = z.string().uuid();

/** Optional rupee amount -> integer paise (same rules as the counter). */
const rupees = z
  .union([z.number(), z.string().trim().regex(/^\d+(\.\d{1,2})?$/, 'Invalid amount')])
  .transform((value, ctx) => {
    const paise = Math.round(Number(value) * 100);
    if (!Number.isFinite(paise) || Math.abs(Number(value) * 100 - paise) > 1e-6) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Amount can have at most 2 decimal places' });
      return z.NEVER;
    }
    return paise;
  })
  .refine((paise) => paise > 0, 'Amount must be greater than 0');

export const createOrderBody = z
  .object({
    invoiceIds: z.array(uuid).min(1).max(24).transform((ids) => [...new Set(ids)]),
    // Omit to pay the full balance of the selected invoices; otherwise a part payment, applied oldest due first.
    amount: rupees.optional(),
  })
  .strict();

export const optionalIdempotencyHeaders = z
  .object({
    'idempotency-key': z
      .string()
      .regex(/^[A-Za-z0-9_-]{8,100}$/, 'Idempotency-Key must be 8–100 characters of A–Z, a–z, 0–9, _ or -')
      .optional(),
  })
  .passthrough();

export const orderParams = z.object({ orderId: uuid });
export const receiptParams = z.object({ receiptId: uuid });

// ---------------------------------------------------------------- Settings -> Online payments

const keyId = z
  .string()
  .trim()
  .regex(/^rzp_(test|live)_[A-Za-z0-9]{6,40}$/, 'Key ID looks like rzp_test_XXXXXXXXXXXXXX or rzp_live_XXXXXXXXXXXXXX');

// Pasted secrets: no spaces or control characters (a stray space from copy-paste is trimmed first).
const secret = (min) => z.string().trim().min(min, `At least ${min} characters`).max(128).regex(/^[\x21-\x7E]+$/, 'No spaces or special characters');

export const gatewaySettingsBody = z
  .object({
    // Omit = your level (owner: school-wide; branch admin: own branch). null = school-wide. uuid = that branch's override.
    branchId: uuid.nullable().optional(),
    keyId,
    keySecret: secret(8).optional(),         // write-only; omit to keep the saved one
    webhookSecret: secret(6).optional(),     // write-only; omit to keep the saved one
    enabled: z.boolean().optional(),
    allowPartial: z.boolean().optional(),
    minAmount: rupees.refine((p) => p >= 100 && p <= 10_000_000, 'Between Rs 1 and Rs 1,00,000').optional(),
  })
  .strict();

export const gatewayTargetBody = z.object({ branchId: uuid.nullable().optional() }).strict();
export const gatewayTargetQuery = z.object({ branchId: uuid.optional() }).strict();

// ---------------------------------------------------------------- admin console

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const onlinePaymentsQuery = z
  .object({
    status: z.enum(['created', 'paid', 'failed', 'expired', 'needs_review']).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    search: z.string().trim().max(100).optional(),
    branchId: uuid.optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '"from" must be on or before "to"', path: ['from'] });

export const summaryQuery = z.object({ branchId: uuid.optional() }).strict();
export const idParams = z.object({ id: uuid }).strict();
