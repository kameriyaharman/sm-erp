'use client';

import { Suspense } from 'react';
import RequireAuth from '@/components/RequireAuth';
import { FAMILY, ParentScreen } from '@/features/parent/ParentLayout';
import HomeworkScreen from '@/features/parent/HomeworkScreen';

export default function ParentHomeworkPage() {
  return (
    <RequireAuth roles={FAMILY} shell={false}>
      <Suspense>
        <ParentScreen active={null} title="Homework" back="/parent">
          {({ home }) => <HomeworkScreen home={home} />}
        </ParentScreen>
      </Suspense>
    </RequireAuth>
  );
}
