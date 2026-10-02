'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarDays, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { Button, Card, cx, EmptyState, ErrorState, Input, Modal, Notice, Page, PageHeader, Select, Spinner } from '@/components/ui';
import { qs, useApi } from '@/lib/useApi';
import { ApiError, apiSend } from '@/lib/session';
import { formatTime } from '@/lib/format';
import { FilterBar, SectionSelect, errorCode, errorText, useClasses, useFlash } from './shared';
import type { PeriodKind, StaffMember, Subject, TeacherClash, Timetable, Wrapped } from './types';

const DAYS = ['1', '2', '3', '4', '5', '6'] as const;
type Day = (typeof DAYS)[number];
const DAY_NAME: Record<Day, string> = { '1': 'Mon', '2': 'Tue', '3': 'Wed', '4': 'Thu', '5': 'Fri', '6': 'Sat' };
const DAY_LONG: Record<Day, string> = { '1': 'Monday', '2': 'Tuesday', '3': 'Wednesday', '4': 'Thursday', '5': 'Friday', '6': 'Saturday' };

interface Draft {
  periodNo: number;
  start: string;
  end: string;
  kind: PeriodKind;
  subjectId: string;
  label: string;
  teacherStaffId: string;
  teacherName: string;
  subjectName: string;
  room: string;
}
type Week = Record<Day, Draft[]>;

const KIND_STYLE: Record<PeriodKind, string> = {
  class: 'border-indigo-200 bg-indigo-50/70 dark:border-indigo-500/30 dark:bg-indigo-500/10',
  break: 'border-amber-200 bg-amber-50/70 dark:border-amber-500/30 dark:bg-amber-500/10',
  assembly: 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-500/30 dark:bg-emerald-500/10',
  activity: 'border-pink-200 bg-pink-50/70 dark:border-pink-500/30 dark:bg-pink-500/10',
};

function toWeek(t: Timetable): Week {
  const week = {} as Week;
  for (const d of DAYS) {
    week[d] = (t.days[d] ?? []).map((p) => ({
      periodNo: p.periodNo,
      start: p.start.slice(0, 5),
      end: p.end.slice(0, 5),
      kind: p.kind,
      subjectId: p.subject?.id ?? '',
      subjectName: p.subject?.name ?? '',
      label: p.kind === 'class' ? '' : p.label ?? '',
      teacherStaffId: p.teacher?.staffId ?? '',
      teacherName: p.teacher?.name ?? '',
      room: p.room ?? '',
    }));
  }
  return week;
}

