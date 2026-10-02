'use client';

import { useMemo } from 'react';
import AttendanceGrid from '@/features/attendance/AttendanceGrid';
import { createAttendanceApi } from '@/features/attendance/api';
import RequireAuth from '@/components/RequireAuth';
import { API_BASE, getAccessToken } from '@/lib/session';

function Attendance() {
  const api = useMemo(
    () => createAttendanceApi({ baseUrl: API_BASE, getAccessToken, onUnauthorized: () => window.location.assign('/login?next=/teacher/attendance') }),
    [],
  );
  return (
    <main className="px-4 py-5 sm:px-6 sm:py-8">
      <AttendanceGrid api={api} />
    </main>
  );
}

export default function TeacherAttendancePage() {
  return (
    <RequireAuth roles={['teacher', 'branch_admin', 'super_admin']}>
      <Attendance />
    </RequireAuth>
  );
}
