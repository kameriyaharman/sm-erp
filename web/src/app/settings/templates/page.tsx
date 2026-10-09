'use client';

import RequireAuth from '@/components/RequireAuth';
import TemplatesPage from '@/features/settings/TemplatesPage';

export default function Page() {
  return (
    <RequireAuth roles={['super_admin', 'branch_admin']}>
      <TemplatesPage />
    </RequireAuth>
  );
}
