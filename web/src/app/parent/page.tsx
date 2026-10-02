'use client';

import { Suspense } from 'react';
import ParentHome, { urgentChildId } from '@/features/parent/ParentHome';
import { ErrorBlock, Skeleton, useParentHome, useSelectedChild } from '@/features/parent/ParentLayout';
import RequireAuth from '@/components/RequireAuth';

function Home() {
  const { data, error, reload } = useParentHome();
  const { childId, select } = useSelectedChild(data ? data.children.map((c) => c.child) : null, data ? urgentChildId(data) : undefined);

  if (error) {
    return (
      <div className="mx-auto max-w-md px-6 py-20">
        <ErrorBlock message={error} onRetry={reload} />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-5 py-6" role="status" aria-label="Loading">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-28" />
        <Skeleton className="h-48" />
      </div>
    );
  }
  return <ParentHome data={data} childId={childId} onSelectChild={select} />;
}

export default function ParentHomePage() {
  return (
    <RequireAuth roles={['parent']} shell={false}>
      <Suspense>
        <Home />
      </Suspense>
    </RequireAuth>
  );
}
