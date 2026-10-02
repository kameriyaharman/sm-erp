import { z } from 'zod';
import { isoDate, limit, optionalText, page, text, uuid } from '../shared/schemas.js';

export const listQuery = z.object({ sectionId: uuid.optional(), page, limit: limit(20, 100) }).strict();

export const createBody = z
  .object({
    sectionId: uuid,
    subjectId: uuid.optional(),
    title: text(3, 200),
    details: optionalText(4000),
    dueDate: isoDate,
  })
  .strict();
