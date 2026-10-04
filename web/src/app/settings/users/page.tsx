'use client';

import RequireAuth from '@/components/RequireAuth';
import PortalLogins from '@/features/payments/PortalLogins';

export default function Page() {
  return (
    <RequireAuth roles={['super_admin', 'branch_admin']}>
      <PortalLogins />
    </RequireAuth>
  );
}
