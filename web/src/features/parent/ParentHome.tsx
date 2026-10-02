'use client';

import { useMemo, useState, type ComponentType, type ReactNode, type SVGProps } from 'react';
import {
  Bell,
  BookOpenCheck,
  Bus,
  CalendarDays,
  ChevronDown,
  CircleAlert,
  Clock,
  FileText,
  GraduationCap,
  House,
  IndianRupee,
  NotebookPen,
  Paperclip,
  Phone,
  User,
  UserX,
  Wallet,
  X,
} from 'lucide-react';
import type { ChildHome, HomeworkItem, Period, ParentHomeData } from './types';

/* ============================================================================
 * Parent portal home (PWA)
 * Phone-first: a sticky app bar, urgent alerts first, four quick actions, then
 * today's timetable and homework, with a bottom tab bar clear of the home
 * indicator. On wider screens the column grows and the tiles go four across.
 * ========================================================================== */

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

export interface ParentHomeLinks {
  payFees: (childId: string) => string;
  reportCard: (childId: string) => string;
  homework: (childId: string) => string;
  bus: (childId: string) => string;
  notifications: string;
  tabs: { home: string; fees: string; academics: string; bus: string; profile: string };
}

const DEFAULT_LINKS: ParentHomeLinks = {
  payFees: (id) => `/parent/fees?child=${id}`,
  reportCard: (id) => `/parent/report-card?child=${id}`,
  homework: (id) => `/parent/homework?child=${id}`,
  bus: (id) => `/parent/bus?child=${id}`,
  notifications: '/parent/notifications',
  tabs: { home: '/parent', fees: '/parent/fees', academics: '/parent/academics', bus: '/parent/bus', profile: '/parent/profile' },
};

export interface ParentHomeProps {
  data: ParentHomeData;
  /** Injected clock, for tests and previews. */
  now?: Date;
  links?: Partial<ParentHomeLinks>;
  unreadNotifications?: number;
  onSelectChild?: (childId: string) => void;
}

/* ---------------------------------------------------------------- formatting */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FULL_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

