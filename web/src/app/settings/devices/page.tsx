'use client';

import RequireAuth from '@/components/RequireAuth';
import DevicesPage from '@/features/settings/DevicesPage';

export default function Page() {
  return (
    <RequireAuth roles={['super_admin', 'branch_admin']}>
      <DevicesPage />
    </RequireAuth>
  );
}
