'use client';

import RequireAuth from '@/components/RequireAuth';
import type { Role } from '@/lib/session';
import MyClass from '@/features/teacher/MyClass';

const ROLES: Role[] = ['teacher'];

export default function TeacherClassPage() {
  return (
    <RequireAuth roles={ROLES}>
      <MyClass />
    </RequireAuth>
  );
}
