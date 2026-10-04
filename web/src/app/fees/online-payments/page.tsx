'use client';

import { Suspense } from 'react';
import RequireAuth from '@/components/RequireAuth';
import { Spinner } from '@/components/ui';
import OnlinePaymentsConsole from '@/features/payments/OnlinePaymentsConsole';

export default function Page() {
  return (
    <RequireAuth roles={['super_admin', 'branch_admin']}>
      <Suspense fallback={<Spinner />}>
        <OnlinePaymentsConsole />
      </Suspense>
    </RequireAuth>
  );
}
