import { z } from 'zod';
import { isoDate, limit, optionalText, page, text, uuid } from '../shared/schemas.js';

export const listQuery = z
  .object({
    sectionId: uuid.optional(),
    classId: uuid.optional(),
    subjectId: uuid.optional(),
    // Date range on the day it was set ('assigned', school time zone) or its due date ('due').
    dateField: z.enum(['assigned', 'due']).default('assigned'),
    from: isoDate.optional(),
    to: isoDate.optional(),
    search: z.string().trim().min(1).max(100).optional(),   // title or details
    page,
    limit: limit(20, 100),
  })
  .strict()
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: '"from" must be on or before "to"', path: ['to'] });

export const createBody = z
  .object({
    sectionId: uuid,
    subjectId: uuid.optional(),
    title: text(3, 200),
    details: optionalText(4000),
    dueDate: isoDate,
  })
  .strict();
