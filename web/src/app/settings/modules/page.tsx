'use client';

import RequireAuth from '@/components/RequireAuth';
import ModulesPage from '@/features/settings/ModulesPage';

export default function Page() {
  return (
    <RequireAuth roles={['super_admin', 'branch_admin']}>
      <ModulesPage />
    </RequireAuth>
  );
}
