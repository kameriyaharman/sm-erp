'use client';

import { Suspense } from 'react';
import RequireAuth from '@/components/RequireAuth';
import { ParentScreen } from '@/features/parent/ParentLayout';
import FeesScreen from '@/features/parent/FeesScreen';

export default function ParentFeesPage() {
  return (
    <RequireAuth roles={['parent']} shell={false}>
      <Suspense>
        <ParentScreen active="fees" title="Fees and payments">
          {({ home }) => <FeesScreen home={home} />}
        </ParentScreen>
      </Suspense>
    </RequireAuth>
  );
}
