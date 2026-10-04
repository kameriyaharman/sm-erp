import { z } from 'zod';
import { isoDate, isoMonth, limit, optionalText, page, rupees, text, uuid } from '../shared/schemas.js';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, MANUAL_INCOME_CATEGORIES } from './daybook.helpers.js';

export const ACCOUNT_TYPES = ['cash', 'bank', 'upi'];
export const LEDGER_MODES = ['cash', 'upi', 'card', 'bank_transfer', 'cheque', 'demand_draft', 'net_banking', 'wallet', 'online', 'other'];
/** An expense row only knows these modes (expenses.ck_expenses_mode). */
export const EXPENSE_MODES = ['cash', 'upi', 'bank_transfer', 'cheque', 'card'];
export const SOURCES = ['fee_receipt', 'fee_refund', 'fee_cancel', 'expense', 'manual', 'transfer'];
const ALL_CATEGORIES = [...new Set([...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES, 'fee_refund', 'transfer'])];

const MAX_PAISE = 99_999_999_999; // numeric(12,2)
const amount = rupees.refine((p) => p > 0, 'Amount must be greater than 0').refine((p) => p <= MAX_PAISE, 'Amount is too large');
const bool = z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]);
const DAY = 86_400_000;
const span = (from, to) => (Date.parse(to) - Date.parse(from)) / DAY;

export const branchQuery = z.object({ branchId: uuid.optional() }).strict();

export const createAccountBody = z
  .object({
    name: text(2, 100),
    type: z.enum(ACCOUNT_TYPES),
    details: optionalText(150),
    openingBalance: rupees.refine((p) => p <= MAX_PAISE, 'Amount is too large').default(0),
    openingDate: isoDate,
    isDefault: z.boolean().default(false),
    branchId: uuid.optional(),
  })
  .strict();

export const updateAccountBody = z
  .object({
    name: text(2, 100).optional(),
    details: z.union([optionalText(150), z.null()]),
    openingBalance: rupees.refine((p) => p <= MAX_PAISE, 'Amount is too large').optional(),
    openingDate: isoDate.optional(),
    isActive: z.boolean().optional(),
    isDefault: z.literal(true).optional(),
  })
  .strict()
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: 'Nothing to change' });

export const daybookQuery = z
  .object({ date: isoDate.optional(), accountId: uuid.optional(), branchId: uuid.optional() })
  .strict();

export const rangeQuery = z
  .object({ from: isoDate, to: isoDate, accountId: uuid.optional(), branchId: uuid.optional() })
  .strict()
  .refine((q) => q.from <= q.to, { message: '"from" must be on or before "to"', path: ['to'] })
  .refine((q) => span(q.from, q.to) <= 366, { message: 'Choose at most one year', path: ['to'] });

export const ledgerQuery = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    direction: z.enum(['in', 'out']).optional(),
    category: z.enum(ALL_CATEGORIES).optional(),
    accountId: uuid.optional(),
    source: z.enum(SOURCES).optional(),
    search: z.string().trim().min(1).max(100).optional(),
    includeDeleted: bool.default(false),
    branchId: uuid.optional(),
    page,
    limit: limit(50, 200),
  })
  .strict()
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '"from" must be on or before "to"', path: ['to'] });

export const exportQuery = z
  .object({
    from: isoDate,
    to: isoDate,
    accountId: uuid.optional(),
    branchId: uuid.optional(),
  })
  .strict()
  .refine((q) => q.from <= q.to, { message: '"from" must be on or before "to"', path: ['to'] })
  .refine((q) => span(q.from, q.to) <= 366, { message: 'Export at most one year at a time', path: ['to'] });

export const summaryQuery = z
  .object({ month: isoMonth.optional(), from: isoDate.optional(), to: isoDate.optional(), branchId: uuid.optional() })
  .strict()
  .refine((q) => !(q.month && (q.from || q.to)), { message: 'Pass either month or from/to', path: ['month'] })
  .refine((q) => Boolean(q.from) === Boolean(q.to), { message: 'Pass both from and to', path: ['to'] })
  .refine((q) => !q.from || !q.to || (q.from <= q.to && span(q.from, q.to) <= 366), { message: 'Choose a range of at most one year', path: ['to'] });

export const createEntryBody = z
  .object({
    direction: z.enum(['in', 'out']),
    category: z.string().trim(),
    amount,
    date: isoDate,
    accountId: uuid.optional(),
    paymentMode: z.enum(LEDGER_MODES),
    party: optionalText(150),
    description: text(3, 255),
    reference: optionalText(100),
    branchId: uuid.optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.direction === 'in' && !MANUAL_INCOME_CATEGORIES.includes(b.category)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['category'],
        message: b.category === 'fees' ? 'Fees are recorded from Fee collection, which issues the receipt' : `Choose one of: ${MANUAL_INCOME_CATEGORIES.join(', ')}`,
      });
    }
    if (b.direction === 'out') {
      if (!EXPENSE_CATEGORIES.includes(b.category)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['category'], message: `Choose one of: ${EXPENSE_CATEGORIES.join(', ')}` });
      }
      if (!EXPENSE_MODES.includes(b.paymentMode)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['paymentMode'], message: `Choose one of: ${EXPENSE_MODES.join(', ')}` });
      }
    }
  });

export const deleteEntryBody = z.object({ reason: text(3, 255) }).strict();

export const transferBody = z
  .object({
    fromAccountId: uuid,
    toAccountId: uuid,
    amount,
    date: isoDate,
    description: optionalText(255),
    reference: optionalText(100),
  })
  .strict()
  .refine((b) => b.fromAccountId !== b.toAccountId, { message: 'Choose two different accounts', path: ['toAccountId'] });
