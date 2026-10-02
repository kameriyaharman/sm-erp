'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { CalendarCheck, GraduationCap, LayoutDashboard, LogOut, Receipt, Users } from 'lucide-react';
import { logout, ROLE_LABEL, type Role, type SessionUser } from '@/lib/session';

const NAV: Array<{ href: string; label: string; icon: typeof LayoutDashboard; roles: Role[] }> = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard, roles: ['super_admin', 'branch_admin'] },
  { href: '/fees', label: 'Fee collection', icon: Receipt, roles: ['super_admin', 'branch_admin'] },
  { href: '/teacher/attendance', label: 'Attendance', icon: CalendarCheck, roles: ['teacher', 'branch_admin', 'super_admin'] },
  { href: '/parent', label: 'My children', icon: Users, roles: ['parent'] },
];

export default function AppShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const items = NAV.filter((n) => n.roles.includes(user.role));
  const initials = `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase();

  async function signOut() {
    setLeaving(true);
    await logout();
    router.replace('/login');
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-4 px-4 sm:px-8">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <GraduationCap className="h-[18px] w-[18px]" aria-hidden />
            </span>
            <span className="hidden sm:inline">SM ERP</span>
          </Link>
          <nav aria-label="Main" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {items.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  <span className={items.length > 2 ? 'hidden md:inline' : ''}>{label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-3">
            <div className="hidden text-right leading-tight sm:block">
              <p className="text-sm font-medium">{[user.firstName, user.lastName].filter(Boolean).join(' ')}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{ROLE_LABEL[user.role]}</p>
            </div>
            <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200">
              {initials}
            </span>
            <button
              type="button"
              onClick={signOut}
              disabled={leaving}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">{leaving ? 'Signing out…' : 'Sign out'}</span>
            </button>
          </div>
        </div>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}
