import { z } from 'zod';

const uuid = z.string().uuid();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date');

export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'leave', 'half_day'];

export const sectionsQuery = z
  .object({
    date: isoDate.optional(),          // to report whether attendance is already taken; default today
  })
  .strict();

export const rosterQuery = z
  .object({
    sectionId: uuid,
    date: isoDate.optional(),          // default: today in the school's timezone
  })
  .strict();

export const submitAttendanceBody = z
  .object({
    sectionId: uuid,
    date: isoDate.optional(),
    records: z
      .array(
        z
          .object({
            studentId: uuid,
            status: z.enum(ATTENDANCE_STATUSES),
            remarks: z.string().trim().max(255).optional(),
          })
          .strict(),
      )
      .min(1, 'At least one student is required')
      .max(200),
    // Parents of absent students are notified unless this is false (e.g. a mid-day correction by admin).
    notifyParents: z.boolean().default(true),
  })
  .strict()
  .superRefine((body, ctx) => {
    const seen = new Set();
    body.records.forEach((record, index) => {
      if (seen.has(record.studentId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['records', index, 'studentId'], message: 'Student listed twice' });
      }
      seen.add(record.studentId);
    });
  });

export const historyQuery = z
  .object({
    sectionId: uuid,
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM').optional(),   // default: this month
  })
  .strict();
