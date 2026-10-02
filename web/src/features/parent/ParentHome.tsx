'use client';

import { useMemo, useState, type ComponentType, type ReactNode, type SVGProps } from 'react';
import Link from 'next/link';
import {
  BookOpenCheck,
  Bus,
  CalendarDays,
  ChevronDown,
  CircleAlert,
  Clock,
  FileText,
  IndianRupee,
  NotebookPen,
  Paperclip,
  Phone,
  UserX,
  Wallet,
  X,
} from 'lucide-react';
import type { ChildHome, HomeworkItem, Period, ParentHomeData } from './types';
import { ChildSwitcher, ParentShell, withChild } from './ParentLayout';
import { time12 } from './format';

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
  timetable: (childId: string) => string;
}

const DEFAULT_LINKS: ParentHomeLinks = {
  payFees: (id) => withChild('/parent/fees', id),
  reportCard: (id) => withChild('/parent/academics', id, { tab: 'report-cards' }),
  homework: (id) => withChild('/parent/homework', id),
  bus: (id) => withChild('/parent/bus', id),
  timetable: (id) => withChild('/parent/academics', id, { tab: 'timetable' }),
};

export interface ParentHomeProps {
  data: ParentHomeData;
  /** Injected clock, for tests and previews. */
  now?: Date;
  links?: Partial<ParentHomeLinks>;
  /** Unread count for the bell; omitted = worked out from /notices. */
  unreadNotifications?: number;
  /** Controlled selection (kept in the URL by the page). Omitted = the child who needs attention most. */
  childId?: string | null;
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

/** The child who needs attention most (absent today or fees overdue), else the first. */
export function urgentChildId(data: ParentHomeData): string | undefined {
  const urgent = data.children.find((c) => c.attendance.status === 'absent' || rupees(c.fee.overdue) > 0);
  return (urgent ?? data.children[0])?.child.id;
}

export default function ParentHome({ data, now = new Date(), links: linkOverrides, unreadNotifications, childId: controlledId, onSelectChild }: ParentHomeProps) {
  const links = { ...DEFAULT_LINKS, ...linkOverrides };
  const initialChild = useMemo(() => urgentChildId(data), [data]);
  const [ownChildId, setOwnChildId] = useState(initialChild);
  const childId = controlledId ?? ownChildId;
  const home = data.children.find((c) => c.child.id === childId) ?? data.children[0];
  const title = `${greeting(now)}, ${data.parentName.split(' ')[0]}`;

  if (!home) {
    return (
      <ParentShell active="home" childId={null} title={title} subtitle={data.schoolName} unread={unreadNotifications}>
        <p className="px-5 py-16 text-center text-sm text-stone-500 dark:text-stone-400">No children are linked to your account yet. Contact the school office to link them.</p>
      </ParentShell>
    );
  }

  function selectChild(id: string) {
    setOwnChildId(id);
    onSelectChild?.(id);
  }

  return (
    <ParentShell active="home" childId={home.child.id} title={title} subtitle={data.schoolName} unread={unreadNotifications}>
      {data.children.length > 1 && <ChildSwitcher items={data.children} selectedId={home.child.id} onSelect={selectChild} />}

      <div className="flex flex-col gap-7 px-4 pb-6 pt-4 sm:px-6">
        <UrgentAlerts key={home.child.id} home={home} now={now} schoolPhone={data.schoolPhone} payHref={links.payFees(home.child.id)} />

        <section aria-labelledby="quick-actions">
          <h2 id="quick-actions" className="sr-only">
            Quick actions
          </h2>
          <QuickActions home={home} now={now} links={links} />
        </section>

        <Timetable key={`tt-${home.child.id}`} home={home} now={now} allHref={links.timetable(home.child.id)} />

        <HomeworkList key={`hw-${home.child.id}`} home={home} now={now} allHref={links.homework(home.child.id)} />
      </div>
    </ParentShell>
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
              className="mt-3 inline-flex items-center gap-3 rounded-lg bg-white py-2 pl-3 pr-4 text-left text-red-800 shadow-sm ring-1 ring-red-200 hover:bg-red-50 dark:bg-red-500/15 dark:text-red-100 dark:ring-red-400/30 dark:hover:bg-red-500/25"
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
          <Link
            href={payHref}
            className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 dark:bg-indigo-500 dark:text-white dark:hover:bg-indigo-200 dark:focus-visible:ring-offset-stone-950"
          >
            Pay {inr.format(due)} now
          </Link>
        </Alert>
      )}

