import { z } from 'zod';
import { isoDate, limit, optionalText, page, rupees, text, uuid } from '../shared/schemas.js';

export const CATEGORIES = ['salary', 'utilities', 'maintenance', 'transport', 'supplies', 'events', 'other'];
export const PAYMENT_MODES = ['cash', 'upi', 'bank_transfer', 'cheque', 'card'];

export const listQuery = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    category: z.enum(CATEGORIES).optional(),
    branchId: uuid.optional(),
    page,
    limit: limit(25, 100),
  })
  .strict()
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '"from" must be on or before "to"', path: ['to'] });

export const createBody = z
  .object({
    category: z.enum(CATEGORIES),
    description: text(3, 255),
    amount: rupees.refine((paise) => paise > 0, 'Amount must be greater than 0').refine((p) => p < 1e12, 'Amount is too large'),
    expenseDate: isoDate,
    paymentMode: z.enum(PAYMENT_MODES),
    vendor: optionalText(150),
    reference: optionalText(100),
    branchId: uuid.optional(),          // super_admin only; default = head office
  })
  .strict();

export const monthlyQuery = z
  .object({ months: z.coerce.number().int().min(1).max(24).default(12), branchId: uuid.optional() })
  .strict();
