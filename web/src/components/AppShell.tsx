'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Award,
  Bell,
  BookOpenCheck,
  Bus,
  CalendarCheck,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  FileBadge,
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
import { apiGet, logout, ROLE_LABEL, type Role, type SessionUser } from '@/lib/session';
import { useTeacherScope } from '@/lib/access';
import GlobalSearch from './GlobalSearch';
import UserMenu from './UserMenu';

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles: Role[];
  /** Teachers only see it when they are a class teacher (admins always). */
  classTeacherOnly?: boolean;
};
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
      { href: '/teacher/class', label: 'My classes', icon: Users, roles: ['teacher'] },
    ],
  },
  {
    label: 'Attendance',
    items: [
      { href: '/teacher/attendance', label: 'Mark attendance', icon: CalendarCheck, roles: STAFF, classTeacherOnly: true },
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
      { href: '/teacher/timetable', label: 'My timetable', icon: CalendarDays, roles: ['teacher'] },
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

/** School / branch names for the sidebar header; fetched once per tab when the session lacks them. */
let schoolCache: { schoolName: string | null; branchName: string | null } | null = null;
function useSchool(user: SessionUser) {
  const [school, setSchool] = useState(() => schoolCache ?? { schoolName: user.schoolName ?? null, branchName: user.branchName ?? null });
  useEffect(() => {
    if (school.schoolName || schoolCache) return;
    let cancelled = false;
    apiGet<{ data: { schoolName?: string | null; branchName?: string | null } }>('/auth/me')
      .then((me) => {
        schoolCache = { schoolName: me.data.schoolName ?? null, branchName: me.data.branchName ?? null };
        if (!cancelled) setSchool(schoolCache);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [school.schoolName]);
  return school;
}

function monogram(name: string | null): string {
  if (!name) return 'SM';
  const words = name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && !/^(of|the|and)$/i.test(w));
  return (words.length >= 2 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
}

export default function AppShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const [open, setOpen] = useState(false);
  const school = useSchool(user);
  // A teacher who is not a class teacher has no register to mark: hide that item once we know.
  const { scope } = useTeacherScope(user.role === 'teacher');
  const notClassTeacher = user.role === 'teacher' && scope !== null && !scope.isClassTeacher;
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.roles.includes(user.role) && !(i.classTeacherOnly && notClassTeacher)) })).filter((g) => g.items.length);
  const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
  const initials = `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase();
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ');

  // Where am I: group, item, and whether this is a detail page under the item.
  const current = groups.flatMap((g) => g.items.map((i) => ({ group: g.label, item: i }))).find(({ item }) => isActive(pathname, item.href, hrefs));
  const isDetail = Boolean(current && pathname !== current.item.href);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  async function signOut() {
    setLeaving(true);
    await logout();
    router.replace('/login');
  }

  const nav = (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pb-4 pt-3 [scrollbar-color:theme(colors.ink.800)_transparent]">
      {groups.map((group) => (
        <div key={group.label ?? 'top'} className="mt-3.5 first:mt-0">
          {group.label && <p className="mb-0.5 px-3 text-xs font-medium text-ink-muted">{group.label}</p>}
          <ul className="space-y-px">
            {group.items.map(({ href, label, icon: Icon }) => {
              const active = isActive(pathname, href, hrefs);
              return (
                <li key={href} className="relative">
                  {active && <span aria-hidden className="absolute -left-3 top-1.5 h-5 w-[3px] rounded-r-full bg-marigold-400" />}
                  <Link
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={`flex h-8 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-marigold-300 ${
                      active ? 'bg-ink-800 text-white' : 'text-ink-text hover:bg-ink-900 hover:text-white'
                    }`}
                  >
                    <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? 'text-white' : 'text-ink-muted'}`} strokeWidth={1.9} aria-hidden />
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
    <Link href="/" className="group flex min-w-0 items-center gap-3 rounded-lg focus-visible:outline-marigold-300">
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink-800 text-[13px] font-semibold tracking-tight text-white ring-1 ring-inset ring-white/10">
        {monogram(school.schoolName)}
        <span aria-hidden className="absolute inset-x-2 bottom-1 h-[2px] rounded-full bg-marigold-400" />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-sm font-semibold text-white">{school.schoolName ?? 'SM ERP'}</span>
        <span className="block truncate text-xs text-ink-muted">{school.branchName ?? 'School office'}</span>
      </span>
    </Link>
  );

  const account = (
    <div className="border-t border-white/[0.06] p-3">
      <div className="flex items-center gap-3 rounded-lg bg-white/[0.04] px-2.5 py-2">
        <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-400/25 text-xs font-semibold text-white">
          {initials}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-medium text-white">{name}</p>
          <p className="truncate text-xs text-ink-muted">{ROLE_LABEL[user.role]}</p>
        </div>
        <button
          type="button"
          onClick={signOut}
          disabled={leaving}
          aria-label="Sign out"
          title="Sign out"
          className="flex h-8 w-8 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-marigold-300 disabled:opacity-60"
        >
          <LogOut className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );

  const sidebar = (
    <>
      <div className="flex h-16 shrink-0 items-center border-b border-white/[0.06] px-4">{brand}</div>
      {nav}
      {account}
    </>
  );

  return (
    <div className="min-h-dvh lg:pl-[248px]" data-shell-content>
      {/* desktop sidebar */}
      <aside data-shell-chrome className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col bg-ink-950 lg:flex">
        {sidebar}
      </aside>

      {/* mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" data-shell-chrome>
          <div className="absolute inset-0 animate-fade-in bg-ink-950/50" onClick={() => setOpen(false)} />
          <aside aria-label="Menu" className="absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] animate-drawer-in flex-col bg-ink-950 shadow-pop">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="absolute right-2 top-3.5 z-10 rounded-lg p-2 text-ink-muted hover:bg-white/[0.06] hover:text-white focus-visible:outline-marigold-300"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      {/* top bar */}
      <header data-shell-chrome className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
        <div className="flex h-14 items-center gap-2 px-3 sm:px-4 lg:gap-4 lg:px-8">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="-ml-1 rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5 lg:hidden"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm lg:flex-none lg:basis-[280px]">
            {current?.group && (
              <>
                <span className="hidden shrink-0 text-slate-500 dark:text-slate-400 sm:inline">{current.group}</span>
                <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-slate-300 dark:text-slate-600 sm:inline" aria-hidden />
              </>
            )}
            {current ? (
              isDetail ? (
                <>
                  <Link href={current.item.href} className="truncate text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
                    {current.item.label}
                  </Link>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300 dark:text-slate-600" aria-hidden />
                  <span className="truncate font-medium text-slate-900 dark:text-white">Details</span>
                </>
              ) : (
                <span className="truncate font-medium text-slate-900 dark:text-white">{current.item.label}</span>
              )
            ) : (
              <span className="truncate font-medium text-slate-900 dark:text-white">{school.schoolName ?? 'SM ERP'}</span>
            )}
          </div>
          <div className="flex flex-1 justify-end lg:justify-center">
            <GlobalSearch role={user.role} />
          </div>
          <div className="flex items-center gap-1 lg:basis-[280px] lg:justify-end">
            <Link
              href="/notices"
              aria-label="Notice board"
              title="Notice board"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white"
            >
              <Bell className="h-[18px] w-[18px]" aria-hidden />
            </Link>
            <UserMenu user={user} schoolName={school.schoolName} branchName={school.branchName} initials={initials} name={name} onSignOut={signOut} leaving={leaving} />
          </div>
        </div>
      </header>

      <div className="min-w-0">{children}</div>
    </div>
  );
}
