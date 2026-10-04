'use client';

import { useParams } from 'next/navigation';
import RequireAuth from '@/components/RequireAuth';
import { ErrorState, Spinner } from '@/components/ui';
import { useApi } from '@/lib/useApi';
import StudentForm from '@/features/setup/student-form/StudentForm';
import type { StudentDetail, Wrapped } from '@/features/admin/types';

function EditStudent() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useApi<Wrapped<StudentDetail>>(`/students/${id}`);
  if (loading && !data) return <Spinner label="Loading student…" />;
  if (error || !data) return <ErrorState message={error ?? 'Student not found'} onRetry={reload} />;
  return <StudentForm key={data.data.id} mode="edit" student={data.data} />;
}

export default function EditStudentPage() {
  return (
    <RequireAuth roles={['super_admin', 'branch_admin']}>
      <EditStudent />
    </RequireAuth>
  );
}
