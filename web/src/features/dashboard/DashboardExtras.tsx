'use client';

import Link from 'next/link';
import { CalendarCheck, CircleCheck, Clock, FileBadge, IndianRupee, Megaphone, UserPlus, Wallet, type LucideIcon } from 'lucide-react';
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
    <nav aria-label="Quick actions" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max flex-wrap gap-2 sm:min-w-0">
        {ACTIONS.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-13 font-medium text-slate-700 transition-colors hover:border-indigo-200 hover:bg-indigo-50/60 hover:text-indigo-800 dark:text-slate-200 dark:hover:border-indigo-400/30 dark:hover:bg-indigo-400/10 dark:hover:text-indigo-100"
            >
              <Icon className="h-4 w-4 text-indigo-600 dark:text-indigo-300" aria-hidden />
              {label}
            </Link>
          </li>
        ))}
      </ul>
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
    <section aria-labelledby="today-att" className="rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 id="today-att" className="text-[15px] font-semibold text-slate-900 dark:text-white">
            Today&apos;s attendance
          </h2>
          <p className="mt-0.5 text-13 text-slate-500 dark:text-slate-400">
            {taken.length} of {sections.length} registers taken
            {pct !== null && (
              <>
                , <span className="font-medium tabular-nums text-slate-700 dark:text-slate-200">{pct.toFixed(1)}%</span> present ({present}/{marked})
              </>
            )}
          </p>
        </div>
        <Link href="/attendance/history" className="rounded-md px-2 py-1 text-13 font-medium text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-400/10">
          History
        </Link>
      </div>
      {sections.length === 0 ? (
        <p className="px-5 py-6 text-sm text-slate-500">No sections set up for this year.</p>
      ) : (
        <ul className="divide-y divide-line">
          {sections.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
              {s.submission ? (
                <CircleCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
              ) : (
                <Clock className="h-4 w-4 shrink-0 text-marigold-500" aria-hidden />
              )}
              <span className="flex-1 font-medium text-slate-800 dark:text-slate-100">{s.label}</span>
              <span className={`tabular-nums text-13 ${s.submission ? 'text-slate-600 dark:text-slate-300' : 'text-marigold-700 dark:text-marigold-300'}`}>
                {s.submission ? `${s.submission.present}/${s.submission.total} present` : 'Not taken'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
