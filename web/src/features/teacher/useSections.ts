'use client';

import { useCallback, useMemo } from 'react';
import { useApi } from '@/lib/useApi';
import { currentUser } from '@/lib/session';
import { useTeacherScope } from '@/lib/access';
import type { SchoolClass, SectionChoice } from './types';

/**
 * Current-year sections the user may work with, flattened, with `mine` set on the sections the
 * signed-in teacher is class teacher of.
 *  - Admins: every section of their scope (GET /school/classes).
 *  - Teachers: only "their sections" (class-teacher sections + sections where they teach a subject,
 *    GET /teacher/assignments), so pickers never offer a class the server would refuse.
 * `subjectsFor(sectionId)` lists the subjects a teacher teaches in that section (admins: null = any).
 */
export function useSections() {
  const { data, error, loading, reload } = useApi<{ data: SchoolClass[] }>('/school/classes');
  const teacher = useTeacherScope();
  const me = currentUser()?.id;
  const sections = useMemo<SectionChoice[] | null>(() => {
    if (!data) return null;
    if (teacher.isTeacher && !teacher.scope) return null;
    const scope = teacher.scope;
    return data.data.flatMap((c) =>
      c.sections
        .filter((s) => !scope || scope.sectionIds.has(s.id))
        .map((s) => ({
          ...s,
          classId: c.id,
          className: c.name,
          mine: scope ? scope.classTeacherOf.some((ct) => ct.sectionId === s.id) : !!me && s.classTeacher?.userId === me,
        })),
    );
  }, [data, me, teacher.isTeacher, teacher.scope]);
  const mine = useMemo(() => sections?.filter((s) => s.mine) ?? [], [sections]);
  /** Default pick: the teacher's own class, else the first section. */
  const defaultId = mine[0]?.id ?? sections?.[0]?.id ?? '';
  const scope = teacher.scope;
  const subjectsFor = useCallback((sectionId: string) => (scope ? scope.subjectsBySection.get(sectionId) ?? [] : null), [scope]);
  return {
    sections,
    mine,
    defaultId,
    error: error ?? teacher.error,
    loading: loading || teacher.loading,
    reload: () => {
      reload();
      if (teacher.error) teacher.reload();
    },
    classes: data?.data ?? null,
    isTeacher: teacher.isTeacher,
    scope,
    subjectsFor,
  };
}

/** "2026-10" for the current month (local time). */
export function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "2026-09-01" -> "Tue 1 Sep" */
export function dayLabel(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${WEEKDAY_SHORT[date.getDay()]} ${d} ${date.toLocaleDateString('en-IN', { month: 'short' })}`;
}

export function fullName(): string {
  const u = currentUser();
  return [u?.firstName, u?.lastName].filter(Boolean).join(' ');
}

export function isAdminRole(): boolean {
  const role = currentUser()?.role;
  return role === 'super_admin' || role === 'branch_admin';
}