      {dueSoon && (
        <Alert tone="warning" icon={Clock} title={`${inr.format(due)} due ${daysUntil(fee.nextDueDate!, now) === 0 ? 'today' : `on ${shortDate(fee.nextDueDate!)}`}`}>
          <p>
            Pay before the due date to avoid a late fee.{' '}
            <Link href={payHref} className="font-semibold underline underline-offset-2">
              Pay now
            </Link>
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
      ? { box: 'border-red-200 bg-red-50 text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100', icon: 'bg-red-600 text-white' }
      : { box: 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100', icon: 'bg-marigold-400 text-amber-950' };
  return (
    <div role={tone === 'critical' ? 'alert' : 'status'} className={`relative flex gap-3 rounded-xl border p-4 ${styles.box}`}>
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
        return bus.pickupTime
          ? { text: `Pickup ${time12(bus.pickupTime)}`, tone: 'muted' as const }
          : { text: 'Not running now', tone: 'muted' as const };
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
          <Link
            href={href}
            className="group flex h-full min-h-[7.5rem] flex-col justify-between gap-3 rounded-xl border border-stone-200 bg-white p-4  transition-colors hover:border-indigo-600/40 active:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 dark:border-line dark:bg-surface dark:hover:border-indigo-300/40 dark:active:bg-stone-800"
          >
            <span className="flex items-start justify-between">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-600/30 dark:text-indigo-200">
                <TileIcon className="h-5 w-5" aria-hidden />
              </span>
              {badge && (
                <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-bold text-white dark:bg-indigo-500 dark:text-white">
                  {badge}
                </span>
              )}
            </span>
            <span>
              <span className="block text-[15px] font-semibold leading-snug">{label}</span>
              <span className="mt-0.5 block text-xs text-stone-500 dark:text-stone-400">{status}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* ============================================================================
 * Timetable
 * ========================================================================== */

function Timetable({ home, now, allHref }: { home: ChildHome; now: Date; allHref: string }) {
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
      <SectionHeader id="timetable-title" icon={CalendarDays} title={isToday ? "Today's timetable" : `${FULL_WEEKDAYS[day]}'s timetable`} action={{ label: 'Full week', href: allHref }} />

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
                'flex flex-col items-center rounded-lg py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600',
                selected
                  ? 'bg-indigo-600 text-white dark:bg-indigo-500 dark:text-white'
                  : 'bg-white text-stone-600 ring-1 ring-inset ring-stone-200 hover:bg-stone-100 dark:bg-surface dark:text-stone-300 dark:ring-line dark:hover:bg-white/5',
              ].join(' ')}
            >
              <span className="font-medium">{WEEKDAYS[d]}</span>
              <span className={`text-base font-semibold tabular-nums ${d === todayIdx && !selected ? 'text-marigold-700 dark:text-marigold-300' : ''}`}>{date.getDate()}</span>
              <span aria-hidden className={`mt-1 h-[3px] w-4 rounded-full ${d === todayIdx ? 'bg-marigold-400' : 'bg-transparent'}`} />
            </button>
          );
        })}
      </div>

      {absentToday && (
        <p className="mb-3 rounded-lg bg-stone-100 px-3 py-2 text-xs text-stone-600 dark:bg-surface dark:text-stone-400">
          {home.child.firstName} is absent today. Here is what the class is covering, for catching up.
        </p>
      )}

      {periods.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-300 px-4 py-8 text-center text-sm text-stone-500 dark:border-line-strong dark:text-stone-400">No classes scheduled.</p>
      ) : (
        <ol className="overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-line dark:bg-surface">
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
        first ? '' : 'border-t border-stone-100 dark:border-line',
        isBreak ? 'bg-stone-50/70 py-2 dark:bg-canvas/40' : 'py-3',
        state === 'now' ? 'bg-indigo-50 dark:bg-indigo-600/20' : '',
        state === 'past' ? 'opacity-55' : '',
      ].join(' ')}
    >
      <span className="w-12 shrink-0 text-right text-xs tabular-nums text-stone-500 dark:text-stone-400">
        <span className={`block font-semibold ${state === 'now' ? 'text-indigo-600 dark:text-indigo-200' : 'text-stone-700 dark:text-stone-300'}`}>{to12h(period.start)}</span>
        {!isBreak && <span className="block">{to12h(period.end)}</span>}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate ${isBreak ? 'text-xs font-medium text-stone-500 dark:text-stone-400' : 'text-[15px] font-semibold'}`}>{period.subject}</span>
        {!isBreak && meta && <span className="block truncate text-xs text-stone-500 dark:text-stone-400">{meta}</span>}
      </span>
      {state === 'now' && (
        <span className="shrink-0 rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-bold text-white dark:bg-indigo-500 dark:text-white">Now</span>
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
        <p className="rounded-xl border border-dashed border-stone-300 px-4 py-8 text-center text-sm text-stone-500 dark:border-line-strong dark:text-stone-400">
          No homework uploaded in the last week.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {items.map((item) => {
            const open = openId === item.id;
            const due = dueLabel(item, now);
            const panelId = `hw-panel-${item.id}`;
            return (
              <li key={item.id} className="rounded-xl border border-stone-200 bg-white dark:border-line dark:bg-surface">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => setOpenId(open ? null : item.id)}
                  className="flex w-full items-start gap-3 rounded-xl p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-200">{item.subject}</span>
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
                <div id={panelId} hidden={!open} className="border-t border-stone-100 px-4 pb-4 pt-3 text-sm dark:border-line">
                  {item.details ? <p className="leading-relaxed text-stone-700 dark:text-stone-300">{item.details}</p> : <p className="text-stone-500 dark:text-stone-400">No extra instructions.</p>}
                  {item.attachments.length > 0 && (
                    <ul className="mt-3 flex flex-col gap-2">
                      {item.attachments.map((file) => (
                        <li key={file.name}>
                          <a
                            href={file.url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-3 rounded-lg bg-stone-50 px-3 py-2.5 ring-1 ring-inset ring-stone-200 hover:bg-stone-100 dark:bg-canvas dark:ring-line dark:hover:bg-white/5"
                          >
                            <FileText className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-200" aria-hidden />
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
        : 'bg-stone-100 text-stone-600 ring-stone-200 dark:bg-white/[0.06] dark:text-stone-300 dark:ring-line-strong';
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
        <Link href={action.href} className="rounded-lg px-2 py-1 text-sm font-semibold text-indigo-600 hover:bg-indigo-50 dark:text-indigo-200 dark:hover:bg-indigo-600/20">
          {action.label}
        </Link>
      )}
    </div>
  );
}
