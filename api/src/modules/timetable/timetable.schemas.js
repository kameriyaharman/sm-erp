import { z } from 'zod';
import { hhmm, uuid } from '../shared/schemas.js';

export const getQuery = z.object({ sectionId: uuid }).strict();

const blankToUndefined = (v) => (v === '' || v === null ? undefined : v);

export const putBody = z
  .object({
    sectionId: uuid,
    periods: z
      .array(
        z
          .object({
            weekday: z.number().int().min(1).max(6),
            periodNo: z.number().int().min(1).max(15),
            start: hhmm,
            end: hhmm,
            kind: z.enum(['class', 'break', 'assembly', 'activity']),
            subjectId: z.preprocess(blankToUndefined, uuid.optional()),
            label: z.preprocess(blankToUndefined, z.string().trim().max(60).optional()),
            teacherStaffId: z.preprocess(blankToUndefined, uuid.optional()),
            room: z.preprocess(blankToUndefined, z.string().trim().max(30).optional()),
          })
          .strict(),
      )
      .max(90),
  })
  .strict();
