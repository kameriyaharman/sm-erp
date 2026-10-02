import { pool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { ROLES } from '../../config/roles.js';
import { assertStaffAccess, loadSectionForStaff, pageMeta, staffScope, unprocessable } from '../shared/access.js';
import * as repo from './homework.repository.js';

export function mapHomework(h) {
  return {
    id: h.id,
    section: { id: h.section_id, label: h.section_label },
    subject: h.subject_id ? { id: h.subject_id, name: h.subject_name } : null,
    title: h.title,
    details: h.details,
    assignedAt: h.assigned_at,
    dueDate: h.due_date,
    teacher: { name: h.teacher_name || null },
  };
}

/** A page of homework rows; used by staff (branch scope) and the parent app (one section). */
export async function pageOfHomework({ scope, sectionId, page, limit }) {
  const rows = await repo.listHomework({ scope, sectionId, page, limit });
  const total = rows.length ? Number(rows[0].total_count) : 0;
  return { data: rows.map(mapHomework), meta: pageMeta({ page, limit }, total) };
}

export async function listHomework(auth, { sectionId, page, limit }) {
  const scope = await staffScope(auth);
  if (sectionId) await loadSectionForStaff(pool, auth, sectionId);
  return pageOfHomework({ scope, sectionId, page, limit });
}

export async function createHomework(auth, input) {
  const section = await loadSectionForStaff(pool, auth, input.sectionId);
  if (input.subjectId && !(await repo.subjectInBranch(pool, input.subjectId, section.branch_id))) {
    throw unprocessable('SUBJECT_NOT_FOUND', 'Unknown or inactive subject for this branch', { subjectId: input.subjectId });
  }
  if (input.dueDate < section.today) {
    throw AppError.badRequest('Validation failed', { body: { dueDate: ['The due date cannot be in the past'] } }, 'VALIDATION_ERROR');
  }
  const id = await repo.insertHomework(pool, {
    ...input, tenantId: section.tenant_id, branchId: section.branch_id, createdBy: auth.userId,
  });
  return mapHomework(await repo.getHomework(pool, id));
}

/** The teacher who set it, or the school office. */
export async function deleteHomework(auth, id) {
  const row = await repo.getHomework(pool, id);
  assertStaffAccess(auth, row, 'Homework not found', 'HOMEWORK_NOT_FOUND');
  if (auth.role === ROLES.TEACHER && row.created_by !== auth.userId) {
    throw AppError.forbidden('Only the teacher who set this homework can delete it', 'NOT_OWNER');
  }
  await repo.softDelete(pool, id);
}
