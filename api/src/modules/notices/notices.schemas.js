import { z } from 'zod';
import { isoDate, text, uuid } from '../shared/schemas.js';

export const listQuery = z
  .object({
    audience: z.enum(['all', 'parents', 'teachers']).optional(),
    classId: uuid.optional(),                       // notices for this class only
    pinned: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
    from: isoDate.optional(),                       // posted on or after (school time zone)
    to: isoDate.optional(),
    search: z.string().trim().min(1).max(100).optional(),   // title or text
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '"from" must be on or before "to"', path: ['to'] });

export const createBody = z
  .object({
    title: text(3, 150),
    body: text(3, 4000),
    audience: z.enum(['all', 'parents', 'teachers']),
    classId: uuid.optional(),
    pinned: z.boolean().default(false),
    sendSms: z.boolean().default(false),
    branchId: uuid.optional(),          // super_admin only; default = head office
  })
  .strict();
