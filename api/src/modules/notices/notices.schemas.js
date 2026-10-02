import { z } from 'zod';
import { text, uuid } from '../shared/schemas.js';

export const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();

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
