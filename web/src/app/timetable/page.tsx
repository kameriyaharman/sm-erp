'use client';

import { Suspense } from 'react';
import RequireAuth from '@/components/RequireAuth';
import { Spinner } from '@/components/ui';
import Screen from '@/features/admin/TimetablePage';

export default function Page() {
  return (
    <RequireAuth roles={['super_admin', 'branch_admin']}>
      <Suspense fallback={<Spinner />}>
        <Screen />
      </Suspense>
    </RequireAuth>
  );
}
