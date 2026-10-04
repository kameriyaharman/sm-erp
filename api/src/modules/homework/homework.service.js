import { pool, withTransaction } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { ROLES } from '../../config/roles.js';
import { logger } from '../../utils/logger.js';
import {
  assertStaffAccess, conflict, isAdmin, loadSectionForStaff, loadSectionInScope, loadTeacherScope, notAssigned, pageMeta, staffScope, unprocessable,
} from '../shared/access.js';
import { hasSection, teaches } from '../shared/teacher-scope.helpers.js';
import { MAX_FILES_PER_HOMEWORK, checkUpload } from './file-type.js';
import * as repo from './homework.repository.js';

export const attachmentUrl = (id) => `/api/v1/homework/attachments/${id}`;

export const mapAttachment = (a) => ({
  id: a.id,
  fileName: a.file_name,
  mimeType: a.mime_type,
  sizeBytes: a.size_bytes,
  url: attachmentUrl(a.id),
  uploadedAt: a.created_at,
});

/** Can this caller change (delete, add/remove files) this homework? Admins in scope, else its creator. */
const canEditRow = (auth, h) => (auth ? isAdmin(auth) || (auth.role === ROLES.TEACHER && h.created_by === auth.userId) : false);

export function mapHomework(h, { attachments = [], auth = null } = {}) {
  return {
    id: h.id,
    section: { id: h.section_id, label: h.section_label },
    subject: h.subject_id ? { id: h.subject_id, name: h.subject_name } : null,
    title: h.title,
    details: h.details,
    assignedAt: h.assigned_at,
    dueDate: h.due_date,
    teacher: { name: h.teacher_name || null },
    createdBy: h.created_by ? { userId: h.created_by, name: h.teacher_name || null } : null,
    canEdit: canEditRow(auth, h),
    attachments: attachments.map(mapAttachment),
  };
}

/**
 * A page of homework rows with their attachments; used by staff and the parent app (one
 * section). `auth` decides `canEdit` (null = read-only, e.g. parents).
 */
export async function pageOfHomework({ scope, sectionId, sectionIds = null, page, limit, auth = null, filters = {} }) {
  const rows = await repo.listHomework({ scope, sectionId, sectionIds, page, limit, filters });
  const total = rows.length ? Number(rows[0].total_count) : 0;
  const files = await repo.attachmentsFor(pool, rows.map((r) => r.id));
  return {
    data: rows.map((r) => mapHomework(r, { attachments: files.get(r.id) ?? [], auth: auth?.role === ROLES.PARENT ? null : auth })),
    meta: pageMeta({ page, limit }, total),
  };
}

/** Admins: their scope. Teacher: only their sections (class teacher or subject teacher). */
export async function listHomework(auth, { sectionId, page, limit, ...filters }) {
  const scope = await staffScope(auth);
  if (sectionId) await loadSectionInScope(pool, auth, sectionId);
  let sectionIds = null;
  // Teacher: their sections only, whatever classId / subjectId asks for (another class -> empty list).
  if (auth.role === ROLES.TEACHER && !sectionId) {
    sectionIds = [...(await loadTeacherScope(pool, auth)).sectionIds];
  }
  return pageOfHomework({ scope, sectionId, sectionIds, page, limit, auth, filters });
}

/** Teacher: subject required, and only a subject they teach in that section. */
export async function createHomework(auth, input) {
  const section = await loadSectionForStaff(pool, auth, input.sectionId);
  if (auth.role === ROLES.TEACHER) {
    if (!input.subjectId) {
      throw AppError.badRequest('Validation failed', { body: { subjectId: ['Choose the subject'] } }, 'VALIDATION_ERROR');
    }
    const scope = await loadTeacherScope(pool, auth);
    if (!teaches(scope, section.id, input.subjectId)) {
      throw notAssigned('You can only set homework for a subject you teach in this section');
    }
  }
  if (input.subjectId && !(await repo.subjectInBranch(pool, input.subjectId, section.branch_id))) {
    throw unprocessable('SUBJECT_NOT_FOUND', 'Unknown or inactive subject for this branch', { subjectId: input.subjectId });
  }
  if (input.dueDate < section.today) {
    throw AppError.badRequest('Validation failed', { body: { dueDate: ['The due date cannot be in the past'] } }, 'VALIDATION_ERROR');
  }
  const id = await repo.insertHomework(pool, {
    ...input, tenantId: section.tenant_id, branchId: section.branch_id, createdBy: auth.userId,
  });
  logger.info('Homework set', { homeworkId: id, sectionId: section.id, subjectId: input.subjectId ?? null, by: auth.userId });
  return mapHomework(await repo.getHomework(pool, id), { auth });
}

