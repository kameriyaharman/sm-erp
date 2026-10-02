import { z } from 'zod';
import { isoDate, text, uuid } from '../shared/schemas.js';

export const EXAM_TYPES = ['unit_test', 'periodic', 'mid_term', 'final', 'practical', 'internal', 'other'];
export const COMPONENT_CODES = ['PT', 'NB', 'SEA', 'MA', 'PF', 'TERM'];
export const EXAM_STATUSES = ['draft', 'scheduled', 'ongoing', 'completed', 'results_published'];

const marks = z.coerce.number().positive().max(1000).multipleOf(0.25, 'Use steps of 0.25');
const passMarks = z.coerce.number().min(0).max(1000).multipleOf(0.25, 'Use steps of 0.25');

const datesInOrder = (b) => !b.startDate || !b.endDate || b.startDate <= b.endDate;

export const listQuery = z.object({ branchId: uuid.optional() }).strict();

export const createExamBody = z
  .object({
    name: text(2, 100),
    examType: z.enum(EXAM_TYPES),
    componentCode: z.enum(COMPONENT_CODES).optional(),
    termId: uuid.optional(),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
    branchId: uuid.optional(),          // super_admin only; default = head office
  })
  .strict()
  .refine(datesInOrder, { message: 'End date must be on or after the start date', path: ['endDate'] });

export const updateExamBody = z
  .object({
    name: text(2, 100).optional(),
    status: z.enum(EXAM_STATUSES).optional(),
    startDate: isoDate.nullable().optional(),
    endDate: isoDate.nullable().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update')
  .refine(datesInOrder, { message: 'End date must be on or after the start date', path: ['endDate'] });

export const papersQuery = z.object({ classId: uuid.optional() }).strict();

export const createPapersBody = z
  .object({
    classId: uuid,
    subjectIds: z.array(uuid).min(1).max(30),
    examDate: isoDate,
    maxMarks: marks,
    passMarks: passMarks.optional(),
  })
  .strict()
  .refine((b) => b.passMarks === undefined || b.passMarks <= b.maxMarks, { message: 'Pass marks cannot exceed the maximum', path: ['passMarks'] });

export const updatePaperBody = z
  .object({
    examDate: isoDate.optional(),
    maxMarks: marks.optional(),
    passMarks: passMarks.nullable().optional(),
    marksLocked: z.boolean().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update');

export const marksQuery = z.object({ paperId: uuid, sectionId: uuid.optional() }).strict();

export const saveMarksBody = z
  .object({
    paperId: uuid,
    entries: z
      .array(
        z
          .object({
            studentId: uuid,
            marksObtained: z.number().min(0).max(1000).nullable(),
            isAbsent: z.boolean(),
            remarks: z.string().trim().max(255).optional(),
          })
          .strict()
          .refine((e) => !(e.isAbsent && e.marksObtained !== null), { message: 'An absent student has no marks', path: ['marksObtained'] }),
      )
      .min(1)
      .max(200),
  })
  .strict()
  .superRefine((body, ctx) => {
    const seen = new Set();
    body.entries.forEach((e, i) => {
      if (seen.has(e.studentId)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['entries', i, 'studentId'], message: 'Student listed twice' });
      seen.add(e.studentId);
    });
  });
