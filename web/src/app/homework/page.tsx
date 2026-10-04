'use client';

import { Suspense } from 'react';
import RequireAuth from '@/components/RequireAuth';
import { Spinner } from '@/components/ui';
import type { Role } from '@/lib/session';
import HomeworkScreen from '@/features/teacher/HomeworkScreen';

const ROLES: Role[] = ['super_admin', 'branch_admin', 'teacher'];

export default function HomeworkPage() {
  return (
    <RequireAuth roles={ROLES}>
      <Suspense fallback={<Spinner />}>
        <HomeworkScreen />
      </Suspense>
    </RequireAuth>
  );
}
