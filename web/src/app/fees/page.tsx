'use client';

import { useMemo } from 'react';
import FeeCollectionTable from '@/features/fees/FeeCollectionTable';
import { createFeesApi } from '@/features/fees/api';
import RequireAuth from '@/components/RequireAuth';
import { API_BASE, getAccessToken } from '@/lib/session';

function Fees() {
  const api = useMemo(
    () => createFeesApi({ baseUrl: API_BASE, getAccessToken, onUnauthorized: () => window.location.assign('/login?next=/fees') }),
    [],
  );
  return (
    <main className="min-h-full px-4 py-6 sm:px-8 sm:py-8">
      <div className="mx-auto max-w-[1440px]">
        <FeeCollectionTable api={api} />
      </div>
    </main>
  );
}

export default function FeesPage() {
  return (
    <RequireAuth roles={['super_admin', 'branch_admin']}>
      <Fees />
    </RequireAuth>
  );
}
