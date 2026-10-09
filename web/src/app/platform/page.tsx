'use client';

import RequireAuth from '@/components/RequireAuth';
import SchoolsPage from '@/features/platform/SchoolsPage';

export default function Page() {
  return (
    <RequireAuth roles={['super_admin']}>
      <SchoolsPage />
    </RequireAuth>
  );
}