/** Loads homework the caller may change: 404 outside their branch scope, 403 NOT_OWNER for another teacher's. */
async function loadEditable(db, auth, id, opts) {
  const row = await repo.getHomework(db, id, opts);
  assertStaffAccess(auth, row, 'Homework not found', 'HOMEWORK_NOT_FOUND');
  if (!canEditRow(auth, row)) {
    throw AppError.forbidden('Only the teacher who set this homework (or the school office) can change it', 'NOT_OWNER');
  }
  return row;
}

/** The teacher who set it, or the school office. */
export async function deleteHomework(auth, id) {
  await loadEditable(pool, auth, id);
  await repo.softDelete(pool, id);
}

// =====================================================================
// Attachments
// =====================================================================

/**
 * Runs before the upload is read: rejects callers who may not add files (and full
 * homework) without buffering 5 MB first.
 */
export async function assertCanUpload(auth, homeworkId) {
  const row = await loadEditable(pool, auth, homeworkId);
  if ((await repo.countAttachments(pool, row.id)) >= MAX_FILES_PER_HOMEWORK) {
    throw conflict('TOO_MANY_FILES', `A homework can have at most ${MAX_FILES_PER_HOMEWORK} files`);
  }
}

export async function addAttachment(auth, homeworkId, file) {
  if (!file) {
    throw AppError.badRequest('Validation failed', { body: { file: ['Attach one file in the "file" field (multipart/form-data)'] } }, 'VALIDATION_ERROR');
  }
  const check = checkUpload(file);
  if (!check.ok) {
    const status = { FILE_TOO_LARGE: 413, FILE_TYPE_NOT_ALLOWED: 415 }[check.code] ?? 400;
    throw new AppError(status, check.code, check.message);
  }
  const saved = await withTransaction(async (db) => {
    // Row lock: two parallel uploads can't both pass the 5-file check.
    const row = await loadEditable(db, auth, homeworkId, { lock: true });
    if ((await repo.countAttachments(db, row.id)) >= MAX_FILES_PER_HOMEWORK) {
      throw conflict('TOO_MANY_FILES', `A homework can have at most ${MAX_FILES_PER_HOMEWORK} files`);
    }
    return repo.insertAttachment(db, {
      homeworkId: row.id,
      tenantId: row.tenant_id,
      branchId: row.branch_id,
      fileName: check.fileName,
      mimeType: check.mime,
      data: file.buffer,
      uploadedBy: auth.userId,
    });
  });
  logger.info('Homework file added', { homeworkId, attachmentId: saved.id, bytes: saved.size_bytes, type: check.ext, by: auth.userId });
  return mapAttachment(saved);
}

/**
 * Who may download: admins in scope; a teacher for their own sections (or homework they
 * set); a parent whose child is in the homework's section. Anything else is a 404 (403
 * NOT_ASSIGNED for a teacher of the same branch).
 */
export async function getAttachmentFile(auth, id) {
  const a = await repo.getAttachment(pool, id);
  const notFound = () => AppError.notFound('File not found', 'ATTACHMENT_NOT_FOUND');
  if (!a) throw notFound();

  if (auth.role === ROLES.PARENT || auth.role === ROLES.STUDENT) {
    const ok = a.tenant_id === auth.tenantId
      && (await repo.parentHasChildInSection(pool, { userId: auth.userId, tenantId: auth.tenantId, sectionId: a.section_id }));
    if (!ok) throw notFound();
  } else {
    assertStaffAccess(auth, a, 'File not found', 'ATTACHMENT_NOT_FOUND');
    if (auth.role === ROLES.TEACHER && a.homework_created_by !== auth.userId) {
      if (!hasSection(await loadTeacherScope(pool, auth), a.section_id)) throw notAssigned('This homework is not for one of your classes');
    }
  }
  const data = await repo.attachmentData(pool, id);
  if (!data) throw notFound();
  return { fileName: a.file_name, mimeType: a.mime_type, data };
}

export async function deleteAttachment(auth, id) {
  await withTransaction(async (db) => {
    const a = await repo.getAttachment(db, id);
    assertStaffAccess(auth, a, 'File not found', 'ATTACHMENT_NOT_FOUND');
    await loadEditable(db, auth, a.homework_id, { lock: true });
    await repo.deleteAttachment(db, id);
  });
  logger.info('Homework file removed', { attachmentId: id, by: auth.userId });
}
