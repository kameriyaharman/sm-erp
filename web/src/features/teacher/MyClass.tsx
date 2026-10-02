'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Phone, Users } from 'lucide-react';
import { Card, EmptyState, ErrorState, Page, PageHeader, Select, Spinner, Stat, Table, Td, Th, cx } from '@/components/ui';
import { qs, useApi } from '@/lib/useApi';
import { formatTime } from '@/lib/format';
import { WEEKDAY_LONG, WEEKDAY_SHORT, useSections } from './useSections';
import type { PageMeta, SectionTimetable, StudentRow, TimetableSlot } from './types';

const DAYS = [1, 2, 3, 4, 5, 6];
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const tel = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;
function showPhone(phone: string) {
  const d = phone.replace(/\D/g, '');
  const ten = d.length === 12 && d.startsWith('91') ? d.slice(2) : d.length === 10 ? d : null;
  return ten ? `${ten.slice(0, 5)} ${ten.slice(5)}` : phone;
}
const rollKey = (r: string | null) => (r && /^\d+$/.test(r) ? Number(r) : Number.MAX_SAFE_INTEGER);

export default function MyClass() {
  const { sections, mine, error: secError, reload: reloadSections, subjectsFor } = useSections();
  const [sectionId, setSectionId] = useState('');
  // Class-teacher section first, then the sections the teacher teaches a subject in.
  const choices = useMemo(() => [...(sections ?? [])].sort((a, b) => Number(b.mine) - Number(a.mine)), [sections]);
  useEffect(() => {
    if (!sectionId && choices[0]) setSectionId(choices[0].id);
  }, [choices, sectionId]);
  const section = choices.find((s) => s.id === sectionId) ?? null;
  const teaches = section ? (subjectsFor(section.id) ?? []).map((s) => s.name) : [];

  const roster = useApi<{ data: StudentRow[]; meta: PageMeta }>(sectionId ? `/students${qs({ sectionId, limit: 100 })}` : null);
  const timetable = useApi<{ data: SectionTimetable }>(sectionId ? `/timetable${qs({ sectionId })}` : null);

  const students = useMemo(
    () => [...(roster.data?.data ?? [])].sort((a, b) => rollKey(a.rollNumber) - rollKey(b.rollNumber) || a.name.localeCompare(b.name)),
    [roster.data],
  );
  const girls = students.filter((s) => s.gender === 'female').length;
  const boys = students.filter((s) => s.gender === 'male').length;
  const noPhone = students.filter((s) => !s.parent?.phone).length;

  if (secError) {
    return (
      <Page>
        <ErrorState message={secError} onRetry={reloadSections} />
      </Page>
    );
  }
  if (!sections) {
    return (
      <Page>
        <Spinner label="Loading your class…" />
      </Page>
    );
  }
  if (choices.length === 0) {
    return (
      <Page>
        <PageHeader title="My classes" />
        <Card>
          <EmptyState
            icon={<Users className="h-7 w-7" aria-hidden />}
            title="No classes assigned yet"
            description="You haven't been assigned any classes or subjects yet. Ask the school office to assign your classes."
          />
        </Card>
      </Page>
    );
  }

  return (
    <Page wide>
      <PageHeader
        title={section ? (section.mine ? `My class: ${section.label}` : section.label) : 'My classes'}
        description={
          section && !section.mine
            ? `You teach ${teaches.join(', ') || 'here'} in this class. Roster with parent contacts, and the class timetable.`
            : `Class roster with parent contacts, and the class timetable for the week.${mine.length === 0 ? ' You are not a class teacher this year.' : ''}`
        }
        actions={
          choices.length > 1 ? (
            <Select aria-label="Class" value={sectionId} onChange={(e) => setSectionId(e.target.value)} className="!w-56">
              {choices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                  {s.mine ? ' (my class)' : (subjectsFor(s.id) ?? []).length ? ` (${(subjectsFor(s.id) ?? []).map((x) => x.name).join(', ')})` : ''}
                </option>
              ))}
            </Select>
          ) : undefined
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Students" value={roster.data ? students.length : '–'} hint={section?.capacity ? `Capacity ${section.capacity}` : undefined} />
        <Stat label="Girls" value={roster.data ? girls : '–'} />
        <Stat label="Boys" value={roster.data ? boys : '–'} />
        <Stat label="No parent phone" value={roster.data ? noPhone : '–'} tone={noPhone > 0 ? 'warn' : 'good'} hint={noPhone > 0 ? 'Ask the office to update' : 'Every parent reachable'} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <Card title="Students" padded={false} className="min-w-0 xl:col-span-2">
          {roster.error ? (
            <ErrorState message={roster.error} onRetry={roster.reload} />
          ) : !roster.data ? (
            <Spinner label="Loading students…" />
          ) : students.length === 0 ? (
            <EmptyState title="No students in this class yet" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th className="w-12">Roll</Th>
                  <Th>Student</Th>
                  <Th>Parent</Th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id}>
                    <Td className="tabular-nums text-slate-500">{s.rollNumber ?? '–'}</Td>
                    <Td>
                      <span className="block font-medium">{s.name}</span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">{s.admissionNumber}</span>
                    </Td>
                    <Td>
                      <span className="block text-sm">{s.parent?.name ?? '–'}</span>
                      {s.parent?.phone ? (
                        <a
                          href={tel(s.parent.phone)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-300"
                          aria-label={`Call ${s.parent.name} (parent of ${s.name}) on ${showPhone(s.parent.phone)}`}
                        >
                          <Phone className="h-3 w-3" aria-hidden />
                          {showPhone(s.parent.phone)}
                        </a>
                      ) : (
                        <span className="text-xs text-slate-400">No phone</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title={<span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4 text-slate-400" aria-hidden /> Timetable</span>} padded={false} className="min-w-0 xl:col-span-3 xl:self-start">
          {timetable.error ? (
            <ErrorState message={timetable.error} onRetry={timetable.reload} />
          ) : !timetable.data ? (
            <Spinner label="Loading timetable…" />
          ) : (
            <WeekGrid tt={timetable.data.data} />
          )}
        </Card>
      </div>
    </Page>
  );
}

/** A week of periods, one day at a time on phones and the whole week from tablets up. */
export function WeekGrid({ tt, emptyTitle = 'No timetable yet', emptyText = "The school office has not set this class's timetable." }: { tt: SectionTimetable; emptyTitle?: string; emptyText?: string }) {
  const now = new Date();
  const today = now.getDay();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const [day, setDay] = useState(today >= 1 && today <= 6 ? today : 1);

  // Rows = distinct time slots across the week, in time order.
  const slots = useMemo(() => {
    const map = new Map<string, { start: string; end: string }>();
    for (const d of DAYS) for (const p of tt.days[String(d)] ?? []) map.set(`${p.start}-${p.end}`, { start: p.start, end: p.end });
    return [...map.values()].sort((a, b) => toMin(a.start) - toMin(b.start) || toMin(a.end) - toMin(b.end));
  }, [tt]);

  if (slots.length === 0) {
    return <EmptyState icon={<CalendarDays className="h-7 w-7" aria-hidden />} title={emptyTitle} description={emptyText} />;
  }

  const find = (d: number, start: string, end: string) => (tt.days[String(d)] ?? []).find((p) => p.start === start && p.end === end);
  const isNow = (d: number, p: { start: string; end: string }) => d === today && nowMin >= toMin(p.start) && nowMin < toMin(p.end);

  return (
    <>
      {/* Phone: one day at a time */}
      <div className="md:hidden">
        <div role="tablist" aria-label="Day" className="grid grid-cols-6 gap-1 border-b border-line p-3">
          {DAYS.map((d) => (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={d === day}
              onClick={() => setDay(d)}
              className={cx(
                'rounded-lg py-1.5 text-xs font-semibold',
                d === day ? 'bg-indigo-600 text-white' : d === today ? 'text-marigold-700 ring-1 ring-inset ring-marigold-300 dark:text-marigold-300' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
              )}
            >
              {WEEKDAY_SHORT[d]}
            </button>
          ))}
        </div>
        <ol aria-label={`${WEEKDAY_LONG[day]} timetable`}>
          {(tt.days[String(day)] ?? []).map((p) => (
            <li
              key={`${p.periodNo}-${p.start}`}
              className={cx('flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0', p.kind !== 'class' && 'bg-slate-50 dark:bg-slate-950/40', isNow(day, p) && 'bg-indigo-50 dark:bg-indigo-500/10')}
            >
              <span className="w-[4.5rem] shrink-0 text-xs tabular-nums text-slate-500">
                {formatTime(p.start)}
                <br />
                {formatTime(p.end)}
              </span>
              <PeriodText p={p} />
            </li>
          ))}
          {(tt.days[String(day)] ?? []).length === 0 && <li className="px-4 py-8 text-center text-sm text-slate-500">No classes on {WEEKDAY_LONG[day]}.</li>}
        </ol>
      </div>

      {/* Tablet and up: the whole week */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[640px] table-fixed border-collapse text-xs">
          <thead>
            <tr>
              <th scope="col" className="w-20 border-b border-line bg-surface-muted px-2 py-2 text-left font-medium text-slate-500">
                Time
              </th>
              {DAYS.map((d) => (
                <th
                  key={d}
                  scope="col"
                  className={cx(
                    'border-b border-line px-2 py-2 text-left font-medium',
                    d === today ? 'bg-marigold-50 text-marigold-700 shadow-[inset_0_-2px_0_theme(colors.marigold.400)] dark:bg-marigold-400/10 dark:text-marigold-300' : 'bg-surface-muted text-slate-500',
                  )}
                >
                  {WEEKDAY_SHORT[d]}
                  {d === today && <span className="ml-1 normal-case tracking-normal">(today)</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slots.map((slot) => (
              <tr key={`${slot.start}-${slot.end}`}>
                <th scope="row" className="border-b border-line px-2 py-2 text-left align-top font-normal tabular-nums text-slate-500">
                  {formatTime(slot.start)}
                  <br />
                  <span className="text-slate-400">{formatTime(slot.end)}</span>
                </th>
                {DAYS.map((d) => {
                  const p = find(d, slot.start, slot.end);
                  return (
                    <td
                      key={d}
                      aria-current={p && isNow(d, p) ? 'time' : undefined}
                      className={cx(
                        'border-b border-l border-line px-2 py-2 align-top',
                        d === today && 'bg-marigold-50/50 dark:bg-marigold-400/5',
                        p && p.kind !== 'class' && 'bg-slate-50 dark:bg-slate-950/40',
                        p && isNow(d, p) && 'bg-indigo-100 ring-2 ring-inset ring-indigo-500 dark:bg-indigo-500/20',
                      )}
                    >
                      {p ? <PeriodText p={p} compact /> : <span className="text-slate-300 dark:text-slate-700">–</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PeriodText({ p, compact = false }: { p: TimetableSlot; compact?: boolean }) {
  if (p.kind !== 'class') return <span className={cx('text-slate-500 dark:text-slate-400', compact ? 'text-xs' : 'text-sm')}>{p.label}</span>;
  return (
    <span className="min-w-0">
      <span className={cx('block font-semibold', compact ? 'truncate text-xs' : 'text-sm')}>{p.label}</span>
      {p.section ? (
        <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">{[p.section.label, p.room].filter(Boolean).join(', ')}</span>
      ) : (
        (p.teacher || p.room) && <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">{[p.teacher?.name, p.room].filter(Boolean).join(', ')}</span>
      )}
    </span>
  );
}
