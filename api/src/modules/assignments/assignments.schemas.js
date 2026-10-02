import { z } from 'zod';
import { uuid } from '../shared/schemas.js';

export const putBody = z
  .object({
    assignments: z.array(z.object({ sectionId: uuid, subjectId: uuid }).strict()).max(200),
    reassign: z.boolean().optional().default(false),
  })
  .strict();

export const sectionQuery = z.object({ sectionId: uuid }).strict();