const rupees = (value: string) => Number(value);
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function parseDay(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
const shortDate = (iso: string) => {
  const d = parseDay(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};
const timeOf = (isoTs: string) => new Date(isoTs).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
function to12h(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}`;
}
const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
function daysUntil(iso: string, today: Date) {
  return Math.round((parseDay(iso).getTime() - parseDay(isoDay(today)).getTime()) / 86_400_000);
}
function relativeAgo(isoTs: string, now: Date) {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(isoTs).getTime()) / 60_000));
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
function greeting(now: Date) {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/* ============================================================================ */

export default function ParentHome({ data, now = new Date(), links: linkOverrides, unreadNotifications = 0, onSelectChild }: ParentHomeProps) {
  const links = { ...DEFAULT_LINKS, ...linkOverrides, tabs: { ...DEFAULT_LINKS.tabs, ...linkOverrides?.tabs } };
  // Open on the child who needs attention most.
  const initialChild = useMemo(() => {
    const urgent = data.children.find((c) => c.attendance.status === 'absent' || rupees(c.fee.overdue) > 0);
    return (urgent ?? data.children[0])?.child.id;
  }, [data.children]);
  const [childId, setChildId] = useState(initialChild);
  const home = data.children.find((c) => c.child.id === childId) ?? data.children[0];

  if (!home) {
    return (
      <AppShell links={links} unread={unreadNotifications} data={data} now={now}>
        <p className="px-5 py-16 text-center text-sm text-stone-500 dark:text-stone-400">No children are linked to your account yet. Contact the school office to link them.</p>
      </AppShell>
    );
  }

  function selectChild(id: string) {
    setChildId(id);
    onSelectChild?.(id);
  }

  return (
    <AppShell links={links} unread={unreadNotifications} data={data} now={now}>
      {data.children.length > 1 && (
        <ChildSwitcher children={data.children} selectedId={home.child.id} onSelect={selectChild} />
      )}

      <div className="flex flex-col gap-7 px-4 pb-6 pt-4 sm:px-6">
        <UrgentAlerts key={home.child.id} home={home} now={now} schoolPhone={data.schoolPhone} payHref={links.payFees(home.child.id)} />

        <section aria-labelledby="quick-actions">
          <h2 id="quick-actions" className="sr-only">
            Quick actions
          </h2>
          <QuickActions home={home} now={now} links={links} />
        </section>

        <Timetable key={`tt-${home.child.id}`} home={home} now={now} />

        <HomeworkList key={`hw-${home.child.id}`} home={home} now={now} allHref={links.homework(home.child.id)} />
      </div>
    </AppShell>
  );
}

/* ============================================================================
 * Shell: app bar + bottom tabs, with safe-area insets for installed PWAs
 * ========================================================================== */

function AppShell({ children, links, unread, data, now }: { children: ReactNode; links: ParentHomeLinks; unread: number; data: ParentHomeData; now: Date }) {
  const tabs: { key: keyof ParentHomeLinks['tabs']; label: string; icon: Icon }[] = [
    { key: 'home', label: 'Home', icon: House },
    { key: 'fees', label: 'Fees', icon: Wallet },
    { key: 'academics', label: 'Academics', icon: GraduationCap },
    { key: 'bus', label: 'Bus', icon: Bus },
    { key: 'profile', label: 'Profile', icon: User },
  ];

  return (
    <div className="flex min-h-dvh flex-col bg-stone-50 text-stone-900 antialiased [-webkit-tap-highlight-color:transparent] dark:bg-stone-950 dark:text-stone-100">
      <header
        className="sticky top-0 z-30 border-b border-stone-200/70 bg-stone-50/90 backdrop-blur-md dark:border-stone-800 dark:bg-stone-950/85"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-[#0b6b78] dark:text-[#5cc0cc]">{data.schoolName}</p>
            <p className="truncate text-base font-semibold leading-tight">
              {greeting(now)}, {data.parentName.split(' ')[0]}
            </p>
          </div>
          <a
            href={links.notifications}
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
            className="relative flex h-10 w-10 items-center justify-center rounded-full text-stone-600 transition-colors hover:bg-stone-200/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b78] dark:text-stone-300 dark:hover:bg-stone-800"
          >
            <Bell className="h-5 w-5" aria-hidden />
            {unread > 0 && (
              <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#d03b3b] px-1 text-[10px] font-bold text-white ring-2 ring-stone-50 dark:ring-stone-950">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </a>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1" style={{ paddingBottom: 'calc(4.5rem + env(safe-area-inset-bottom, 0px))' }}>
        {children}
      </main>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 backdrop-blur-md dark:border-stone-800 dark:bg-stone-900/95"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <ul className="mx-auto grid h-16 max-w-2xl grid-cols-5">
          {tabs.map(({ key, label, icon: TabIcon }) => {
            const active = key === 'home';
            return (
              <li key={key}>
                <a
                  href={links.tabs[key]}
                  aria-current={active ? 'page' : undefined}
                  className={[
                    'flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0b6b78]',
                    active ? 'text-[#0b6b78] dark:text-[#5cc0cc]' : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200',
                  ].join(' ')}
                >
                  <span className={`flex h-7 w-12 items-center justify-center rounded-full ${active ? 'bg-[#e3f1f2] dark:bg-[#0b6b78]/30' : ''}`}>
                    <TabIcon className="h-5 w-5" aria-hidden />
                  </span>
                  {label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

/* ============================================================================
 * Child switcher (siblings)
 * ========================================================================== */

function ChildSwitcher({ children, selectedId, onSelect }: { children: ChildHome[]; selectedId: string; onSelect: (id: string) => void }) {
  return (
    <div className="border-b border-stone-200/70 px-4 py-3 sm:px-6 dark:border-stone-800">
      <div role="radiogroup" aria-label="Choose child" className="flex gap-2 overflow-x-auto [scrollbar-width:none]">
        {children.map(({ child, attendance, fee }) => {
          const selected = child.id === selectedId;
          const needsAttention = attendance.status === 'absent' || rupees(fee.overdue) > 0;
          return (
            <button
              key={child.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onSelect(child.id)}
              className={[
                'flex shrink-0 items-center gap-2.5 rounded-full border py-1.5 pl-1.5 pr-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b78]',
                selected
                  ? 'border-[#0b6b78] bg-[#e3f1f2] dark:border-[#5cc0cc] dark:bg-[#0b6b78]/25'
                  : 'border-stone-200 bg-white hover:border-stone-300 dark:border-stone-700 dark:bg-stone-900',
              ].join(' ')}
            >
              <span className="relative">
                <Avatar name={child.name} selected={selected} />
                {needsAttention && (
                  <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-[#d03b3b] ring-2 ring-white dark:ring-stone-900" aria-hidden />
                )}
              </span>
              <span>
                <span className="block text-sm font-semibold leading-tight">{child.firstName}</span>
                <span className="block text-xs text-stone-500 dark:text-stone-400">
                  {child.className} {child.sectionName}
                  {needsAttention && <span className="sr-only">, needs attention</span>}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Avatar({ name, selected }: { name: string; selected?: boolean }) {
  // Siblings share a surname, so use the first two letters of the first name: "Aa", "An".
  const initials = (name.split(/\s+/)[0] ?? '').slice(0, 2);
  return (
    <span
      aria-hidden
      className={[
        'flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold',
        selected ? 'bg-[#0b6b78] text-white dark:bg-[#5cc0cc] dark:text-stone-950' : 'bg-stone-200 text-stone-700 dark:bg-stone-700 dark:text-stone-200',
      ].join(' ')}
    >
      {initials}
    </span>
  );
}

/* ============================================================================
 * Urgent alerts
 * ========================================================================== */

function UrgentAlerts({ home, now, schoolPhone, payHref }: { home: ChildHome; now: Date; schoolPhone: string | null; payHref: string }) {
  const [absenceAcknowledged, setAbsenceAcknowledged] = useState(false);
  const { child, attendance, fee } = home;

  const isToday = attendance.date === isoDay(now);
  const absentToday = isToday && attendance.status === 'absent' && !absenceAcknowledged;
  const overdue = rupees(fee.overdue);
  const due = rupees(fee.totalDue);
  const dueSoon = overdue === 0 && due > 0 && fee.nextDueDate !== null && daysUntil(fee.nextDueDate, now) <= 7;

  if (!absentToday && overdue === 0 && !dueSoon) return null;

  const teacher = child.classTeacher;
  const callNumber = teacher?.phone ?? schoolPhone;

  return (
    <section aria-label="Needs your attention" className="flex flex-col gap-3">
      {absentToday && (
        <Alert
          tone="critical"
          icon={UserX}
          title={`${child.firstName} is marked absent today`}
          onDismiss={() => setAbsenceAcknowledged(true)}
          dismissLabel="Mark as seen"
        >
          <p>
            Marked at {attendance.markedAt ? timeOf(attendance.markedAt) : 'roll call'} by the class teacher. If {child.firstName} is unwell or on leave, please let{' '}
            {teacher ? teacher.name : 'the school office'} know.
          </p>
          {callNumber && (
            <a
              href={telHref(callNumber)}
              className="mt-3 inline-flex items-center gap-3 rounded-xl bg-white py-2 pl-3 pr-4 text-left text-red-800 shadow-sm ring-1 ring-red-200 hover:bg-red-50 dark:bg-red-500/15 dark:text-red-100 dark:ring-red-400/30 dark:hover:bg-red-500/25"
            >
              <Phone className="h-4 w-4 shrink-0" aria-hidden />
              <span>
                <span className="block text-sm font-semibold leading-tight">Call {teacher?.phone ? 'class teacher' : 'school'}</span>
                <span className="block text-xs tabular-nums text-red-700/80 dark:text-red-200/80">{callNumber}</span>
              </span>
            </a>
          )}
        </Alert>
      )}

      {overdue > 0 && (
        <Alert tone="critical" icon={IndianRupee} title={`${inr.format(overdue)} fee overdue`}>
          <p>
            {fee.oldestOverdueDate ? `Unpaid since ${shortDate(fee.oldestOverdueDate)}. ` : ''}
            Total due for {child.firstName}: <span className="font-semibold tabular-nums">{inr.format(due)}</span>. Late fees may apply.
          </p>
          <a
            href={payHref}
            className="mt-3 inline-flex h-10 items-center gap-2 rounded-xl bg-[#0b6b78] px-4 text-sm font-semibold text-white shadow-sm hover:bg-[#095a65] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b78] focus-visible:ring-offset-2 dark:bg-[#5cc0cc] dark:text-stone-950 dark:hover:bg-[#7dd0da] dark:focus-visible:ring-offset-stone-950"
          >
            Pay {inr.format(due)} now
          </a>
        </Alert>
      )}

      {dueSoon && (
        <Alert tone="warning" icon={Clock} title={`${inr.format(due)} due ${daysUntil(fee.nextDueDate!, now) === 0 ? 'today' : `on ${shortDate(fee.nextDueDate!)}`}`}>
          <p>
            Pay before the due date to avoid a late fee.{' '}
            <a href={payHref} className="font-semibold underline underline-offset-2">
              Pay now
            </a>
          </p>
        </Alert>
      )}
    </section>
  );
}

function Alert({
  tone,
  icon: AlertIcon,
  title,
  children,
  onDismiss,
  dismissLabel,
}: {
  tone: 'critical' | 'warning';
  icon: Icon;
  title: string;
  children: ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
}) {
  const styles =
    tone === 'critical'
      ? { box: 'border-red-200 bg-red-50 text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100', icon: 'bg-[#d03b3b] text-white' }
      : { box: 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100', icon: 'bg-[#fab219] text-amber-950' };
  return (
    <div role={tone === 'critical' ? 'alert' : 'status'} className={`relative flex gap-3 rounded-2xl border p-4 ${styles.box}`}>
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${styles.icon}`} aria-hidden>
        <AlertIcon className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1 text-sm leading-relaxed">
        <p className="pr-8 text-[15px] font-semibold leading-snug">{title}</p>
        <div className="mt-1 opacity-90">{children}</div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel ?? 'Dismiss'}
          className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      )}
    </div>
  );
}

