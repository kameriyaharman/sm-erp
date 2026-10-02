'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Award, CalendarDays, ChevronLeft, ChevronRight, FileText, LoaderCircle } from 'lucide-react';
import { useApi } from '@/lib/useApi';
import { openPdf } from '@/lib/session';
import { EmptyBlock, ErrorBlock, Loading, PCard, Segmented } from './ParentLayout';
import { FULL_WEEKDAYS, WEEKDAYS, isoDay, isoMonth, minutesOf, monthLabel, shiftMonth, time12, tsDate } from './format';
import type { AttendanceDayStatus, AttendanceStats, ChildAttendance, ChildHome, SectionTimetable, StudentReportCard, TimetablePeriod } from './types';

export type AcademicsTab = 'report-cards' | 'attendance' | 'timetable';
const TABS: { value: AcademicsTab; label: string }[] = [
  { value: 'report-cards', label: 'Report cards' },
  { value: 'attendance', label: 'Attendance' },
  { value: 'timetable', label: 'Timetable' },
];

export default function AcademicsScreen({ home }: { home: ChildHome }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params.get('tab');
  const tab: AcademicsTab = TABS.some((t) => t.value === raw) ? (raw as AcademicsTab) : 'report-cards';

  function setTab(next: AcademicsTab) {
    const sp = new URLSearchParams(params.toString());
    sp.set('tab', next);
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  }

  return (
    <>
      <Segmented label="Academics" value={tab} onChange={setTab} items={TABS} />
      <div role="tabpanel" aria-label={TABS.find((t) => t.value === tab)?.label} className="flex flex-col gap-5">
        {tab === 'report-cards' && <ReportCards home={home} />}
        {tab === 'attendance' && <AttendanceCalendar home={home} />}
        {tab === 'timetable' && <WeekTimetable home={home} />}
      </div>
    </>
  );
}

/* ============================================================================
 * Report cards
 * ========================================================================== */

const RESULT_LABEL: Record<string, string> = { pass: 'Passed', promoted: 'Promoted', fail: 'Not passed', detained: 'Not promoted', withheld: 'Withheld' };

