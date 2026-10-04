'use client';

import RequireAuth from '@/components/RequireAuth';
import Content from '@/features/setup/academic/AcademicPage';

export default function Page() {
  return (
    <RequireAuth roles={['super_admin', 'branch_admin']}>
      <Content />
    </RequireAuth>
  );
}