/* ============================================================================
 * Quick actions
 * ========================================================================== */

function QuickActions({ home, now, links }: { home: ChildHome; now: Date; links: ParentHomeLinks }) {
  const { child, fee, reportCard, homework, bus } = home;
  const due = rupees(fee.totalDue);
  const overdue = rupees(fee.overdue);
  const openHomework = homework.filter((h) => daysUntil(h.dueDate, now) >= 0).length;

  const busLine = (() => {
    if (!bus) return { text: 'Not using school bus', tone: 'muted' as const };
    switch (bus.state) {
      case 'to_school':
      case 'to_home':
        return bus.etaMinutes !== null
          ? { text: `Reaches your stop in ${bus.etaMinutes} min`, tone: 'live' as const }
          : { text: bus.state === 'to_school' ? 'On the way to school' : 'On the way home', tone: 'live' as const };
      case 'delayed':
        return { text: `Running late${bus.etaMinutes !== null ? `, ${bus.etaMinutes} min` : ''}`, tone: 'warning' as const };
      case 'at_school':
        return { text: 'Parked at school', tone: 'muted' as const };
      default:
        return { text: 'Not running now', tone: 'muted' as const };
    }
  })();

  const tiles: { label: string; href: string; icon: Icon; status: ReactNode; badge?: string }[] = [
    {
      label: 'Pay fees online',
      href: links.payFees(child.id),
      icon: Wallet,
      status:
        due > 0 ? (
          <span className={overdue > 0 ? 'font-semibold text-red-700 dark:text-red-300' : ''}>
            <span className="tabular-nums">{inr.format(due)}</span> due
          </span>
        ) : (
          'All fees paid'
        ),
    },
    {
      label: 'View report card',
      href: links.reportCard(child.id),
      icon: FileText,
      status: reportCard ? `${reportCard.label}${reportCard.percentage !== null ? `, ${reportCard.percentage}%` : ''}` : 'None published yet',
      badge: reportCard?.isNew ? 'New' : undefined,
    },
    {
      label: 'Daily homework',
      href: links.homework(child.id),
      icon: NotebookPen,
      status: openHomework > 0 ? `${openHomework} to do` : 'Nothing due',
    },
    {
      label: 'Track school bus',
      href: links.bus(child.id),
      icon: Bus,
      status: (
        <span className="inline-flex items-start gap-1.5">
          {busLine.tone === 'live' && (
            <span className="relative mt-[5px] flex h-2 w-2 shrink-0" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60 motion-reduce:animate-none" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
          )}
          <span className={busLine.tone === 'warning' ? 'font-semibold text-amber-800 dark:text-amber-300' : ''}>{busLine.text}</span>
        </span>
      ),
    },
  ];

  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map(({ label, href, icon: TileIcon, status, badge }) => (
        <li key={label}>
          <a
            href={href}
            className="group flex h-full min-h-[7.5rem] flex-col justify-between gap-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-[0_1px_2px_rgba(28,25,23,0.04)] transition-colors hover:border-[#0b6b78]/40 active:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b78] dark:border-stone-800 dark:bg-stone-900 dark:hover:border-[#5cc0cc]/40 dark:active:bg-stone-800"
          >
            <span className="flex items-start justify-between">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e3f1f2] text-[#0b6b78] dark:bg-[#0b6b78]/30 dark:text-[#7dd0da]">
                <TileIcon className="h-5 w-5" aria-hidden />
              </span>
              {badge && (
                <span className="rounded-full bg-[#0b6b78] px-2 py-0.5 text-[11px] font-bold text-white dark:bg-[#5cc0cc] dark:text-stone-950">
                  {badge}
                </span>
              )}
            </span>
            <span>
              <span className="block text-[15px] font-semibold leading-snug">{label}</span>
              <span className="mt-0.5 block text-xs text-stone-500 dark:text-stone-400">{status}</span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/* ============================================================================
 * Timetable
 * ========================================================================== */

function Timetable({ home, now }: { home: ChildHome; now: Date }) {
  const todayIdx = now.getDay(); // 0 = Sunday
  const schoolDays = [1, 2, 3, 4, 5, 6].filter((d) => (home.timetable[d]?.length ?? 0) > 0);
  const [day, setDay] = useState(schoolDays.includes(todayIdx) ? todayIdx : schoolDays[0] ?? 1);
  const periods = home.timetable[day] ?? [];
  const isToday = day === todayIdx;
  const nowMin = now.getHours() * 60 + now.getMinutes();

  // Date for each weekday chip, within the current week (Mon-Sat).
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((todayIdx + 6) % 7));
  const dateOf = (weekday: number) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + weekday - 1);

  const absentToday = isToday && home.attendance.status === 'absent';

  return (
    <section aria-labelledby="timetable-title">
      <SectionHeader id="timetable-title" icon={CalendarDays} title={isToday ? "Today's timetable" : `${FULL_WEEKDAYS[day]}'s timetable`} />

      <div role="tablist" aria-label="Day of the week" className="mb-3 grid grid-cols-6 gap-1.5">
        {schoolDays.map((d) => {
          const selected = d === day;
          const date = dateOf(d);
          return (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setDay(d)}
              className={[
                'flex flex-col items-center rounded-xl py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b78]',
                selected
                  ? 'bg-[#0b6b78] text-white dark:bg-[#5cc0cc] dark:text-stone-950'
                  : 'bg-white text-stone-600 ring-1 ring-inset ring-stone-200 hover:bg-stone-100 dark:bg-stone-900 dark:text-stone-300 dark:ring-stone-800 dark:hover:bg-stone-800',
              ].join(' ')}
            >
              <span className="font-medium">{WEEKDAYS[d]}</span>
              <span className={`text-base font-semibold tabular-nums ${d === todayIdx && !selected ? 'text-[#0b6b78] dark:text-[#5cc0cc]' : ''}`}>{date.getDate()}</span>
            </button>
          );
        })}
      </div>

      {absentToday && (
        <p className="mb-3 rounded-xl bg-stone-100 px-3 py-2 text-xs text-stone-600 dark:bg-stone-900 dark:text-stone-400">
          {home.child.firstName} is absent today. Here is what the class is covering, for catching up.
        </p>
      )}

      {periods.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-stone-300 px-4 py-8 text-center text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">No classes scheduled.</p>
      ) : (
        <ol className="overflow-hidden rounded-2xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
          {periods.map((p, i) => (
            <PeriodRow key={p.id} period={p} first={i === 0} state={!isToday ? 'other' : nowMin >= minutesOf(p.end) ? 'past' : nowMin >= minutesOf(p.start) ? 'now' : 'upcoming'} />
          ))}
        </ol>
      )}
    </section>
  );
}

