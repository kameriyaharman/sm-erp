'use client';

import { Suspense } from 'react';
import RequireAuth from '@/components/RequireAuth';
import { FAMILY, ParentScreen } from '@/features/parent/ParentLayout';
import NotificationsScreen from '@/features/parent/NotificationsScreen';

export default function ParentNotificationsPage() {
  return (
    <RequireAuth roles={FAMILY} shell={false}>
      <Suspense>
        <ParentScreen active={null} title="Notices" back="/parent" unread={0} hideSwitcher>
          {() => <NotificationsScreen />}
        </ParentScreen>
      </Suspense>
    </RequireAuth>
  );
}
