'use client';

import RequireAuth from '@/components/RequireAuth';
import PaymentSettings from '@/features/payments/PaymentSettings';

export default function Page() {
  return (
    <RequireAuth roles={['super_admin', 'branch_admin']}>
      <PaymentSettings />
    </RequireAuth>
  );
}
