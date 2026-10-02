'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Hammer } from 'lucide-react';
import RequireAuth from '@/components/RequireAuth';

const TITLES: Record<string, string> = {
  fees: 'Fees and payments',
  academics: 'Academics',
  'report-card': 'Report cards',
  homework: 'Homework',
  bus: 'School bus',
  notifications: 'Notifications',
};

export default function ComingSoon() {
  const params = useParams<{ section: string[] }>();
  const title = TITLES[params.section?.[0] ?? ''] ?? 'This section';
  return (
    <RequireAuth roles={['parent']} shell={false}>
      <main className="mx-auto max-w-md px-5 py-6">
        <Link href="/parent" className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-600 dark:text-stone-300">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Home
        </Link>
        <div className="mt-16 text-center">
          <Hammer className="mx-auto h-8 w-8 text-stone-400" aria-hidden />
          <h1 className="mt-4 text-lg font-semibold">{title}</h1>
          <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">This screen is being built. The home screen already shows dues, today&apos;s attendance and report cards.</p>
        </div>
      </main>
    </RequireAuth>
  );
}
