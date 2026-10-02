'use client';

import RequireAuth from '@/components/RequireAuth';

export default function NoAccess() {
  return (
    <RequireAuth roles={['student']}>
      <main className="mx-auto max-w-lg px-6 py-20 text-center">
        <h1 className="text-xl font-semibold">Nothing here yet</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">The student app is coming soon. Your parents can see fees, attendance and report cards in the parent app.</p>
      </main>
    </RequireAuth>
  );
}
