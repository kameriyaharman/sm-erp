'use client';

import { useMemo } from 'react';
import { useApi } from '@/lib/useApi';
import { currentUser } from '@/lib/session';
import type { SchoolClass, SectionChoice } from './types';

/**
 * Current-year sections of the user's branch (GET /school/classes), flattened, with
 * `mine` set on the sections the signed-in teacher is class teacher of.
 */
export function useSections() {
  const { data, error, loading, reload } = useApi<{ data: SchoolClass[] }>('/school/classes');
  const me = currentUser()?.id;
  const sections = useMemo<SectionChoice[] | null>(() => {
    if (!data) return null;
    return data.data.flatMap((c) =>
      c.sections.map((s) => ({ ...s, classId: c.id, className: c.name, mine: !!me && s.classTeacher?.userId === me })),
    );
  }, [data, me]);
  const mine = useMemo(() => sections?.filter((s) => s.mine) ?? [], [sections]);
  /** Default pick: the teacher's own class, else the first section. */
  const defaultId = mine[0]?.id ?? sections?.[0]?.id ?? '';
  return { sections, mine, defaultId, error, loading, reload, classes: data?.data ?? null };
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
