'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Lock, Save } from 'lucide-react';
import { Button, Card, cx, EmptyState, ErrorState, Notice, Select, Spinner } from '@/components/ui';
import { qs, useApi } from '@/lib/useApi';
import { apiSend } from '@/lib/session';
import { errorText, type FlatSection } from '../shared';
import type { MarksSheet, Paper, Wrapped } from '../types';

interface Row {
  studentId: string;
  name: string;
  rollNumber: string | null;
  admissionNumber: string;
  marks: string;
  absent: boolean;
  origMarks: string;
  origAbsent: boolean;
}

function toRows(sheet: MarksSheet): Row[] {
  return sheet.students.map((s) => {
    const m = s.marksObtained === null || s.marksObtained === undefined ? '' : String(Number(s.marksObtained));
    return { studentId: s.studentId, name: s.name, rollNumber: s.rollNumber, admissionNumber: s.admissionNumber, marks: m, absent: s.isAbsent, origMarks: m, origAbsent: s.isAbsent };
  });
}

function rowError(r: Row, max: number): string | null {
  if (r.absent || r.marks.trim() === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(r.marks.trim())) return 'Numbers only';
  const v = Number(r.marks);
  if (v < 0 || v > max) return `0 to ${max}`;
  return null;
}
const isDirty = (r: Row) => r.marks.trim() !== r.origMarks || r.absent !== r.origAbsent;

/**
 * Marks entry for one paper and one section: keyboard friendly (Enter / ↓ next student, ↑ previous),
 * validates 0..max, saves only changed rows, warns before leaving with unsaved changes.
 */
