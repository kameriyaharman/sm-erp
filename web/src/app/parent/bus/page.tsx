'use client';

import { Suspense } from 'react';
import RequireAuth from '@/components/RequireAuth';
import { FAMILY, ParentScreen } from '@/features/parent/ParentLayout';
import BusScreen from '@/features/parent/BusScreen';

export default function ParentBusPage() {
  return (
    <RequireAuth roles={FAMILY} shell={false}>
      <Suspense>
        <ParentScreen active="bus" title="School bus">
          {({ home, data }) => <BusScreen home={home} schoolPhone={data.schoolPhone} />}
        </ParentScreen>
      </Suspense>
    </RequireAuth>
  );
}
