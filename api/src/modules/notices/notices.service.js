import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { ROLES } from '../../config/roles.js';
import { pool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { logger } from '../../utils/logger.js';
import { getNotifier } from '../notifications/index.js';
import { findNoticeRecipients } from '../notifications/recipients.repository.js';
import { assertStaffAccess, isAdmin, resolveWriteBranch, staffScope } from '../shared/access.js';
import * as repo from './notices.repository.js';

function mapNotice(n) {
  return {
    id: n.id,
    title: n.title,
    body: n.body,
    audience: n.audience,
    class: n.class_id ? { id: n.class_id, name: n.class_name } : null,
    pinned: n.pinned,
    createdAt: n.created_at,
    createdBy: { name: n.created_by_name || null },
  };
}

export async function listNotices(auth, { limit }) {
  let rows;
  if (isAdmin(auth)) rows = await repo.listForAdmin(await staffScope(auth), limit);
  else if (auth.role === ROLES.TEACHER) rows = await repo.listForTeacher(auth, limit);
  else if (auth.role === ROLES.PARENT) rows = await repo.listForParent(auth, limit);
  else rows = [];
  return rows.map(mapNotice);
}

/**
 * Posts a notice. With sendSms the existing broadcast pipeline sends it (in the background,
 * like POST /notifications/broadcasts): parents for audience all/parents (only the class's
 * parents for a class notice), teachers for audience teachers.
 */
export async function createNotice(auth, input) {
  const { tenantId, branchId } = await resolveWriteBranch(auth, input.branchId);
  if (input.classId && !(await repo.classInBranch(pool, input.classId, branchId))) {
    throw AppError.notFound('Class not found', 'CLASS_NOT_FOUND');
  }

  let broadcast = null;
  let send = null;
  if (input.sendSms) {
    const targetRole = input.audience === 'teachers' ? 'teacher' : 'parent';
    let recipients = await findNoticeRecipients({ role: targetRole, tenantId, branchId });
    if (input.classId && targetRole === 'parent') {
      const parents = await repo.parentIdsOfClass(pool, input.classId);
      recipients = recipients.filter((r) => parents.has(r.userId));
    }
    const batchId = randomUUID();
    broadcast = { batchId, recipients: recipients.length };
    send = () => getNotifier({ env, logger })
      .sendBroadcastNotice(targetRole, input.title, input.body, { tenantId, branchId, createdBy: auth.userId, batchId, recipients })
      .catch((err) => logger.error('Notice broadcast crashed', { batchId, error: err.message }));
  }

  const id = await repo.insertNotice(pool, { ...input, tenantId, branchId, batchId: broadcast?.batchId, createdBy: auth.userId });
  send?.();
  logger.info('Notice posted', { noticeId: id, audience: input.audience, sms: Boolean(broadcast), by: auth.userId });
  return { notice: mapNotice(await repo.getNotice(pool, id)), broadcast };
}

export async function deleteNotice(auth, id) {
  const notice = await repo.getNotice(pool, id);
  assertStaffAccess(auth, notice, 'Notice not found', 'NOTICE_NOT_FOUND');
  await repo.softDelete(pool, id);
}
