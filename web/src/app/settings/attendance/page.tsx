'use client';

import RequireAuth from '@/components/RequireAuth';
import AttendanceSettingsPage from '@/features/settings/AttendanceSettingsPage';

export default function Page() {
  return (
    <RequireAuth roles={['super_admin', 'branch_admin']}>
      <AttendanceSettingsPage />
    </RequireAuth>
  );
}
