'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeft, Lock, Save } from 'lucide-react';
import { Badge, Button, Card, ErrorState, Notice, PageHeader, Select, Spinner, Stat, Table, Td, Th, cx } from '@/components/ui';
import { qs, useApi } from '@/lib/useApi';
import { ApiError, apiSend } from '@/lib/session';
import { formatDate } from '@/lib/format';
import type { MarksEntryInput, MarksSheet, SectionChoice, TeacherPaper } from './types';

interface RowState {
  marks: string;
  absent: boolean;
}

const LEAVE_PROMPT = 'You have unsaved marks. Leave without saving?';

function toRow(m: { marksObtained: number | null; isAbsent: boolean }): RowState {
  return { marks: m.isAbsent || m.marksObtained === null ? '' : String(m.marksObtained), absent: m.isAbsent };
}

function validate(row: RowState, max: number): string | null {
  if (row.absent || row.marks.trim() === '') return null;
  const text = row.marks.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return 'Numbers only';
  const n = Number(text);
  if (n < 0 || n > max) return `0 to ${max}`;
  return null;
}

function same(a: RowState, b: RowState): boolean {
  if (a.absent !== b.absent) return false;
  if (a.absent) return true;
  const x = a.marks.trim();
  const y = b.marks.trim();
  if (x === y) return true;
  if (!x || !y) return false;
  return Number(x) === Number(y);
}