function PeriodRow({ period, state, first }: { period: Period; state: 'past' | 'now' | 'upcoming' | 'other'; first: boolean }) {
  const isBreak = period.kind === 'break' || period.kind === 'assembly';
  const meta = [period.teacher, period.room].filter(Boolean).join(', ');
  return (
    <li
      aria-current={state === 'now' ? 'time' : undefined}
      className={[
        'flex items-center gap-4 px-4',
        first ? '' : 'border-t border-stone-100 dark:border-stone-800',
        isBreak ? 'bg-stone-50/70 py-2 dark:bg-stone-950/40' : 'py-3',
        state === 'now' ? 'bg-[#e3f1f2] dark:bg-[#0b6b78]/20' : '',
        state === 'past' ? 'opacity-55' : '',
      ].join(' ')}
    >
      <span className="w-12 shrink-0 text-right text-xs tabular-nums text-stone-500 dark:text-stone-400">
        <span className={`block font-semibold ${state === 'now' ? 'text-[#0b6b78] dark:text-[#7dd0da]' : 'text-stone-700 dark:text-stone-300'}`}>{to12h(period.start)}</span>
        {!isBreak && <span className="block">{to12h(period.end)}</span>}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate ${isBreak ? 'text-xs font-medium text-stone-500 dark:text-stone-400' : 'text-[15px] font-semibold'}`}>{period.subject}</span>
        {!isBreak && meta && <span className="block truncate text-xs text-stone-500 dark:text-stone-400">{meta}</span>}
      </span>
      {state === 'now' && (
        <span className="shrink-0 rounded-full bg-[#0b6b78] px-2 py-0.5 text-[11px] font-bold text-white dark:bg-[#5cc0cc] dark:text-stone-950">Now</span>
      )}
    </li>
  );
}

/* ============================================================================
 * Homework
 * ========================================================================== */

function dueLabel(item: HomeworkItem, now: Date): { text: string; tone: 'critical' | 'warning' | 'neutral' } {
  const d = daysUntil(item.dueDate, now);
  if (d < 0) return { text: d === -1 ? 'Was due yesterday' : `Was due ${shortDate(item.dueDate)}`, tone: 'critical' };
  if (d === 0) return { text: 'Due today', tone: 'warning' };
  if (d === 1) return { text: 'Due tomorrow', tone: 'warning' };
  const date = parseDay(item.dueDate);
  return { text: `Due ${WEEKDAYS[date.getDay()]} ${shortDate(item.dueDate)}`, tone: 'neutral' };
}

function HomeworkList({ home, now, allHref }: { home: ChildHome; now: Date; allHref: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  // Newest uploads first; the due label carries urgency.
  const items = [...home.homework].sort((a, b) => b.assignedAt.localeCompare(a.assignedAt)).slice(0, 5);

  return (
    <section aria-labelledby="homework-title">
      <SectionHeader id="homework-title" icon={BookOpenCheck} title="Recent homework" action={{ label: 'See all', href: allHref }} />
      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-stone-300 px-4 py-8 text-center text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
          No homework uploaded in the last week.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {items.map((item) => {
            const open = openId === item.id;
            const due = dueLabel(item, now);
            const panelId = `hw-panel-${item.id}`;
            return (
              <li key={item.id} className="rounded-2xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => setOpenId(open ? null : item.id)}
                  className="flex w-full items-start gap-3 rounded-2xl p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b78]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-xs font-semibold text-[#0b6b78] dark:text-[#7dd0da]">{item.subject}</span>
                      <DueChip {...due} />
                    </span>
                    <span className={`mt-1 block text-[15px] font-medium leading-snug ${open ? '' : 'line-clamp-2'}`}>{item.title}</span>
                    <span className="mt-1.5 flex items-center gap-3 text-xs text-stone-500 dark:text-stone-400">
                      <span>
                        {item.teacher}, {relativeAgo(item.assignedAt, now)}
                      </span>
                      {item.attachments.length > 0 && (
                        <span className="inline-flex items-center gap-0.5">
                          <Paperclip className="h-3 w-3" aria-hidden />
                          {item.attachments.length}
                          <span className="sr-only"> attachment{item.attachments.length === 1 ? '' : 's'}</span>
                        </span>
                      )}
                    </span>
                  </span>
                  <ChevronDown className={`mt-1 h-5 w-5 shrink-0 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
                </button>
                <div id={panelId} hidden={!open} className="border-t border-stone-100 px-4 pb-4 pt-3 text-sm dark:border-stone-800">
                  {item.details ? <p className="leading-relaxed text-stone-700 dark:text-stone-300">{item.details}</p> : <p className="text-stone-500 dark:text-stone-400">No extra instructions.</p>}
                  {item.attachments.length > 0 && (
                    <ul className="mt-3 flex flex-col gap-2">
                      {item.attachments.map((file) => (
                        <li key={file.name}>
                          <a
                            href={file.url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-3 rounded-xl bg-stone-50 px-3 py-2.5 ring-1 ring-inset ring-stone-200 hover:bg-stone-100 dark:bg-stone-950 dark:ring-stone-800 dark:hover:bg-stone-800"
                          >
                            <FileText className="h-4 w-4 shrink-0 text-[#0b6b78] dark:text-[#7dd0da]" aria-hidden />
                            <span className="min-w-0 flex-1 truncate font-medium">{file.name}</span>
                            {file.sizeKb !== undefined && (
                              <span className="shrink-0 text-xs tabular-nums text-stone-500 dark:text-stone-400">
                                {file.sizeKb >= 1024 ? `${(file.sizeKb / 1024).toFixed(1)} MB` : `${file.sizeKb} KB`}
                              </span>
                            )}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function DueChip({ text, tone }: { text: string; tone: 'critical' | 'warning' | 'neutral' }) {
  const cls =
    tone === 'critical'
      ? 'bg-red-50 text-red-800 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30'
      : tone === 'warning'
        ? 'bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-400/10 dark:text-amber-200 dark:ring-amber-400/30'
        : 'bg-stone-100 text-stone-600 ring-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:ring-stone-700';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${cls}`}>
      {tone === 'critical' && <CircleAlert className="h-3 w-3" aria-hidden />}
      {tone === 'warning' && <Clock className="h-3 w-3" aria-hidden />}
      {text}
    </span>
  );
}

/* ============================================================================ */

function SectionHeader({ id, icon: HeaderIcon, title, action }: { id: string; icon: Icon; title: string; action?: { label: string; href: string } }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 id={id} className="flex items-center gap-2 text-base font-semibold">
        <HeaderIcon className="h-[18px] w-[18px] text-stone-400" aria-hidden />
        {title}
      </h2>
      {action && (
        <a href={action.href} className="rounded-lg px-2 py-1 text-sm font-semibold text-[#0b6b78] hover:bg-[#e3f1f2] dark:text-[#7dd0da] dark:hover:bg-[#0b6b78]/20">
          {action.label}
        </a>
      )}
    </div>
  );
}
