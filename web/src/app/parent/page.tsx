'use client';

import { useCallback, useEffect, useState } from 'react';
import ParentHome from '@/features/parent/ParentHome';
import type { ParentHomeData } from '@/features/parent/types';
import RequireAuth from '@/components/RequireAuth';
import { apiGet } from '@/lib/session';

function Home() {
  const [data, setData] = useState<ParentHomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    apiGet<{ data: ParentHomeData }>('/parent/home').then((r) => setData(r.data), (e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  if (error) {
    return (
      <div className="mx-auto max-w-md px-6 py-20 text-center">
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        <button type="button" onClick={load} className="mt-4 rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium dark:border-stone-700">Try again</button>
      </div>
    );
  }
  if (!data) return <div className="mx-auto max-w-2xl px-5 py-6"><div className="h-48 animate-pulse rounded-2xl bg-stone-200/70 dark:bg-stone-800" /></div>;
  return <ParentHome data={data} />;
}

export default function ParentHomePage() {
  return (
    <RequireAuth roles={['parent']} shell={false}>
      <Home />
    </RequireAuth>
  );
}
