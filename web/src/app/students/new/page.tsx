'use client';

import RequireAuth from '@/components/RequireAuth';
import StudentForm from '@/features/setup/student-form/StudentForm';

export default function NewAdmissionPage() {
  return (
    <RequireAuth roles={['super_admin', 'branch_admin']}>
      <StudentForm mode="create" />
    </RequireAuth>
  );
}
