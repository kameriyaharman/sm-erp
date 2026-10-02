'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Award,
  BookOpenCheck,
  Bus,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  FileBadge,
  GraduationCap,
  History,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  MessageSquareText,
  Receipt,
  TriangleAlert,
  UserCog,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { logout, ROLE_LABEL, type Role, type SessionUser } from '@/lib/session';

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard; roles: Role[] };
type NavGroup = { label: string | null; items: NavItem[] };

const ADMINS: Role[] = ['super_admin', 'branch_admin'];
const STAFF: Role[] = ['super_admin', 'branch_admin', 'teacher'];

/** One list for every staff role; each user sees only the items their role can open. */
export const NAV: NavGroup[] = [
  {
    label: null,
    items: [{ href: '/dashboard', label: 'Overview', icon: LayoutDashboard, roles: ADMINS }],
  },
  {
    label: 'People',
    items: [
      { href: '/students', label: 'Students', icon: Users, roles: ADMINS },
      { href: '/staff', label: 'Staff', icon: UserCog, roles: ADMINS },
      { href: '/teacher/class', label: 'My class', icon: Users, roles: ['teacher'] },
    ],
  },
  {
    label: 'Attendance',
    items: [
      { href: '/teacher/attendance', label: 'Mark attendance', icon: CalendarCheck, roles: STAFF },
      { href: '/attendance/history', label: 'Attendance history', icon: History, roles: STAFF },
    ],
  },
  {
    label: 'Finance',
    items: [
      { href: '/fees', label: 'Fee collection', icon: Receipt, roles: ADMINS },
      { href: '/fees/defaulters', label: 'Defaulters', icon: TriangleAlert, roles: ADMINS },
      { href: '/expenses', label: 'Expenses', icon: Wallet, roles: ADMINS },
    ],
  },
  {
    label: 'Academics',
    items: [
      { href: '/exams', label: 'Exams & marks', icon: ClipboardList, roles: ADMINS },
      { href: '/teacher/marks', label: 'Marks entry', icon: ClipboardList, roles: ['teacher'] },
      { href: '/report-cards', label: 'Report cards', icon: Award, roles: ADMINS },
      { href: '/timetable', label: 'Timetable', icon: CalendarDays, roles: ADMINS },
      { href: '/homework', label: 'Homework', icon: BookOpenCheck, roles: STAFF },
    ],
  },
  {
    label: 'Office',
    items: [
      { href: '/certificates', label: 'Certificates', icon: FileBadge, roles: ADMINS },
      { href: '/notices', label: 'Notices', icon: Megaphone, roles: STAFF },
      { href: '/transport', label: 'Transport', icon: Bus, roles: ADMINS },
      { href: '/notifications', label: 'SMS / WhatsApp log', icon: MessageSquareText, roles: ADMINS },
    ],
  },
];

function isActive(pathname: string, href: string, all: string[]) {
  if (pathname === href) return true;
  if (!pathname.startsWith(`${href}/`)) return false;
  // "/fees" must not light up on "/fees/defaulters", which has its own item.
  return !all.some((other) => other !== href && other.startsWith(`${href}/`) && (pathname === other || pathname.startsWith(`${other}/`)));
}

export default function AppShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const [open, setOpen] = useState(false);
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.roles.includes(user.role)) })).filter((g) => g.items.length);
  const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
  const initials = `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase();
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ');

  useEffect(() => setOpen(false), [pathname]);

  async function signOut() {
    setLeaving(true);
    await logout();
    router.replace('/login');
  }

  const nav = (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-4">
      {groups.map((group) => (
        <div key={group.label ?? 'top'} className="mb-4">
          {group.label && <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{group.label}</p>}
          <ul className="space-y-0.5">
            {group.items.map(({ href, label, icon: Icon }) => {
              const active = isActive(pathname, href, hrefs);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={`flex h-9 items-center gap-2.5 rounded-lg px-3 text-sm font-medium transition-colors ${
                      active
                        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="truncate">{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const brand = (
    <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
        <GraduationCap className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <span className="leading-tight">
        SM ERP
        {user.schoolName && <span className="block max-w-[150px] truncate text-[11px] font-normal text-slate-500 dark:text-slate-400">{user.schoolName}</span>}
      </span>
    </Link>
  );

  const account = (
    <div className="border-t border-slate-200 p-3 dark:border-slate-800">
      <div className="flex items-center gap-3 px-1">
        <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200">
          {initials}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{ROLE_LABEL[user.role]}</p>
        </div>
        <button
          type="button"
          onClick={signOut}
          disabled={leaving}
          title="Sign out"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          <span className="sr-only sm:not-sr-only">{leaving ? 'Signing out…' : 'Sign out'}</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:pl-60">
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:flex">
        <div className="flex h-14 items-center px-5">{brand}</div>
        {nav}
        {account}
      </aside>

      {/* mobile top bar + drawer */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 lg:hidden">
        <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
          <Menu className="h-5 w-5" aria-hidden />
        </button>
        {brand}
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl dark:bg-slate-900">
            <div className="flex h-14 items-center justify-between px-4">
              {brand}
              <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            {nav}
            {account}
          </aside>
        </div>
      )}

      <div className="min-w-0">{children}</div>
    </div>
  );
}
