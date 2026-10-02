'use client';

import { Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import FeeCollectionTable from '@/features/fees/FeeCollectionTable';
import { createFeesApi, type ListStudentsParams } from '@/features/fees/api';
import RequireAuth from '@/components/RequireAuth';
import { Spinner } from '@/components/ui';
import { API_BASE, getAccessToken } from '@/lib/session';

const STATUSES = ['all', 'pending', 'overdue', 'paid'] as const;
type Status = NonNullable<ListStudentsParams['status']>;

function Fees() {
  const params = useSearchParams();
  const api = useMemo(
    () => createFeesApi({ baseUrl: API_BASE, getAccessToken, onUnauthorized: () => window.location.assign('/login?next=/fees') }),
    [],
  );
  // Links from other screens: /fees?search=DPS-1015 or /fees?status=overdue
  const search = params.get('search') ?? '';
  const rawStatus = params.get('status');
  const status: Status = (STATUSES as readonly string[]).includes(rawStatus ?? '') ? (rawStatus as Status) : 'all';
  return (
    <main className="min-h-full px-4 py-6 sm:px-8 sm:py-8">
      <div className="mx-auto max-w-[1440px]">
        <FeeCollectionTable key={`${search}|${status}`} api={api} initialSearch={search} initialStatus={status} />
      </div>
    </main>
  );
}

export default function FeesPage() {
  return (
    <RequireAuth roles={['super_admin', 'branch_admin']}>
      <Suspense fallback={<Spinner />}>
        <Fees />
      </Suspense>
    </RequireAuth>
  );
}
