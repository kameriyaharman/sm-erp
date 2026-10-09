'use client';

import RequireAuth from '@/components/RequireAuth';
import PlansPage from '@/features/platform/PlansPage';

export default function Page() {
  return (
    <RequireAuth roles={['super_admin']}>
      <PlansPage />
    </RequireAuth>
  );
}
