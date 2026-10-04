'use client';

import RequireAuth from '@/components/RequireAuth';
import OnlinePaymentsConsole from '@/features/payments/OnlinePaymentsConsole';

export default function Page() {
  return (
    <RequireAuth roles={['super_admin', 'branch_admin']}>
      <OnlinePaymentsConsole />
    </RequireAuth>
  );
}
