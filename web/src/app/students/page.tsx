'use client';

import { Suspense } from 'react';
import RequireAuth from '@/components/RequireAuth';
import { Spinner } from '@/components/ui';
import StudentsList from '@/features/admin/students/StudentsList';

export default function StudentsPage() {
  return (
    <RequireAuth roles={['super_admin', 'branch_admin']}>
      <Suspense fallback={<Spinner />}>
        <StudentsList />
      </Suspense>
    </RequireAuth>
  );
}
