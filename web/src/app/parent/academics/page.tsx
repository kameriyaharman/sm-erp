'use client';

import { Suspense } from 'react';
import RequireAuth from '@/components/RequireAuth';
import { ParentScreen } from '@/features/parent/ParentLayout';
import AcademicsScreen from '@/features/parent/AcademicsScreen';

export default function ParentAcademicsPage() {
  return (
    <RequireAuth roles={['parent']} shell={false}>
      <Suspense>
        <ParentScreen active="academics" title="Academics">
          {({ home }) => <AcademicsScreen home={home} />}
        </ParentScreen>
      </Suspense>
    </RequireAuth>
  );
}
