'use client';

import { useMemo } from 'react';
import { ArrowDownUp, CalendarX2 } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Page, PageHeader, Spinner, Stat, Table, Td, Th, cx } from '@/components/ui';
import { ClassSectionFilter, FilterBar, FilterSearch, FilteredEmpty, ToggleFilter, chip, useClassOptions, useUrlFilters } from '@/components/filters';
import { qs, useApi } from '@/lib/useApi';
import { formatMonth } from '@/lib/format';
import { dayLabel, thisMonth, useSections } from '@/features/teacher/useSections';
import type { AttendanceHistory as History, AttendanceHistoryDay } from '@/features/teacher/types';

const LOW = 75;

const SEGMENTS: { key: keyof Pick<AttendanceHistoryDay, 'present' | 'late' | 'halfDay' | 'leave' | 'absent'>; label: string; bar: string }[] = [
  { key: 'present', label: 'Present', bar: 'bg-emerald-500' },
  { key: 'late', label: 'Late', bar: 'bg-amber-400' },
  { key: 'halfDay', label: 'Half day', bar: 'bg-violet-400' },
  { key: 'leave', label: 'Leave', bar: 'bg-sky-400' },
  { key: 'absent', label: 'Absent', bar: 'bg-red-500' },
];

/** /attendance/history?classId=…&sectionId=…&month=2026-09&search=…&low=1&sort=low (teachers: their classes). */
export default function AttendanceHistory() {
  const { defaultId, error: secError, reload: reloadSections, isTeacher } = useSections();
  const cls = useClassOptions();
  const f = useUrlFilters({ classId: '', sectionId: '', month: '', search: '', low: '', sort: '' }, { ignoreInCount: ['sort', 'month'] });
  const month = /^\d{4}-\d{2}$/.test(f.values.month) ? f.values.month : thisMonth();
  // No section in the link: the teacher's own class (or the first one).
  const sectionId = f.values.sectionId || defaultId || '';
  const classId = f.values.classId || cls.section(sectionId)?.classId || '';
  const lowFirst = f.values.sort === 'low';
  const lowOnly = f.values.low === '1';
  const search = f.values.search;

  const { data, error, loading, reload } = useApi<{ data: History }>(sectionId && month ? `/academics/attendance/history${qs({ sectionId, month })}` : null);
  const h = data?.data.section.id === sectionId && data.data.month === month ? data.data : null;
  const sections = cls.loading && cls.classes.length === 0 ? null : cls.classes;

  const summary = useMemo(() => {
    if (!h) return null;
    let marked = 0;
    let attended = 0;
    let absences = 0;
    for (const d of h.days) {
      marked += d.total;
      attended += d.present + d.late + 0.5 * d.halfDay;
      absences += d.absent;
    }
    return {
      workingDays: h.days.length,
      average: marked ? Math.round((attended / marked) * 1000) / 10 : null,
      absences,
      low: h.students.filter((s) => s.percentage !== null && s.percentage < LOW).length,
    };
  }, [h]);

  const students = useMemo(() => {
    if (!h) return [];
    const q = search.trim().toLowerCase();
    let list = h.students.filter(
      (s) => (!q || s.name.toLowerCase().includes(q) || (s.rollNumber ?? '').toLowerCase() === q) && (!lowOnly || (s.percentage !== null && s.percentage < LOW)),
    );
    if (lowFirst) list = [...list].sort((a, b) => (a.percentage ?? 101) - (b.percentage ?? 101));
    return list;
  }, [h, lowFirst, lowOnly, search]);

  const chips = [
    chip('search', 'Student', search, `“${search}”`, () => f.set({ search: '' })),
    lowOnly && { key: 'low', label: `Below ${LOW}% only`, onRemove: () => f.set({ low: '' }) },
  ];

  return (
    <Page wide>
      <PageHeader
        title="Attendance history"
        description={h ? `${h.section.label}, ${formatMonth(month)}` : 'Month-wise registers for a class'}
      />

      <Card padded={false} className="mb-6">
        <FilterBar
          bordered={false}
          search={<FilterSearch value={search} onChange={(v) => f.set({ search: v })} label="Student" placeholder="Name or roll no." />}
          chips={chips}
          onClear={() => f.set({ search: '', low: '' })}
        >
          <ClassSectionFilter options={cls} classId={classId} sectionId={sectionId} requireSection onChange={f.set} />
          <Input label="Month" type="month" value={month} max={thisMonth()} onChange={(e) => e.target.value && f.set({ month: e.target.value === thisMonth() ? '' : e.target.value })} className="filter-control sm:w-44" />
          <ToggleFilter label={`Below ${LOW}% only`} name="low" checked={lowOnly} onChange={(on) => f.set({ low: on ? '1' : '' })} />
        </FilterBar>
      </Card>

      {secError ? (
        <ErrorState message={secError} onRetry={reloadSections} />
      ) : sections && sections.length === 0 ? (
        isTeacher ? (
          <EmptyState title="No classes assigned yet" description="You haven't been assigned any classes or subjects yet. Ask the school office to assign your classes." />
        ) : (
          <EmptyState title="No classes set up yet" description="Classes and sections for this year will appear here once the school adds them." />
        )
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !h || !summary ? (
        loading || !sections ? <Spinner label="Loading attendance…" /> : null
      ) : h.days.length === 0 ? (
        <Card>
          <EmptyState icon={<CalendarX2 className="h-7 w-7" aria-hidden />} title={`No registers in ${formatMonth(month)}`} description="Attendance has not been marked for this class in this month yet." />
        </Card>
      ) : (
        <div className={cx('flex flex-col gap-6', loading && 'opacity-60')}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="School days" value={summary.workingDays} hint="Registers submitted" />
            <Stat
              label="Average attendance"
              value={summary.average !== null ? `${summary.average}%` : '–'}
              tone={summary.average === null ? 'default' : summary.average >= 90 ? 'good' : summary.average >= LOW ? 'warn' : 'bad'}
              hint="Present + late, half days count half"
            />
            <Stat label="Absences" value={summary.absences} hint="Student-days absent" tone={summary.absences > 0 ? 'warn' : 'default'} />
            <Stat label={`Below ${LOW}%`} value={summary.low} hint={`of ${h.students.length} students`} tone={summary.low > 0 ? 'bad' : 'good'} />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            <Card title="Day by day" padded={false} className="min-w-0 lg:col-span-2">
              <ul className="divide-y divide-line">
                {h.days.map((d) => {
                  const pct = d.total ? Math.round(((d.present + d.late + 0.5 * d.halfDay) / d.total) * 100) : 0;
                  return (
                    <li key={d.date} className="px-4 py-2.5 sm:px-5">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="font-medium">{dayLabel(d.date)}</span>
                        <span className="tabular-nums text-slate-500 dark:text-slate-400">
                          <span className="text-emerald-700 dark:text-emerald-400">{d.present} P</span>
                          {', '}
                          <span className={d.absent ? 'font-semibold text-red-700 dark:text-red-400' : ''}>{d.absent} A</span>
                          {d.late > 0 && <>, <span className="text-amber-700 dark:text-amber-400">{d.late} late</span></>}
                          {d.leave > 0 && <>, {d.leave} leave</>}
                          {d.halfDay > 0 && <>, {d.halfDay} half</>}
                          <span className="ml-2 font-semibold text-slate-700 dark:text-slate-200">{pct}%</span>
                        </span>
                      </div>
                      <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="img" aria-label={`${d.present} present, ${d.absent} absent, ${d.late} late, ${d.leave} on leave of ${d.total}`}>
                        {SEGMENTS.map((seg) =>
                          d[seg.key] > 0 ? <span key={seg.key} className={seg.bar} style={{ width: `${(d[seg.key] / d.total) * 100}%` }} /> : null,
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <ul className="flex flex-wrap gap-x-3 gap-y-1 border-t border-line px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400 sm:px-5" aria-label="Legend">
                {SEGMENTS.map((s) => (
                  <li key={s.key} className="flex items-center gap-1.5">
                    <span className={cx('h-2 w-2 rounded-full', s.bar)} aria-hidden />
                    {s.label}
                  </li>
                ))}
              </ul>
            </Card>

            <Card
              title="Students"
              padded={false}
              className="min-w-0 lg:col-span-3"
              description={students.length !== h.students.length ? `${students.length} of ${h.students.length} shown` : undefined}
              actions={
                <Button variant="ghost" size="sm" icon={<ArrowDownUp className="h-3.5 w-3.5" aria-hidden />} onClick={() => f.set({ sort: lowFirst ? '' : 'low' })} aria-pressed={lowFirst}>
                  {lowFirst ? 'Lowest first' : 'Roll order'}
                </Button>
              }
            >
              <Table>
                <thead>
                  <tr>
                    <Th>Roll</Th>
                    <Th>Student</Th>
                    <Th align="right">Present</Th>
                    <Th align="right">Absent</Th>
                    <Th align="right" className="hidden sm:table-cell">Late</Th>
                    <Th align="right" className="hidden sm:table-cell">Leave</Th>
                    <Th align="right">Attendance</Th>
                  </tr>
                </thead>
                <tbody>
                  {students.length === 0 && (
                    <tr>
                      <td colSpan={7}>
                        <FilteredEmpty what="students" chips={chips} onClear={() => f.set({ search: '', low: '' })} />
                      </td>
                    </tr>
                  )}
                  {students.map((s) => {
                    const low = s.percentage !== null && s.percentage < LOW;
                    return (
                      <tr key={s.studentId} className={low ? 'bg-red-50/70 dark:bg-red-500/10' : ''}>
                        <Td className="tabular-nums text-slate-500">{s.rollNumber ?? '–'}</Td>
                        <Td className="font-medium">
                          <span className="flex items-center gap-2">
                            {s.name}
                            {low && <Badge tone="red">Low</Badge>}
                          </span>
                        </Td>
                        <Td align="right">{s.present}</Td>
                        <Td align="right" className={s.absent ? 'font-semibold text-red-700 dark:text-red-400' : ''}>
                          {s.absent}
                        </Td>
                        <Td align="right" className="hidden sm:table-cell">{s.late}</Td>
                        <Td align="right" className="hidden sm:table-cell">{s.leave}</Td>
                        <Td align="right">
                          <span className="inline-flex items-center gap-2">
                            <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800 md:inline-block" aria-hidden>
                              <span
                                className={cx('block h-full', low ? 'bg-red-500' : (s.percentage ?? 0) >= 90 ? 'bg-emerald-500' : 'bg-amber-400')}
                                style={{ width: `${s.percentage ?? 0}%` }}
                              />
                            </span>
                            <span className={cx('font-semibold', low && 'text-red-700 dark:text-red-400')}>{s.percentage !== null ? `${s.percentage}%` : '–'}</span>
                          </span>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </Card>
          </div>
        </div>
      )}
    </Page>
  );
}
