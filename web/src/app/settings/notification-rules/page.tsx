'use client';

import RequireAuth from '@/components/RequireAuth';
import RulesPage from '@/features/settings/RulesPage';

export default function Page() {
  return (
    <RequireAuth roles={['super_admin', 'branch_admin']}>
      <RulesPage />
    </RequireAuth>
  );
}
