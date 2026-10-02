'use client';

import Link from 'next/link';
import { CalendarCheck, FileBadge, IndianRupee, Megaphone, UserPlus, Wallet, type LucideIcon } from 'lucide-react';
import type { AttendanceSection } from '@/features/admin/types';

const ACTIONS: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: '/students?new=1', label: 'New admission', icon: UserPlus },
  { href: '/fees', label: 'Collect fee', icon: IndianRupee },
  { href: '/teacher/attendance', label: 'Mark attendance', icon: CalendarCheck },
  { href: '/notices?new=1', label: 'Post notice', icon: Megaphone },
  { href: '/certificates?new=1', label: 'Issue certificate', icon: FileBadge },
  { href: '/expenses?new=1', label: 'Add expense', icon: Wallet },
];

export function QuickActions() {
  return (
    <nav aria-label="Quick actions" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {ACTIONS.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium shadow-sm transition-colors hover:border-indigo-300 hover:bg-indigo-50/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-500/40 dark:hover:bg-indigo-500/10"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700 group-hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <span className="leading-tight">{label}</span>
        </Link>
      ))}
    </nav>
  );
}

/** Today's registers: which sections have been marked and the present count. */
export function TodayAttendance({ sections }: { sections: AttendanceSection[] }) {
  const taken = sections.filter((s) => s.submission);
  const present = taken.reduce((n, s) => n + (s.submission?.present ?? 0), 0);
  const marked = taken.reduce((n, s) => n + (s.submission?.total ?? 0), 0);
  const pct = marked ? (present / marked) * 100 : null;
  return (
    <section aria-labelledby="today-att" className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-4 dark:border-slate-800">
        <div>
          <h2 id="today-att" className="text-base font-semibold">
            Today&apos;s attendance
          </h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            {taken.length} of {sections.length} registers taken
            {pct !== null && (
              <>
                {' '}
                · <span className="font-medium tabular-nums text-slate-700 dark:text-slate-200">{pct.toFixed(1)}%</span> present ({present}/{marked})
              </>
            )}
          </p>
        </div>
        <Link href="/attendance/history" className="text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white">
          History
        </Link>
      </div>
      {sections.length === 0 ? (
        <p className="px-6 py-6 text-sm text-slate-500">No sections set up for this year.</p>
      ) : (
        <ul className="flex flex-wrap gap-2 px-6 py-4">
          {sections.map((s) => (
            <li
              key={s.id}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ring-1 ring-inset ${
                s.submission
                  ? 'bg-emerald-50 text-emerald-900 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-500/25'
                  : 'bg-amber-50 text-amber-900 ring-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/25'
              }`}
            >
              <span className="font-medium">{s.label}</span>
              <span className="tabular-nums text-xs">{s.submission ? `${s.submission.present}/${s.submission.total} present` : 'Not taken'}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
