'use client';

import RequireAuth from '@/components/RequireAuth';
import Content from '@/features/setup/AccountPage';

export default function Page() {
  return (
    <RequireAuth roles={['super_admin', 'branch_admin', 'teacher']}>
      <Content />
    </RequireAuth>
  );
}
