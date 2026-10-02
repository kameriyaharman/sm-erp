'use client';

import { Suspense } from 'react';
import RequireAuth from '@/components/RequireAuth';
import { Spinner } from '@/components/ui';
import StudentProfile from '@/features/admin/students/StudentProfile';

export default function StudentProfilePage() {
  return (
    <RequireAuth roles={['super_admin', 'branch_admin']}>
      <Suspense fallback={<Spinner />}>
        <StudentProfile />
      </Suspense>
    </RequireAuth>
  );
}
