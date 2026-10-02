import { z } from 'zod';

const uuid = z.string().uuid();

export const broadcastBody = z
  .object({
    targetRole: z.enum(['parent', 'teacher']),
    title: z.string().trim().min(3).max(150),
    body: z.string().trim().min(3).max(4000),
    tenantId: uuid.optional(),    // platform super admin only
    branchId: uuid.optional(),    // omit = whole school group (super_admin) / own branch (branch_admin)
  })
  .strict();

export const feeRemindersBody = z
  .object({
    daysAhead: z.number().int().min(0).max(30).default(3),
    includeOverdue: z.boolean().default(true),
    tenantId: uuid.optional(),
    branchId: uuid.optional(),
    dryRun: z.boolean().default(false),  // count who would be reminded, send nothing
  })
  .strict();

export const logsQuery = z
  .object({
    status: z.enum(['sending', 'sent', 'failed', 'abandoned']).optional(),
    eventType: z.enum(['absentee_alert', 'fee_due_reminder', 'broadcast_notice', 'attendance_correction']).optional(),
    batchId: uuid.optional(),
    tenantId: uuid.optional(),
    branchId: uuid.optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const idParams = z.object({ id: uuid }).strict();
export const batchParams = z.object({ batchId: uuid }).strict();
