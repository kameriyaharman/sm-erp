'use client';

import RequireAuth from '@/components/RequireAuth';
import type { Role } from '@/lib/session';
import AttendanceHistory from '@/features/attendance/AttendanceHistory';

const ROLES: Role[] = ['super_admin', 'branch_admin', 'teacher'];

export default function AttendanceHistoryPage() {
  return (
    <RequireAuth roles={ROLES}>
      <AttendanceHistory />
    </RequireAuth>
  );
}
