'use client';

import { Suspense } from 'react';
import RequireAuth from '@/components/RequireAuth';
import { FAMILY, ParentScreen } from '@/features/parent/ParentLayout';
import FeesScreen from '@/features/parent/FeesScreen';

export default function ParentFeesPage() {
  return (
    <RequireAuth roles={FAMILY} shell={false}>
      <Suspense>
        <ParentScreen active="fees" title="Fees and payments">
          {({ home, data }) => <FeesScreen home={home} self={data.viewer === 'student'} />}
        </ParentScreen>
      </Suspense>
    </RequireAuth>
  );
}
