'use client';

/**
 * Role-aware helpers for the staff screens.
 *  - friendlyError(): plain sentences for "not allowed" API errors (NOT_ASSIGNED, NOT_CLASS_TEACHER, ...).
 *  - useTeacherScope(): the signed-in teacher's class-teacher sections and (section, subject) pairs,
 *    fetched once per tab from GET /teacher/assignments. The server enforces every rule; the UI uses
 *    this only to hide what the teacher cannot do.
 *  - Homework attachment rules mirrored from the API (types, 5 MB, 5 files).
 */

import { useEffect, useState } from 'react';
import { ApiError, AuthError, apiGet, currentUser, type Role } from './session';

// ------------------------------------------------------------------ friendly errors

const FRIENDLY: Record<string, string> = {
  NOT_ASSIGNED: "This class or subject isn't assigned to you. Ask the school office if it should be.",
  NOT_CLASS_TEACHER: 'Only the class teacher of this section can do this.',
  NOT_OWNER: 'Only the teacher who set this homework (or the school office) can change it.',
  INSUFFICIENT_ROLE: "Your account doesn't have access to this. Ask the school office if you need it.",
  BRANCH_SCOPE_VIOLATION: 'That belongs to another branch of the school.',
  SUBJECT_TAKEN: 'Another teacher already teaches this subject in that class.',
  FILE_TOO_LARGE: 'This file is larger than 5 MB.',
  FILE_TYPE_NOT_ALLOWED: 'This type of file is not allowed. Use PDF, images, Word, Excel, PowerPoint or text files.',
  TOO_MANY_FILES: 'A homework can have at most 5 files.',
  UNAUTHENTICATED: 'Your session has ended. Please sign in again.',
};

/** Plain-language message for an API error; falls back to the server's message. */
export function friendlyError(err: unknown): string {
  // AuthError / ApiError from lib/session, and any other client error carrying { code, status }.
  const e = err as { code?: unknown; status?: unknown; message?: unknown } | null;
  if (err instanceof AuthError || (err instanceof Error && typeof e?.code === 'string' && typeof e?.status === 'number')) {
    const code = String(e!.code);
    const status = Number(e!.status);
    const message = String(e!.message ?? '');
    if (FRIENDLY[code]) return FRIENDLY[code];
    // Plan / module answers carry their own sentence ("switched off" vs "not in your plan").
    if (code === 'MODULE_DISABLED' || code === 'PLAN_LIMIT_REACHED' || code === 'OWNER_ONLY') return message;
    if (status === 403) return "You don't have permission to do this.";
    if (status === 404) return message && !/not found/i.test(message) ? message : "This record doesn't exist or isn't available to you.";
    return message;
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Please try again.';
}

export function errorCodeOf(err: unknown): string | null {
  return err instanceof AuthError ? err.code : null;
}

export function isAdmin(role: Role | null | undefined): boolean {
  return role === 'super_admin' || role === 'branch_admin';
}

// ------------------------------------------------------------------ teacher scope

export interface TeacherAssignments {
  classTeacherOf: Array<{ sectionId: string; label: string }>;
  subjects: Array<{ section: { id: string; label: string }; subject: { id: string; name: string; code: string | null } }>;
}

export interface TeacherScope extends TeacherAssignments {
  /** Every section the teacher may open: class-teacher sections + sections they teach in. */
  sectionIds: Set<string>;
  /** sectionId -> subjects they teach there (display order kept from the API). */
  subjectsBySection: Map<string, Array<{ id: string; name: string }>>;
  isClassTeacher: boolean;
  hasAny: boolean;
}

function toScope(a: TeacherAssignments): TeacherScope {
  const subjectsBySection = new Map<string, Array<{ id: string; name: string }>>();
  for (const s of a.subjects) {
    const list = subjectsBySection.get(s.section.id) ?? [];
    if (!list.some((x) => x.id === s.subject.id)) list.push({ id: s.subject.id, name: s.subject.name });
    subjectsBySection.set(s.section.id, list);
  }
  const sectionIds = new Set<string>([...a.classTeacherOf.map((c) => c.sectionId), ...a.subjects.map((s) => s.section.id)]);
  return { ...a, sectionIds, subjectsBySection, isClassTeacher: a.classTeacherOf.length > 0, hasAny: sectionIds.size > 0 };
}

// One request per tab; changes made by the office show after a reload (the server checks on every request anyway).
let cache: { userId: string; promise: Promise<TeacherScope> } | null = null;

export function loadTeacherScope(force = false): Promise<TeacherScope> {
  const userId = currentUser()?.id ?? '';
  if (!cache || cache.userId !== userId || force) {
    const promise = apiGet<{ data: TeacherAssignments }>('/teacher/assignments').then((r) => toScope(r.data));
    promise.catch(() => {
      if (cache?.promise === promise) cache = null;
    });
    cache = { userId, promise };
  }
  return cache.promise;
}

/**
 * The teacher's scope, or `null` while loading. For admins (and when `enabled` is false) returns
 * `{ scope: null, loading: false }` without calling the API.
 */
export function useTeacherScope(enabled = true) {
  const role = currentUser()?.role;
  const active = enabled && role === 'teacher';
  const [scope, setScope] = useState<TeacherScope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setError(null);
    loadTeacherScope(tick > 0)
      .then((s) => !cancelled && setScope(s))
      .catch((e) => !cancelled && setError(friendlyError(e)));
    return () => {
      cancelled = true;
    };
  }, [active, tick]);
  return { scope: active ? scope : null, loading: active && !scope && !error, error: active ? error : null, isTeacher: role === 'teacher', reload: () => setTick((t) => t + 1) };
}

// ------------------------------------------------------------------ homework files

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_FILES = 5;
export const ALLOWED_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt'];
export const ACCEPT_ATTR = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(',');

export function extensionOf(name: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(name);
  return m ? m[1].toLowerCase() : '';
}

/** Client-side check mirroring the API. Returns an error sentence or null. */
export function checkFile(file: { name: string; size: number }): string | null {
  const ext = extensionOf(file.name);
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return `${file.name}: ${ext ? `.${ext} files are` : 'this type of file is'} not allowed. Use PDF, JPG, PNG, WebP, Word, Excel, PowerPoint or TXT.`;
  }
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > MAX_FILE_BYTES) return `${file.name} is ${formatBytes(file.size)}. Files can be at most 5 MB.`;
  return null;
}

export type FileKind = 'pdf' | 'image' | 'doc' | 'sheet' | 'slides' | 'text' | 'other';

export function fileKind(name: string, mimeType?: string | null): FileKind {
  const ext = extensionOf(name);
  const type = (mimeType ?? '').toLowerCase();
  if (ext === 'pdf' || type === 'application/pdf') return 'pdf';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) || type.startsWith('image/')) return 'image';
  if (['doc', 'docx'].includes(ext)) return 'doc';
  if (['xls', 'xlsx'].includes(ext)) return 'sheet';
  if (['ppt', 'pptx'].includes(ext)) return 'slides';
  if (ext === 'txt' || type.startsWith('text/')) return 'text';
  return 'other';
}

/** 41234 -> "40 KB", 2400000 -> "2.3 MB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
