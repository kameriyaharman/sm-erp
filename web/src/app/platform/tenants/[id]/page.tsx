'use client';

import { useParams } from 'next/navigation';
import RequireAuth from '@/components/RequireAuth';
import SchoolDetail from '@/features/platform/SchoolDetail';

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return (
    <RequireAuth roles={['super_admin']}>
      <SchoolDetail id={id} />
    </RequireAuth>
  );
}
