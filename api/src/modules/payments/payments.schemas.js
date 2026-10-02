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
