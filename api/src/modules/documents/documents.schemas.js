import { z } from 'zod';

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD').refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date');
const text = (max) => z.string().trim().min(1).max(max);

export const idParams = z.object({ id: uuid });
export const studentParams = z.object({ studentId: uuid });
export const sectionParams = z.object({ sectionId: uuid });
export const sectionReportCardsQuery = z.object({ termId: uuid.optional() }).strict();
export const codeParams = z.object({ code: z.string().trim().min(12).max(20) });

export const generateBody = z.object({
  sectionId: uuid,
  termId: uuid.optional(),            // progress report up to this term; omit for the final (annual) report card
}).strict();

export const publishBody = generateBody;

export const updateReportCardBody = z.object({
  teacherRemarks: z.string().trim().max(600).nullable().optional(),
  principalRemarks: z.string().trim().max(600).nullable().optional(),
  result: z.enum(['pass', 'fail', 'promoted', 'detained', 'withheld']).optional(),
}).strict().refine((b) => Object.keys(b).length > 0, 'Nothing to update');

export const transferCertificateBody = z.object({
  applicationDate: isoDate,
  reasonForLeaving: text(200),
  leavingDate: isoDate.optional(),
  generalConduct: text(60).optional(),
  nccScoutGuide: text(120).optional(),
  gamesActivities: text(250).optional(),
  otherRemarks: text(250).optional(),
  // Override the values worked out from report cards, e.g. for students who joined with a board result.
  lastExamResult: text(200).optional(),
  qualifiedForPromotion: text(120).optional(),
  acknowledgeDues: z.boolean().default(false),
}).strict();

export const bonafideBody = z.object({
  purpose: text(150),
}).strict();

export const cancelBody = z.object({ reason: text(255) }).strict();

export const certificateListQuery = z.object({
  studentId: uuid.optional(),
  type: z.enum(['transfer_certificate', 'bonafide']).optional(),
  branchId: uuid.optional(),
  tenantId: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const certificatePdfQuery = z.object({
  copy: z.enum(['original', 'duplicate']).optional(),
  download: z.enum(['0', '1']).optional(),
});

export const pdfQuery = z.object({ download: z.enum(['0', '1']).optional() });
