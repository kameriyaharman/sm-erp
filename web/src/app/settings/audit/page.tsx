'use client';

import RequireAuth from '@/components/RequireAuth';
import AuditPage from '@/features/settings/AuditPage';

export default function Page() {
  return (
    <RequireAuth roles={['super_admin', 'branch_admin']}>
      <AuditPage />
    </RequireAuth>
  );
}
