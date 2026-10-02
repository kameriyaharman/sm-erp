'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/** Old "report card" links open the Report cards tab of Academics for the same child. */
function Redirect() {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    const next = new URLSearchParams({ tab: 'report-cards' });
    const child = params.get('child');
    if (child) next.set('child', child);
    router.replace(`/parent/academics?${next.toString()}`);
  }, [params, router]);
  return null;
}

export default function ReportCardRedirect() {
  return (
    <Suspense>
      <Redirect />
    </Suspense>
  );
}
