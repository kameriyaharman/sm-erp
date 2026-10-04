import { z } from 'zod';
import { isoDate, limit, optionalText, page, rupees, text, uuid } from '../shared/schemas.js';
import { EXPENSE_CATEGORIES } from '../accounts/daybook.helpers.js';
import { EXPENSE_MODES } from '../accounts/accounts.schemas.js';

export const CATEGORIES = EXPENSE_CATEGORIES;
export const PAYMENT_MODES = EXPENSE_MODES;

export const listQuery = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    category: z.enum(CATEGORIES).optional(),
    paymentMode: z.enum(PAYMENT_MODES).optional(),
    search: z.string().trim().min(1).max(100).optional(),   // description, vendor, reference, voucher no.
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
    accountId: uuid.optional(),         // default: the branch's Cash account for cash, else its Bank account
    branchId: uuid.optional(),          // super_admin only; default = head office
  })
  .strict();

export const deleteBody = z.object({ reason: optionalText(255) }).strict();

export const monthlyQuery = z
  .object({
    months: z.coerce.number().int().min(1).max(24).default(12),
    category: z.enum(CATEGORIES).optional(),
    paymentMode: z.enum(PAYMENT_MODES).optional(),
    search: z.string().trim().min(1).max(100).optional(),
    branchId: uuid.optional(),
  })
  .strict();
