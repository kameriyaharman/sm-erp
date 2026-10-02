'use client';

import RequireAuth from '@/components/RequireAuth';
import type { Role } from '@/lib/session';
import MyTimetable from '@/features/teacher/MyTimetable';

const ROLES: Role[] = ['teacher'];

export default function TeacherTimetablePage() {
  return (
    <RequireAuth roles={ROLES}>
      <MyTimetable />
    </RequireAuth>
  );
}
