import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date');

export const defaultersQuerySchema = z
  .object({
    tenantId: z.string().uuid().optional(),           // platform super admin only
    branchId: z.string().uuid().optional(),
    classId: z.string().uuid().optional(),
    sectionId: z.string().uuid().optional(),
    search: z.string().trim().min(1).max(100).optional(),  // student name, admission no., parent name or phone
    asOf: isoDate.optional(),                          // default: today
    minDaysOverdue: z.coerce.number().int().min(0).max(3650).default(0),
    minAmount: z.coerce.number().min(0).default(0),
    sort: z.enum(['amount', 'days']).default('amount'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
