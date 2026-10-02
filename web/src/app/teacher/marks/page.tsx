'use client';

import RequireAuth from '@/components/RequireAuth';
import type { Role } from '@/lib/session';
import MarksScreen from '@/features/teacher/MarksScreen';

const ROLES: Role[] = ['teacher'];

export default function TeacherMarksPage() {
  return (
    <RequireAuth roles={ROLES}>
      <MarksScreen />
    </RequireAuth>
  );
}