function addMinutes(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const t = Math.min(23 * 60 + 59, h * 60 + m + mins);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

export default function TimetablePage() {
  const { sections, loading: secLoading } = useClasses();
  const subjects = useApi<Wrapped<Subject[]>>('/school/subjects');
  const staff = useApi<Wrapped<StaffMember[]>>('/staff');
  const flash = useFlash();
  const [sectionId, setSectionId] = useState('');
  const { data, error, loading, reload, setData } = useApi<Wrapped<Timetable>>(sectionId ? `/timetable${qs({ sectionId })}` : null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Week | null>(null);
  const [cell, setCell] = useState<{ day: Day; periodNo: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<{ message: string; clashes: TeacherClash[]; cells: Set<string> } | null>(null);

  useEffect(() => {
    if (!sectionId && sections.length) setSectionId(sections[0].id);
  }, [sections, sectionId]);
  useEffect(() => {
    setEditing(false);
    setDraft(null);
    setSaveError(null);
  }, [sectionId]);

  const week = editing && draft ? draft : data ? toWeek(data.data) : null;
  const periodNos = useMemo(() => {
    if (!week) return [];
    const set = new Set<number>();
    DAYS.forEach((d) => week[d].forEach((p) => set.add(p.periodNo)));
    return [...set].sort((a, b) => a - b);
  }, [week]);
  const rowTime = (n: number) => {
    for (const d of DAYS) {
      const p = week?.[d].find((x) => x.periodNo === n);
      if (p) return `${formatTime(p.start)} – ${formatTime(p.end)}`;
    }
    return '';
  };
  const teachers = (staff.data?.data ?? []).filter((s) => s.status === 'active' && s.role === 'teacher');
  const dirty = editing && draft && data ? JSON.stringify(draft) !== JSON.stringify(toWeek(data.data)) : false;

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  function startEdit() {
    if (!data) return;
    setDraft(toWeek(data.data));
    setEditing(true);
    setSaveError(null);
  }
  function cancelEdit() {
    if (dirty && !window.confirm('Discard your timetable changes?')) return;
    setEditing(false);
    setDraft(null);
    setSaveError(null);
  }
  function addRow() {
    if (!draft) return;
    const next = (periodNos.at(-1) ?? 0) + 1;
    const lastEnd = DAYS.map((d) => draft[d].find((p) => p.periodNo === next - 1)?.end).find(Boolean) ?? '08:00';
    const updated = { ...draft };
    for (const d of DAYS) updated[d] = [...draft[d], { periodNo: next, start: lastEnd, end: addMinutes(lastEnd, 40), kind: 'class' as const, subjectId: '', subjectName: '', label: '', teacherStaffId: '', teacherName: '', room: '' }];
    setDraft(updated);
  }
  function removeRow(n: number) {
    if (!draft) return;
    const updated = { ...draft };
    for (const d of DAYS) updated[d] = draft[d].filter((p) => p.periodNo !== n);
    setDraft(updated);
  }

  async function save() {
    if (!draft) return;
    const order: Array<{ day: Day; periodNo: number }> = [];
    const periods = DAYS.flatMap((d) =>
      [...draft[d]]
        .sort((a, b) => a.periodNo - b.periodNo)
        .filter((p) => p.kind !== 'class' || p.subjectId || p.label.trim())
        .map((p) => {
          order.push({ day: d, periodNo: p.periodNo });
          return {
            weekday: Number(d),
            periodNo: p.periodNo,
            start: p.start,
            end: p.end,
            kind: p.kind,
            subjectId: p.kind === 'class' ? p.subjectId || undefined : undefined,
            label: p.kind === 'class' && p.subjectId ? undefined : p.label.trim() || undefined,
            teacherStaffId: p.teacherStaffId || undefined,
            room: p.room.trim() || undefined,
          };
        }),
    );
    setSaving(true);
    setSaveError(null);
    flash.clear();
    try {
      const res = await apiSend<Wrapped<Timetable>>('PUT', '/timetable', { sectionId, periods });
      setData(res);
      setEditing(false);
      setDraft(null);
      flash.show('success', `Timetable saved: ${periods.length} periods across the week.`);
    } catch (err) {
      const cells = new Set<string>();
      let clashes: TeacherClash[] = [];
      if (err instanceof ApiError && err.details && typeof err.details === 'object') {
        const det = err.details as Record<string, unknown>;
        if (Array.isArray(det.clashes)) {
          clashes = det.clashes as TeacherClash[];
          clashes.forEach((c) => c.weekday && c.periodNo && cells.add(`${c.weekday}-${c.periodNo}`));
        }
        const body = det.body as Record<string, unknown> | undefined;
        if (body)
          Object.keys(body).forEach((k) => {
            const m = /^periods\.(\d+)/.exec(k);
            const o = m ? order[Number(m[1])] : undefined;
            if (o) cells.add(`${o.day}-${o.periodNo}`);
          });
      }
      const msg = errorCode(err) === 'TEACHER_CLASH' ? `Teacher clash: ${errorText(err)}.` : errorText(err);
      setSaveError({ message: msg, clashes, cells });
    } finally {
      setSaving(false);
    }
  }

  const current = cell && draft ? draft[cell.day].find((p) => p.periodNo === cell.periodNo) ?? null : null;

  return (
    <Page wide>
      <PageHeader
        title="Timetable"
        description="Weekly periods for each section"
        actions={
          data &&
          (editing ? (
            <>
              <Button variant="secondary" icon={<X className="h-4 w-4" aria-hidden />} onClick={cancelEdit} disabled={saving}>
                Cancel
              </Button>
              <Button icon={<Save className="h-4 w-4" aria-hidden />} onClick={save} loading={saving} disabled={!dirty}>
                Save timetable
              </Button>
            </>
          ) : (
            <Button icon={<Pencil className="h-4 w-4" aria-hidden />} onClick={startEdit}>
              Edit timetable
            </Button>
          ))
        }
      />
      {flash.node}
      {saveError && (
        <div className="mb-4">
          <Notice tone="error">
            <p className="font-medium">{saveError.message}</p>
            {saveError.clashes.length > 1 && (
              <ul className="mt-1 list-disc pl-5">
                {saveError.clashes.map((c, i) => (
                  <li key={i}>
                    {DAY_LONG[String(c.weekday) as Day]} period {c.periodNo}: {c.teacher} is with {c.section} ({String(c.at ?? '')})
                  </li>
                ))}
              </ul>
            )}
            {saveError.cells.size > 0 && <p className="mt-1 text-xs">The periods involved are outlined in red.</p>}
          </Notice>
        </div>
      )}
      <Card padded={false}>
        <FilterBar>
          <SectionSelect
            sections={sections}
            value={sectionId}
            onChange={(id) => {
              if (dirty && !window.confirm('Discard your timetable changes?')) return;
              setSectionId(id);
            }}
            placeholder={secLoading ? 'Loading…' : 'Choose a section'}
          />
          {editing && <p className="pb-2 text-sm text-slate-500 dark:text-slate-400">Click any cell to edit it. Empty class cells are left out when you save.</p>}
        </FilterBar>
        {!sectionId ? (
          <EmptyState title="Choose a section" />
        ) : loading && !data ? (
          <Spinner label="Loading timetable…" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !week ? null : periodNos.length === 0 && !editing ? (
          <EmptyState icon={<CalendarDays className="h-7 w-7" aria-hidden />} title="No timetable yet" description="Set up the week's periods for this section." action={<Button onClick={startEdit}>Build timetable</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] table-fixed border-collapse text-sm">
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 z-10 w-28 border-b border-r border-line bg-surface-muted px-3 py-2.5 text-left text-13 font-medium text-slate-500 dark:text-slate-400">
                    Period
                  </th>
                  {DAYS.map((d) => {
                    const isToday = String(new Date().getDay()) === d;
                    return (
                      <th
                        key={d}
                        scope="col"
                        aria-current={isToday ? 'date' : undefined}
                        className={`border-b bg-surface-muted px-2 py-2.5 text-left text-13 font-medium ${isToday ? 'border-b-2 border-b-marigold-400 text-slate-900 dark:text-white' : 'border-line text-slate-500 dark:text-slate-400'}`}
                      >
                        <span className="hidden sm:inline">{DAY_LONG[d]}</span>
                        <span className="sm:hidden">{DAY_NAME[d]}</span>
                        {isToday && <span className="ml-1.5 text-xs font-medium text-marigold-700 dark:text-marigold-300">Today</span>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {periodNos.map((n) => (
                  <tr key={n}>
                    <th scope="row" className="sticky left-0 z-10 border-b border-r border-line bg-surface px-3 py-2 text-left align-top">
                      <span className="block text-sm font-semibold">P{n}</span>
                      <span className="block text-[11px] font-normal text-slate-500 dark:text-slate-400">{rowTime(n)}</span>
                      {editing && (
                        <button type="button" onClick={() => removeRow(n)} className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-red-600 hover:underline" aria-label={`Remove period ${n} from every day`}>
                          <Trash2 className="h-3 w-3" aria-hidden /> Row
                        </button>
                      )}
                    </th>
                    {DAYS.map((d) => {
                      const p = week[d].find((x) => x.periodNo === n);
                      const bad = saveError?.cells.has(`${d}-${n}`);
                      const filled = p && (p.kind !== 'class' || p.subjectId || p.label);
                      const content = filled ? (
                        <div className={cx('h-full rounded-lg border px-2 py-1.5', KIND_STYLE[p.kind], bad && 'ring-2 ring-red-500')}>
                          <p className="truncate font-medium">{p.kind === 'class' ? p.subjectName || p.label : p.label || p.kind}</p>
                          {p.teacherName && <p className="truncate text-xs text-slate-600 dark:text-slate-300">{p.teacherName}</p>}
                          <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                            {p.start}–{p.end}
                            {p.room ? `, ${p.room}` : ''}
                          </p>
                        </div>
                      ) : (
                        <div className={cx('flex h-full min-h-[3.5rem] items-center justify-center rounded-lg border border-dashed border-line text-xs text-slate-400 dark:border-slate-700', bad && 'ring-2 ring-red-500')}>
                          {editing ? '+ Add' : 'Free'}
                        </div>
                      );
                      return (
                        <td key={d} className="h-[4.5rem] border-b border-line p-1 align-top">
                          {editing ? (
                            <button type="button" className="block h-full w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" onClick={() => setCell({ day: d, periodNo: n })} aria-label={`Edit ${DAY_LONG[d]} period ${n}`}>
                              {content}
                            </button>
                          ) : (
                            content
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {editing && (
              <div className="p-3">
                <Button variant="secondary" size="sm" icon={<Plus className="h-3.5 w-3.5" aria-hidden />} onClick={addRow}>
                  Add period
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      {cell && draft && (
        <PeriodModal
          day={cell.day}
          periodNo={cell.periodNo}
          period={current}
          template={DAYS.map((d) => draft[d].find((p) => p.periodNo === cell.periodNo)).find(Boolean) ?? null}
          subjects={subjects.data?.data ?? []}
          teachers={teachers}
          onClose={() => setCell(null)}
          onSave={(p, applyAll) => {
            const updated = { ...draft };
            for (const d of applyAll ? DAYS : [cell.day]) {
              const others = draft[d].filter((x) => x.periodNo !== cell.periodNo);
              updated[d] = p ? [...others, { ...p, periodNo: cell.periodNo }].sort((a, b) => a.periodNo - b.periodNo) : others;
            }
            setDraft(updated);
            setCell(null);
          }}
        />
      )}
    </Page>
  );
}

function PeriodModal({
  day,
  periodNo,
  period,
  template,
  subjects,
  teachers,
  onClose,
  onSave,
}: {
  day: Day;
  periodNo: number;
  period: Draft | null;
  template: Draft | null;
  subjects: Subject[];
  teachers: StaffMember[];
  onClose: () => void;
  onSave: (p: Draft | null, applyAll: boolean) => void;
}) {
  const [p, setP] = useState<Draft>(
    () =>
      period ?? {
        periodNo,
        start: template?.start ?? '08:00',
        end: template?.end ?? '08:40',
        kind: 'class',
        subjectId: '',
        subjectName: '',
        label: '',
        teacherStaffId: '',
        teacherName: '',
        room: template?.room ?? '',
      },
  );
  const [applyAll, setApplyAll] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{2}:\d{2}$/.test(p.start) || !/^\d{2}:\d{2}$/.test(p.end)) return setErr('Enter start and end times.');
    if (p.end <= p.start) return setErr('The period must end after it starts.');
    if (p.kind === 'class' && !p.subjectId) return setErr('Choose the subject for a class period.');
    onSave(p, applyAll);
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${DAY_LONG[day]}, period ${periodNo}`}
      footer={
        <>
          {period && (
            <Button variant="ghost" className="mr-auto text-red-600" icon={<Trash2 className="h-4 w-4" aria-hidden />} onClick={() => onSave(null, applyAll)}>
              Clear
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="period-form">
            Apply
          </Button>
        </>
      }
    >
      <form id="period-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Select label="Kind" value={p.kind} onChange={(e) => setP({ ...p, kind: e.target.value as PeriodKind })}>
          <option value="class">Class</option>
          <option value="break">Break</option>
          <option value="assembly">Assembly</option>
          <option value="activity">Activity</option>
        </Select>
        {p.kind === 'class' ? (
          <Select
            label="Subject"
            value={p.subjectId}
            onChange={(e) => setP({ ...p, subjectId: e.target.value, subjectName: subjects.find((s) => s.id === e.target.value)?.name ?? '' })}
          >
            <option value="">Choose…</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        ) : (
          <Input label="Label" value={p.label} onChange={(e) => setP({ ...p, label: e.target.value })} maxLength={60} placeholder={p.kind === 'break' ? 'e.g. Lunch break' : 'Optional'} />
        )}
        <Input label="Starts" type="time" value={p.start} onChange={(e) => setP({ ...p, start: e.target.value })} />
        <Input label="Ends" type="time" value={p.end} onChange={(e) => setP({ ...p, end: e.target.value })} />
        <Select
          label="Teacher"
          value={p.teacherStaffId}
          onChange={(e) => setP({ ...p, teacherStaffId: e.target.value, teacherName: teachers.find((t) => t.id === e.target.value)?.name ?? '' })}
        >
          <option value="">None</option>
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.designation ? `, ${t.designation}` : ''}
            </option>
          ))}
        </Select>
        <Input label="Room" value={p.room} onChange={(e) => setP({ ...p, room: e.target.value })} maxLength={30} placeholder="Optional" />
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
          Apply to period {periodNo} on every day (Mon–Sat)
        </label>
        {err && (
          <div className="sm:col-span-2">
            <Notice tone="error">{err}</Notice>
          </div>
        )}
      </form>
    </Modal>
  );
}