export default function MarksEntry({
  paper,
  sections,
  initialSectionId,
  onBack,
}: {
  paper: TeacherPaper;
  sections: SectionChoice[];
  initialSectionId: string;
  onBack: () => void;
}) {
  const [sectionId, setSectionId] = useState(initialSectionId);
  const { data, error, loading, reload } = useApi<{ data: MarksSheet }>(sectionId ? `/marks${qs({ paperId: paper.id, sectionId })}` : null);
  const sheet = data?.data.section.id === sectionId ? data.data : null;
  const locked = sheet?.paper.marksLocked ?? paper.marksLocked;
  const max = sheet?.paper.maxMarks ?? paper.maxMarks;
  const pass = sheet?.paper.passMarks ?? paper.passMarks;

  const [original, setOriginal] = useState<Record<string, RowState>>({});
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (!sheet) return;
    const next = Object.fromEntries(sheet.students.map((s) => [s.studentId, toRow(s)]));
    setOriginal(next);
    setRows(next);
    setServerErrors({});
  }, [sheet]);

  const changed = useMemo(() => (sheet?.students ?? []).filter((s) => rows[s.studentId] && original[s.studentId] && !same(rows[s.studentId], original[s.studentId])), [sheet, rows, original]);
  const dirty = changed.length > 0;
  const errors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const s of sheet?.students ?? []) {
      const e = rows[s.studentId] ? validate(rows[s.studentId], max) : null;
      if (e) out[s.studentId] = e;
      else if (serverErrors[s.studentId]) out[s.studentId] = serverErrors[s.studentId];
    }
    return out;
  }, [sheet, rows, max, serverErrors]);
  const invalid = Object.keys(errors).length > 0;

  // Unsaved-changes guard: closing the tab, and in-app links (sidebar) while dirty.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest('a[href]');
      if (a && !(a as HTMLAnchorElement).href.startsWith('tel:') && !window.confirm(LEAVE_PROMPT)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);

  const leave = useCallback(
    (then: () => void) => {
      if (!dirty || window.confirm(LEAVE_PROMPT)) then();
    },
    [dirty],
  );

  function update(studentId: string, patch: Partial<RowState>) {
    setMessage(null);
    setServerErrors((prev) => {
      if (!prev[studentId]) return prev;
      const next = { ...prev };
      delete next[studentId];
      return next;
    });
    setRows((prev) => ({ ...prev, [studentId]: { ...prev[studentId], ...patch, ...(patch.absent ? { marks: '' } : {}) } }));
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>, index: number) {
    const move = e.key === 'Enter' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!move) return;
    e.preventDefault();
    for (let i = index + move; i >= 0 && i < inputs.current.length; i += move) {
      const el = inputs.current[i];
      if (el && !el.disabled) {
        el.focus();
        el.select();
        return;
      }
    }
  }

  async function save() {
    if (!sheet || !dirty || invalid) return;
    setSaving(true);
    setMessage(null);
    const entries: MarksEntryInput[] = changed.map((s) => {
      const r = rows[s.studentId];
      return { studentId: s.studentId, isAbsent: r.absent, marksObtained: r.absent || r.marks.trim() === '' ? null : Number(r.marks) };
    });
    try {
      const res = await apiSend<{ data: { saved: number; cleared: number } }>('PUT', '/marks', { paperId: paper.id, entries });
      const { saved, cleared } = res.data;
      setMessage({ tone: 'success', text: `Saved ${saved} mark${saved === 1 ? '' : 's'}${cleared ? `, cleared ${cleared}` : ''}.` });
      setOriginal(rows);
      reload();
    } catch (e) {
      const err = e as ApiError;
      const fieldErrors: Record<string, string> = {};
      const body = (err.details as Record<string, unknown> | undefined)?.body as Record<string, string[]> | undefined;
      if (body) {
        for (const [key, msgs] of Object.entries(body)) {
          const m = /^entries\.(\d+)\./.exec(key);
          if (m && entries[Number(m[1])]) fieldErrors[entries[Number(m[1])].studentId] = msgs?.[0] ?? 'Invalid';
        }
      }
      setServerErrors(fieldErrors);
      setMessage({
        tone: 'error',
        text: err.code === 'PAPER_LOCKED' ? 'This paper was locked by the school office while you were editing. Your changes were not saved.' : err.message,
      });
      if (err.code === 'PAPER_LOCKED') reload();
    } finally {
      setSaving(false);
    }
  }

  const stats = useMemo(() => {
    const list = Object.values(rows);
    const scored = list.filter((r) => !r.absent && r.marks.trim() !== '' && !Number.isNaN(Number(r.marks))).map((r) => Number(r.marks));
    const absent = list.filter((r) => r.absent).length;
    return {
      entered: scored.length + absent,
      absent,
      average: scored.length ? Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 10) / 10 : null,
      highest: scored.length ? Math.max(...scored) : null,
      belowPass: pass !== null ? scored.filter((n) => n < pass).length : null,
    };
  }, [rows, pass]);

  return (
    <>
      <PageHeader
        back={
          <Button variant="ghost" size="sm" icon={<ArrowLeft className="h-4 w-4" aria-hidden />} onClick={() => leave(onBack)}>
            All papers
          </Button>
        }
        title={`${paper.subject.name}, ${paper.exam.name}`}
        description={`${paper.class.name}${paper.examDate ? `, ${formatDate(paper.examDate)}` : ''}, Maximum ${max}${pass !== null ? `, pass ${pass}` : ''}`}
        actions={
          sections.length > 1 ? (
            <Select
              aria-label="Section"
              value={sectionId}
              onChange={(e) => {
                const next = e.target.value;
                leave(() => setSectionId(next));
              }}
              className="!w-40"
            >
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                  {s.mine ? ' (my class)' : ''}
                </option>
              ))}
            </Select>
          ) : sections[0] ? (
            <Badge tone="indigo">{sections[0].label}</Badge>
          ) : null
        }
      />

      {!sectionId ? (
        <Notice tone="warn">No section of {paper.class.name} is set up this year, so there is nobody to enter marks for.</Notice>
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !sheet ? (
        <Spinner label="Loading students…" />
      ) : (
        <div className="flex flex-col gap-5 pb-20">
          {locked && (
            <Notice tone="warn">
              <span className="inline-flex items-center gap-1.5 font-semibold">
                <Lock className="h-4 w-4" aria-hidden /> Marks are locked.
              </span>{' '}
              The school office has locked this paper, so marks can be viewed but not changed. Ask the office to unlock it if a correction is needed.
            </Notice>
          )}
          {message && <Notice tone={message.tone}>{message.text}</Notice>}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Entered" value={`${stats.entered}/${sheet.students.length}`} tone={stats.entered === sheet.students.length ? 'good' : 'default'} hint="Absent counts as entered" />
            <Stat label="Class average" value={stats.average !== null ? `${stats.average}/${max}` : '–'} />
            <Stat label="Highest" value={stats.highest !== null ? stats.highest : '–'} />
            <Stat label={pass !== null ? `Below pass (${pass})` : 'Absent'} value={pass !== null ? stats.belowPass ?? 0 : stats.absent} tone={pass !== null && (stats.belowPass ?? 0) > 0 ? 'bad' : 'default'} hint={pass !== null ? `${stats.absent} absent` : undefined} />
          </div>

          <Card padded={false}>
            {sheet.students.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-slate-500">No students in {sheet.section.label}.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th className="w-14">Roll</Th>
                    <Th>Student</Th>
                    <Th className="w-40">Marks (of {max})</Th>
                    <Th align="center" className="w-24">
                      Absent
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.students.map((s, i) => {
                    const row = rows[s.studentId] ?? toRow(s);
                    const err = errors[s.studentId];
                    const isChanged = original[s.studentId] && !same(row, original[s.studentId]);
                    const below = !row.absent && pass !== null && row.marks.trim() !== '' && !err && Number(row.marks) < pass;
                    const inputId = `mk-${s.studentId}`;
                    return (
                      <tr key={s.studentId} className={cx(isChanged && 'bg-indigo-50/60 dark:bg-indigo-500/10')}>
                        <Td className="tabular-nums text-slate-500">{s.rollNumber ?? '–'}</Td>
                        <Td>
                          <label htmlFor={inputId} className="font-medium">
                            {s.name}
                          </label>
                          <span className="block text-xs text-slate-500 dark:text-slate-400">{s.admissionNumber}</span>
                        </Td>
                        <Td>
                          <input
                            id={inputId}
                            ref={(el) => {
                              inputs.current[i] = el;
                            }}
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            enterKeyHint="next"
                            value={row.absent ? '' : row.marks}
                            placeholder={row.absent ? 'Absent' : '–'}
                            disabled={locked || row.absent}
                            aria-invalid={err ? true : undefined}
                            aria-describedby={err ? `${inputId}-err` : undefined}
                            onChange={(e) => update(s.studentId, { marks: e.target.value })}
                            onKeyDown={(e) => onKey(e, i)}
                            onFocus={(e) => e.target.select()}
                            className={cx(
                              'h-9 w-24 rounded-lg border bg-white px-3 text-right text-sm tabular-nums focus:outline-none focus:ring-2 disabled:bg-slate-100 disabled:text-slate-400 dark:bg-slate-950 dark:disabled:bg-slate-800',
                              err
                                ? 'border-red-500 focus:ring-red-500/30'
                                : below
                                  ? 'border-amber-400 text-amber-800 focus:ring-indigo-500/30 dark:text-amber-300'
                                  : 'border-slate-300 focus:border-indigo-500 focus:ring-indigo-500/30 dark:border-slate-700',
                            )}
                          />
                          {err && (
                            <span id={`${inputId}-err`} className="ml-2 text-xs text-red-600 dark:text-red-400">
                              {err}
                            </span>
                          )}
                        </Td>
                        <Td align="center">
                          <input
                            type="checkbox"
                            aria-label={`${s.name} absent`}
                            checked={row.absent}
                            disabled={locked}
                            onChange={(e) => update(s.studentId, { absent: e.target.checked })}
                            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600"
                          />
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>

          {!locked && (
            <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t border-line bg-white/95 px-4 py-3 backdrop-blur dark:bg-slate-900/95 sm:mx-0 sm:rounded-xl sm:border">
              <p className="mr-auto text-sm text-slate-500 dark:text-slate-400" aria-live="polite">
                {invalid ? <span className="text-red-600 dark:text-red-400">Fix the highlighted marks to save.</span> : dirty ? `${changed.length} unsaved change${changed.length === 1 ? '' : 's'}` : 'All changes saved'}
                <span className="ml-2 hidden text-xs text-slate-400 md:inline">Enter / ↓ moves to the next student</span>
              </p>
              {dirty && (
                <Button variant="secondary" onClick={() => setRows(original)} disabled={saving}>
                  Undo changes
                </Button>
              )}
              <Button icon={<Save className="h-4 w-4" aria-hidden />} onClick={save} loading={saving} disabled={!dirty || invalid || loading}>
                Save marks
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
