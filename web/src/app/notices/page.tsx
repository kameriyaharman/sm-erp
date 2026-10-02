'use client';

import { Suspense } from 'react';
import RequireAuth from '@/components/RequireAuth';
import { Spinner } from '@/components/ui';
import Screen from '@/features/admin/NoticesPage';

export default function Page() {
  return (
    <RequireAuth roles={['super_admin', 'branch_admin', 'teacher']}>
      <Suspense fallback={<Spinner />}>
        <Screen />
      </Suspense>
    </RequireAuth>
  );
}