function ReportCards({ home }: { home: ChildHome }) {
  const { data, error, loading, reload } = useApi<{ data: StudentReportCard[] }>(`/documents/students/${home.child.id}/report-cards`);
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  if (error) return <ErrorBlock message={error} onRetry={reload} />;
  if (loading && !data) return <Loading label="Loading report cards" />;
  const cards = data?.data ?? [];
  if (cards.length === 0) {
    return <EmptyBlock icon={Award} title="No report cards yet" description={`${home.child.firstName}'s report cards appear here as soon as the school publishes them.`} />;
  }

  async function view(card: StudentReportCard) {
    setOpenError(null);
    setOpening(card.id);
    try {
      await openPdf(`/documents/report-cards/${card.id}/pdf`, `report-card-${home.child.firstName}-${card.term_name ?? 'final'}.pdf`);
    } catch (e) {
      setOpenError((e as Error).message);
    } finally {
      setOpening(null);
    }
  }

  return (
    <>
      {openError && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-900 dark:bg-red-500/10 dark:text-red-200">
          {openError}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {cards.map((card) => {
          const pct = card.percentage !== null ? Number(card.percentage) : null;
          const result = card.result ? RESULT_LABEL[card.result] : undefined;
          return (
            <PCard as="li" key={card.id} className="p-4">
              <div className="flex items-start gap-4">
                <div className="relative flex h-16 w-16 shrink-0 items-center justify-center">
                  <svg viewBox="0 0 36 36" className="absolute inset-0 h-16 w-16 -rotate-90" aria-hidden>
                    <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3" className="stroke-stone-100 dark:stroke-stone-800" />
                    <circle
                      cx="18"
                      cy="18"
                      r="15.5"
                      fill="none"
                      strokeWidth="3"
                      strokeLinecap="round"
                      className="stroke-indigo-600 dark:stroke-indigo-300"
                      strokeDasharray={`${((pct ?? 0) / 100) * 97.4} 97.4`}
                    />
                  </svg>
                  <span className="text-lg font-bold">{card.overall_grade ?? '–'}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold">{card.is_final ? 'Final report card' : card.term_name ?? 'Report card'}</p>
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    Session {card.academic_year}
                    {card.published_at ? `, Published ${tsDate(card.published_at)}` : ''}
                  </p>
                  <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <div className="flex gap-1">
                      <dt className="text-stone-500 dark:text-stone-400">Score</dt>
                      <dd className="font-semibold tabular-nums">{pct !== null ? `${pct.toFixed(1)}%` : '–'}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt className="text-stone-500 dark:text-stone-400">Grade</dt>
                      <dd className="font-semibold">{card.overall_grade ?? '–'}</dd>
                    </div>
                    {result && (
                      <div className="flex gap-1">
                        <dt className="text-stone-500 dark:text-stone-400">Result</dt>
                        <dd className="font-semibold">{result}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              </div>
              <button
                type="button"
                onClick={() => view(card)}
                disabled={opening !== null}
                className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-indigo-600/30 bg-indigo-50 text-sm font-semibold text-indigo-600 hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:opacity-60 dark:border-indigo-300/30 dark:bg-indigo-600/20 dark:text-indigo-200 dark:hover:bg-indigo-600/30"
              >
                {opening === card.id ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <FileText className="h-4 w-4" aria-hidden />}
                View report card (PDF)
              </button>
            </PCard>
          );
        })}
      </ul>
    </>
  );
}

/* ============================================================================
 * Attendance calendar
 * ========================================================================== */

const STATUS_STYLE: Record<AttendanceDayStatus, { label: string; cell: string; dot: string }> = {
  present: { label: 'Present', cell: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-100', dot: 'bg-emerald-500' },
  absent: { label: 'Absent', cell: 'bg-red-500 text-white dark:bg-red-500/80', dot: 'bg-red-500' },
  late: { label: 'Late', cell: 'bg-amber-200 text-amber-950 dark:bg-amber-400/30 dark:text-amber-100', dot: 'bg-amber-400' },
  leave: { label: 'Leave', cell: 'bg-sky-100 text-sky-900 dark:bg-sky-500/25 dark:text-sky-100', dot: 'bg-sky-400' },
  half_day: { label: 'Half day', cell: 'bg-violet-100 text-violet-900 dark:bg-violet-500/25 dark:text-violet-100', dot: 'bg-violet-400' },
};

function AttendanceCalendar({ home }: { home: ChildHome }) {
  const thisMonth = isoMonth(new Date());
  const [month, setMonth] = useState(thisMonth);
  const { data, error, loading, reload } = useApi<{ data: ChildAttendance }>(`/parent/children/${home.child.id}/attendance?month=${month}`);
  const att = data?.data.month === month ? data.data : null;

  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // Monday-first grid
  const byDate = new Map(att?.days.map((d) => [d.date.slice(0, 10), d.status]) ?? []);
  const today = isoDay(new Date());

  return (
    <>
      <PCard className="p-4" aria-label="Attendance calendar">
        <div className="mb-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setMonth(shiftMonth(month, -1))}
            aria-label="Previous month"
            className="flex h-10 w-10 items-center justify-center rounded-full text-stone-600 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 dark:text-stone-300 dark:hover:bg-white/5"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>
          <p className="text-[15px] font-semibold" aria-live="polite">
            {monthLabel(month)}
          </p>
          <button
            type="button"
            onClick={() => setMonth(shiftMonth(month, 1))}
            disabled={month >= thisMonth}
            aria-label="Next month"
            className="flex h-10 w-10 items-center justify-center rounded-full text-stone-600 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:opacity-30 dark:text-stone-300 dark:hover:bg-white/5"
          >
            <ChevronRight className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {error ? (
          <ErrorBlock message={error} onRetry={reload} />
        ) : (
          <div className={loading && !att ? 'opacity-50' : ''}>
            <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-stone-400" aria-hidden>
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                <span key={d} className="py-1">
                  {d.slice(0, 2)}
                </span>
              ))}
            </div>
            <ol className="grid grid-cols-7 gap-1">
              {Array.from({ length: lead }, (_, i) => (
                <li key={`pad-${i}`} aria-hidden />
              ))}
              {Array.from({ length: daysInMonth }, (_, i) => {
                const day = i + 1;
                const iso = `${month}-${String(day).padStart(2, '0')}`;
                const status = byDate.get(iso);
                const weekday = new Date(y, m - 1, day).getDay();
                const style = status ? STATUS_STYLE[status] : null;
                const isToday = iso === today;
                return (
                  <li
                    key={iso}
                    aria-label={`${day} ${monthLabel(month)}: ${style ? style.label : iso > today ? 'upcoming' : weekday === 0 ? 'Sunday' : 'no class'}`}
                    className={[
                      'flex aspect-square items-center justify-center rounded-lg text-sm tabular-nums',
                      style ? `${style.cell} font-semibold` : weekday === 0 ? 'text-stone-300 dark:text-stone-600' : 'text-stone-500 dark:text-stone-400',
                      isToday ? 'ring-2 ring-marigold-400 ring-offset-1 ring-offset-white dark:ring-offset-surface' : '',
                    ].join(' ')}
                  >
                    {day}
                  </li>
                );
              })}
            </ol>
            <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-stone-600 dark:text-stone-400" aria-label="Legend">
              {(Object.keys(STATUS_STYLE) as AttendanceDayStatus[]).map((k) => (
                <li key={k} className="flex items-center gap-1.5">
                  <span className={`h-2.5 w-2.5 rounded-full ${STATUS_STYLE[k].dot}`} aria-hidden />
                  {STATUS_STYLE[k].label}
                </li>
              ))}
            </ul>
          </div>
        )}
      </PCard>

      {att && (
        <>
          <StatsCard title={`${monthLabel(month)}`} stats={att.summary} empty="No attendance marked this month yet." />
          <StatsCard title="This school year" stats={att.year} empty="No attendance marked this year yet." />
        </>
      )}
      {!att && loading && <Loading rows={2} label="Loading attendance" />}
    </>
  );
}

function StatsCard({ title, stats, empty }: { title: string; stats: AttendanceStats; empty: string }) {
  const pct = stats.percentage;
  const low = pct !== null && pct < 75;
  const items: { label: string; value: number; dot: string }[] = [
    { label: 'Present', value: stats.present, dot: STATUS_STYLE.present.dot },
    { label: 'Absent', value: stats.absent, dot: STATUS_STYLE.absent.dot },
    { label: 'Late', value: stats.late, dot: STATUS_STYLE.late.dot },
    { label: 'Leave', value: stats.leave, dot: STATUS_STYLE.leave.dot },
  ];
  if (stats.halfDay > 0) items.push({ label: 'Half day', value: stats.halfDay, dot: STATUS_STYLE.half_day.dot });
  return (
    <PCard className="p-4" aria-label={`${title} summary`}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {stats.workingDays > 0 && <span className="text-xs text-stone-500 dark:text-stone-400">{stats.workingDays} school days</span>}
      </div>
      {stats.workingDays === 0 ? (
        <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">{empty}</p>
      ) : (
        <div className="mt-3 flex items-center gap-4">
          <p className={`text-3xl font-bold tabular-nums ${low ? 'text-red-700 dark:text-red-300' : 'text-indigo-600 dark:text-indigo-200'}`}>
            {pct !== null ? `${pct}%` : '–'}
          </p>
          <ul className="grid flex-1 grid-cols-2 gap-x-3 gap-y-1 text-sm">
            {items.map((it) => (
              <li key={it.label} className="flex items-center gap-1.5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${it.dot}`} aria-hidden />
                <span className="text-stone-500 dark:text-stone-400">{it.label}</span>
                <span className="ml-auto font-semibold tabular-nums">{it.value}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {low && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800 dark:bg-red-500/10 dark:text-red-200">Attendance is below the 75% the school expects.</p>}
    </PCard>
  );
}

/* ============================================================================
 * Week timetable
 * ========================================================================== */

function WeekTimetable({ home }: { home: ChildHome }) {
  const { data, error, loading, reload } = useApi<{ data: SectionTimetable }>(`/parent/children/${home.child.id}/timetable`);
  const now = new Date();
  const todayIdx = now.getDay();
  const [day, setDay] = useState(todayIdx >= 1 && todayIdx <= 6 ? todayIdx : 1);

  if (error) return <ErrorBlock message={error} onRetry={reload} />;
  if (loading && !data) return <Loading label="Loading timetable" />;
  const tt = data?.data;
  if (!tt || Object.values(tt.days).every((d) => d.length === 0)) {
    return <EmptyBlock icon={CalendarDays} title="Timetable not published yet" description="The class timetable will appear here once the school sets it up." />;
  }

  const periods: TimetablePeriod[] = tt.days[String(day)] ?? [];
  const isToday = day === todayIdx;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((todayIdx + 6) % 7));

  return (
    <>
      <div role="tablist" aria-label="Day of the week" className="grid grid-cols-6 gap-1.5">
        {[1, 2, 3, 4, 5, 6].map((d) => {
          const selected = d === day;
          const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + d - 1);
          return (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-label={`${FULL_WEEKDAYS[d]}${d === todayIdx ? ', today' : ''}`}
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

      {periods.length === 0 ? (
        <EmptyBlock icon={CalendarDays} title={`No classes on ${FULL_WEEKDAYS[day]}`} />
      ) : (
        <ol className="overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-line dark:bg-surface" aria-label={`${FULL_WEEKDAYS[day]} timetable`}>
          {periods.map((p, i) => {
            const state = !isToday ? 'other' : nowMin >= minutesOf(p.end) ? 'past' : nowMin >= minutesOf(p.start) ? 'now' : 'upcoming';
            const isBreak = p.kind !== 'class';
            const meta = [p.teacher?.name, p.room].filter(Boolean).join(', ');
            return (
              <li
                key={`${p.periodNo}-${p.start}`}
                aria-current={state === 'now' ? 'time' : undefined}
                className={[
                  'flex items-center gap-3 px-4',
                  i ? 'border-t border-stone-100 dark:border-line' : '',
                  isBreak ? 'bg-stone-50/70 py-2.5 dark:bg-canvas/40' : 'py-3',
                  state === 'now' ? 'bg-indigo-50 dark:bg-indigo-600/20' : '',
                  state === 'past' ? 'opacity-55' : '',
                ].join(' ')}
              >
                <span className="w-[4.5rem] shrink-0 text-xs tabular-nums text-stone-500 dark:text-stone-400">
                  <span className={`block font-semibold ${state === 'now' ? 'text-indigo-600 dark:text-indigo-200' : 'text-stone-700 dark:text-stone-300'}`}>{time12(p.start)}</span>
                  <span className="block">{time12(p.end)}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate ${isBreak ? 'text-sm font-medium text-stone-500 dark:text-stone-400' : 'text-[15px] font-semibold'}`}>{p.label}</span>
                  {!isBreak && meta && <span className="block truncate text-xs text-stone-500 dark:text-stone-400">{meta}</span>}
                </span>
                {state === 'now' && <span className="shrink-0 rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-bold text-white dark:bg-indigo-500 dark:text-white">Now</span>}
              </li>
            );
          })}
        </ol>
      )}
      {tt.section && <p className="px-1 text-xs text-stone-500 dark:text-stone-400">Class timetable for {tt.section.label}.</p>}
    </>
  );
}
