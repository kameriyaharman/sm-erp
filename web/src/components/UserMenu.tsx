'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, LogOut, UserRound } from 'lucide-react';
import { ROLE_LABEL, type SessionUser } from '@/lib/session';

/** Avatar button in the top bar with the signed-in person's details and Sign out. */
export default function UserMenu({
  user,
  name,
  initials,
  schoolName,
  branchName,
  onSignOut,
  leaving,
}: {
  user: SessionUser;
  name: string;
  initials: string;
  schoolName: string | null;
  branchName: string | null;
  onSignOut: () => void;
  leaving: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex h-9 items-center gap-1.5 rounded-lg pl-1 pr-1.5 transition-colors hover:bg-slate-100 dark:hover:bg-white/5"
      >
        <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-900 text-[11px] font-semibold text-white ring-2 ring-surface dark:bg-indigo-500/30">
          {initials}
        </span>
        <ChevronDown className="hidden h-3.5 w-3.5 text-slate-400 sm:block" aria-hidden />
      </button>
      {open && (
        <div role="menu" aria-label="Account" className="absolute right-0 top-[calc(100%+6px)] z-40 w-64 animate-fade-in overflow-hidden rounded-xl border border-line bg-surface shadow-float">
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{name}</p>
            <p className="truncate text-13 text-slate-500 dark:text-slate-400">{user.email ?? user.username ?? ROLE_LABEL[user.role]}</p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <span className="inline-flex h-6 items-center rounded-full bg-indigo-50 px-2.5 text-xs font-medium text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-200">{ROLE_LABEL[user.role]}</span>
            </div>
            {schoolName && (
              <p className="mt-2.5 truncate text-13 text-slate-600 dark:text-slate-300">
                {schoolName}
                {branchName && <span className="text-slate-400">, {branchName}</span>}
              </p>
            )}
          </div>
          <div className="p-1.5">
            {(user.role === 'super_admin' || user.role === 'branch_admin' || user.role === 'teacher') && (
              <Link
                href="/settings/account"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/5"
              >
                <UserRound className="h-4 w-4 text-slate-400" aria-hidden />
                My account
              </Link>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={onSignOut}
              disabled={leaving}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-60 dark:text-slate-200 dark:hover:bg-white/5"
            >
              <LogOut className="h-4 w-4 text-slate-400" aria-hidden />
              {leaving ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
