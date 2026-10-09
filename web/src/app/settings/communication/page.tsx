'use client';

import RequireAuth from '@/components/RequireAuth';
import CommunicationPage from '@/features/settings/CommunicationPage';

export default function Page() {
  return (
    <RequireAuth roles={['super_admin', 'branch_admin']}>
      <CommunicationPage />
    </RequireAuth>
  );
}