export default function MarksGrid({ paper, sections, onSaved, onDirtyChange }: { paper: Paper; sections: FlatSection[]; onSaved: () => void; onDirtyChange?: (dirty: boolean) => void }) {
  const paperSections = useMemo(() => (paper.section ? sections.filter((s) => s.id === paper.section?.id) : sections.filter((s) => s.classId === paper.class.id)), [paper, sections]);
  const [sectionId, setSectionId] = useState('');
  useEffect(() => {
    setSectionId(paper.section?.id ?? (paperSections.length === 1 ? paperSections[0].id : ''));
  }, [paper.id, paper.section?.id, paperSections]);

  const { data, error, loading, reload } = useApi<Wrapped<MarksSheet>>(sectionId ? `/marks${qs({ paperId: paper.id, sectionId })}` : null);
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (data) setRows(toRows(data.data));
  }, [data]);

  const sheet = data?.data;
  const max = sheet?.paper.maxMarks ?? paper.maxMarks;
  const locked = sheet?.paper.marksLocked ?? paper.marksLocked;
  const dirtyRows = rows.filter(isDirty);
  const dirty = dirtyRows.length > 0;
  const invalid = rows.some((r) => rowError(r, max));
  const entered = rows.filter((r) => r.absent || r.marks.trim() !== '').length;

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const update = (i: number, patch: Partial<Row>) => {
    setResult(null);
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };

  const focusRow = useCallback((i: number) => {
    const el = inputs.current[i];
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  function onKey(e: KeyboardEvent<HTMLInputElement>, i: number) {
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      // skip absent rows (their input is disabled)
      for (let j = i + 1; j < rows.length; j++) if (!rows[j].absent) return focusRow(j);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      for (let j = i - 1; j >= 0; j--) if (!rows[j].absent) return focusRow(j);
    } else if ((e.key === 'a' || e.key === 'A') && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      update(i, { absent: !rows[i].absent, marks: '' });
    }
  }

  function changeSection(id: string) {
    if (dirty && !window.confirm('You have unsaved marks. Discard them?')) return;
    setResult(null);
    setSectionId(id);
  }

  async function save() {
    if (!dirty || invalid) return;
    setSaving(true);
    setResult(null);
    try {
      const entries = dirtyRows.map((r) => ({
        studentId: r.studentId,
        marksObtained: r.absent || r.marks.trim() === '' ? null : Number(r.marks),
        isAbsent: r.absent,
      }));
      const res = await apiSend<Wrapped<{ saved: number; cleared: number }>>('PUT', '/marks', { paperId: paper.id, entries });
      setRows((prev) => prev.map((r) => ({ ...r, marks: r.marks.trim(), origMarks: r.absent ? '' : r.marks.trim(), origAbsent: r.absent })));
      const { saved, cleared } = res.data;
      setResult({ tone: 'success', text: `Saved ${saved} mark${saved === 1 ? '' : 's'}${cleared ? `, cleared ${cleared}` : ''}.` });
      onSaved();
    } catch (err) {
      setResult({ tone: 'error', text: errorText(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title={
        <span>
          Marks for {paper.subject.name} <span className="font-normal text-slate-500 dark:text-slate-400">({paper.class.name}, out of {max})</span>
        </span>
      }
      padded={false}
      actions={
        sheet &&
        !locked && (
          <Button size="sm" icon={<Save className="h-3.5 w-3.5" aria-hidden />} onClick={save} loading={saving} disabled={!dirty || invalid}>
            Save{dirty ? ` (${dirtyRows.length})` : ''}
          </Button>
        )
      }
    >
      <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
        <Select label="Section" value={sectionId} onChange={(e) => changeSection(e.target.value)} disabled={!!paper.section || paperSections.length < 2} className="min-w-[10rem]">
          {!sectionId && <option value="">Choose…</option>}
          {paperSections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
        {sheet && (
          <p className="pb-2 text-sm text-slate-500 dark:text-slate-400">
            {entered} of {rows.length} entered{paper.passMarks !== null ? `, pass mark ${paper.passMarks}` : ''}
          </p>
        )}
        <p className="ml-auto hidden pb-2 text-xs text-slate-400 md:block">Enter or ↓ for next, ↑ for previous, A marks absent</p>
      </div>
      {result && (
        <div className="px-4 pt-4">
          <Notice tone={result.tone}>{result.text}</Notice>
        </div>
      )}
      {locked && sheet && (
        <div className="px-4 pt-4">
          <Notice tone="warn">
            <span className="inline-flex items-center gap-1.5">
              <Lock className="h-4 w-4" aria-hidden /> Marks for this paper are locked. Unlock the paper to make changes.
            </span>
          </Notice>
        </div>
      )}
      {!sectionId ? (
        <EmptyState title="Choose a section" description="Pick the section whose marks you want to enter." />
      ) : loading && !sheet ? (
        <Spinner label="Loading students…" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : rows.length === 0 ? (
        <EmptyState title="No students in this section" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-13 font-medium text-slate-500 dark:text-slate-400">
                <th scope="col" className="w-14 border-b border-line bg-slate-50 px-3 py-2.5 dark:bg-slate-900/60">Roll</th>
                <th scope="col" className="border-b border-line bg-slate-50 px-3 py-2.5 dark:bg-slate-900/60">Student</th>
                <th scope="col" className="w-36 border-b border-line bg-slate-50 px-3 py-2.5 dark:bg-slate-900/60">Marks / {max}</th>
                <th scope="col" className="w-24 border-b border-line bg-slate-50 px-3 py-2.5 text-center dark:bg-slate-900/60">Absent</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const err = rowError(r, max);
                const changed = isDirty(r);
                const below = !err && !r.absent && r.marks !== '' && paper.passMarks !== null && Number(r.marks) < paper.passMarks;
                return (
                  <tr key={r.studentId} className={cx(changed && 'bg-amber-50/60 dark:bg-amber-500/5')}>
                    <td className="border-b border-line px-3 py-1.5 tabular-nums text-slate-500">{r.rollNumber ?? '-'}</td>
                    <td className="border-b border-line px-3 py-1.5">
                      <span className="whitespace-nowrap font-medium">{r.name}</span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">{r.admissionNumber}</span>
                    </td>
                    <td className="border-b border-line px-3 py-1.5">
                      <input
                        ref={(el) => {
                          inputs.current[i] = el;
                        }}
                        type="text"
                        inputMode="decimal"
                        aria-label={`Marks for ${r.name}`}
                        aria-invalid={err ? true : undefined}
                        value={r.absent ? '' : r.marks}
                        placeholder={r.absent ? 'AB' : '-'}
                        disabled={r.absent || locked}
                        onChange={(e) => update(i, { marks: e.target.value })}
                        onKeyDown={(e) => onKey(e, i)}
                        onFocus={(e) => e.target.select()}
                        className={cx(
                          'h-9 w-24 rounded-lg border bg-white px-2 text-right text-sm tabular-nums focus:outline-none focus:ring-2 disabled:bg-slate-100 dark:bg-slate-950 dark:disabled:bg-slate-800',
                          err ? 'border-red-500 focus:ring-red-500/30' : 'border-slate-300 focus:border-indigo-500 focus:ring-indigo-500/30 dark:border-slate-700',
                          below && 'text-red-700 dark:text-red-400',
                        )}
                      />
                      {err && <span className="ml-2 text-xs text-red-600 dark:text-red-400">{err}</span>}
                    </td>
                    <td className="border-b border-line px-3 py-1.5 text-center">
                      <input
                        type="checkbox"
                        aria-label={`${r.name} absent`}
                        checked={r.absent}
                        disabled={locked}
                        onChange={(e) => update(i, { absent: e.target.checked, marks: e.target.checked ? '' : r.marks })}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!locked && (
            <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-3">
              {dirty && <span className="text-sm text-amber-700 dark:text-amber-300">{dirtyRows.length} unsaved change{dirtyRows.length === 1 ? '' : 's'}</span>}
              {invalid && <span className="text-sm text-red-600 dark:text-red-400">Fix the highlighted marks first.</span>}
              <Button
                variant="secondary"
                disabled={!dirty || saving}
                onClick={() => {
                  setRows((prev) => prev.map((r) => ({ ...r, marks: r.origMarks, absent: r.origAbsent })));
                  setResult(null);
                }}
              >
                Undo changes
              </Button>
              <Button icon={<Save className="h-4 w-4" aria-hidden />} onClick={save} loading={saving} disabled={!dirty || invalid}>
                Save marks
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
