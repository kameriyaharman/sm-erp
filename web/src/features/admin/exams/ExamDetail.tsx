'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { ArrowLeft, Lock, LockOpen, PenLine, Plus } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, Notice, Page, PageHeader, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { useApi } from '@/lib/useApi';
import { apiSend } from '@/lib/session';
import { formatDate, titleCase } from '@/lib/format';
import { ProgressBar, errorText, fieldErrors, useClasses, useFlash } from '../shared';
import { EXAM_STATUSES, type ClassInfo, type Exam, type ExamStatus, type Paper, type Subject, type Wrapped } from '../types';
import { ExamStatusBadge } from './ExamStatusBadge';
import MarksGrid from './MarksGrid';

export default function ExamDetail() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const exams = useApi<Wrapped<Exam[]>>('/exams');
  const papers = useApi<Wrapped<Paper[]>>(`/exams/${id}/papers`);
  const { classes, sections } = useClasses();
  const flash = useFlash();
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [lockBusy, setLockBusy] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);

  const exam = exams.data?.data.find((e) => e.id === id);
  const paperList = useMemo(() => papers.data?.data ?? [], [papers.data]);
  const byClass = useMemo(() => {
    const map = new Map<string, { name: string; papers: Paper[] }>();
    for (const p of paperList) {
      if (!map.has(p.class.id)) map.set(p.class.id, { name: p.class.name, papers: [] });
      map.get(p.class.id)!.papers.push(p);
    }
    return [...map.entries()];
  }, [paperList]);
  const selectedPaper = paperList.find((p) => p.id === selected) ?? null;

  useEffect(() => {
    if (params.get('created') === '1') flash.show('success', 'Exam created. Add papers for each class next.');
  }, [params, flash.show]);

  const setDirty = useCallback((d: boolean) => {
    dirtyRef.current = d;
  }, []);

  function openMarks(paperId: string) {
    if (selected && selected !== paperId && dirtyRef.current && !window.confirm('You have unsaved marks for another paper. Discard them?')) return;
    setSelected(paperId);
    setTimeout(() => gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  async function changeStatus(status: ExamStatus) {
    setStatusBusy(true);
    try {
      await apiSend('PATCH', `/exams/${id}`, { status });
      flash.show('success', `Exam marked as ${status === 'results_published' ? 'results published' : titleCase(status).toLowerCase()}.`);
      exams.reload();
    } catch (err) {
      flash.show('error', errorText(err));
    } finally {
      setStatusBusy(false);
    }
  }

  async function toggleLock(p: Paper) {
    setLockBusy(p.id);
    try {
      await apiSend('PATCH', `/papers/${p.id}`, { marksLocked: !p.marksLocked });
      flash.show('success', `${p.subject.name} (${p.class.name}) ${p.marksLocked ? 'unlocked: marks can be edited' : 'locked: marks can no longer be changed'}.`);
      papers.reload();
    } catch (err) {
      flash.show('error', errorText(err));
    } finally {
      setLockBusy(null);
    }
  }

  if ((exams.loading && !exams.data) || (papers.loading && !papers.data)) return <Spinner label="Loading exam…" />;
  if (exams.error) return <ErrorState message={exams.error} onRetry={exams.reload} />;
  if (!exam) return <ErrorState message="This exam was not found in the current academic year." />;

  return (
    <Page wide>
      <PageHeader
        back={
          <Link href="/exams" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Exams
          </Link>
        }
        title={exam.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{titleCase(exam.examType)}</span>
            {exam.term && <span>{exam.term.name}</span>}
            {exam.startDate && (
              <span>
                {formatDate(exam.startDate)}
                {exam.endDate && exam.endDate !== exam.startDate ? ` – ${formatDate(exam.endDate)}` : ''}
              </span>
            )}
            <ExamStatusBadge status={exam.status} />
          </span>
        }
        actions={
          <>
            <div className="w-48">
              <Select aria-label="Exam status" value={exam.status} onChange={(e) => changeStatus(e.target.value as ExamStatus)} disabled={statusBusy}>
              {EXAM_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s === 'results_published' ? 'Results published' : titleCase(s)}
                </option>
              ))}
            </Select>
            </div>
            <Button icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setAdding(true)}>
              Add papers
            </Button>
          </>
        }
      />
      {flash.node}
      {exam.marksExpected > 0 && (
        <div className="mb-6 rounded-xl border border-line bg-surface p-4">
          <p className="mb-2 text-sm font-medium">
            Marks entered: {exam.marksEntered} of {exam.marksExpected}
          </p>
          <ProgressBar value={exam.marksEntered} max={exam.marksExpected} label="Marks entered" />
        </div>
      )}

      {papers.error ? (
        <ErrorState message={papers.error} onRetry={papers.reload} />
      ) : paperList.length === 0 ? (
        <Card>
          <EmptyState title="No papers yet" description="Add one paper per subject for each class sitting this exam." action={<Button onClick={() => setAdding(true)}>Add papers</Button>} />
        </Card>
      ) : (
        <div className="space-y-6">
          {byClass.map(([classId, group]) => (
            <Card key={classId} title={`${group.name}, ${group.papers.length} paper${group.papers.length === 1 ? '' : 's'}`} padded={false}>
              <Table>
                <thead>
                  <tr>
                    <Th>Subject</Th>
                    <Th>Date</Th>
                    <Th align="right">Max</Th>
                    <Th align="right">Pass</Th>
                    <Th>Entered</Th>
                    <Th>Marks</Th>
                    <Th align="right">
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {group.papers.map((p) => (
                    <tr key={p.id} className={selected === p.id ? 'bg-indigo-50/60 dark:bg-indigo-500/10' : undefined}>
                      <Td className="whitespace-nowrap font-medium">
                        {p.subject.name}
                        {p.section && <span className="ml-1 text-xs text-slate-500">({p.section.name})</span>}
                      </Td>
                      <Td className="whitespace-nowrap">{p.examDate ? formatDate(p.examDate) : '-'}</Td>
                      <Td align="right">{p.maxMarks}</Td>
                      <Td align="right">{p.passMarks ?? '-'}</Td>
                      <Td>
                        <div className="min-w-[9rem]">
                          <ProgressBar value={p.entered} max={p.students} label={`${p.entered} of ${p.students}`} />
                        </div>
                      </Td>
                      <Td>{p.marksLocked ? <Badge tone="amber"><Lock className="h-3 w-3" aria-hidden /> Locked</Badge> : <Badge tone="green">Open</Badge>}</Td>
                      <Td align="right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost" loading={lockBusy === p.id} icon={p.marksLocked ? <LockOpen className="h-3.5 w-3.5" aria-hidden /> : <Lock className="h-3.5 w-3.5" aria-hidden />} onClick={() => toggleLock(p)}>
                            {p.marksLocked ? 'Unlock' : 'Lock'}
                          </Button>
                          <Button size="sm" variant={selected === p.id ? 'primary' : 'secondary'} icon={<PenLine className="h-3.5 w-3.5" aria-hidden />} onClick={() => openMarks(p.id)}>
                            {p.marksLocked ? 'View marks' : 'Enter marks'}
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ))}
        </div>
      )}

      <div ref={gridRef} className="mt-6 scroll-mt-20">
        {selectedPaper && (
          <MarksGrid
            key={selectedPaper.id}
            paper={selectedPaper}
            sections={sections}
            onDirtyChange={setDirty}
            onSaved={() => {
              papers.reload();
              exams.reload();
            }}
          />
        )}
      </div>

      <AddPapersModal
        open={adding}
        examId={id}
        examStart={exam.startDate}
        classes={classes}
        onClose={() => setAdding(false)}
        onCreated={(created, skipped) => {
          setAdding(false);
          flash.show('success', `Added ${created} paper${created === 1 ? '' : 's'}${skipped ? `; ${skipped} already existed and were skipped` : ''}.`);
          papers.reload();
          exams.reload();
        }}
      />
    </Page>
  );
}

function AddPapersModal({
  open,
  examId,
  examStart,
  classes,
  onClose,
  onCreated,
}: {
  open: boolean;
  examId: string;
  examStart: string | null;
  classes: ClassInfo[];
  onClose: () => void;
  onCreated: (created: number, skipped: number) => void;
}) {
  const subjects = useApi<Wrapped<Subject[]>>(open ? '/school/subjects' : null);
  const [classId, setClassId] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [examDate, setExamDate] = useState('');
  const [maxMarks, setMaxMarks] = useState('80');
  const [passMarks, setPassMarks] = useState('27');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setClassId('');
      setPicked(new Set());
      setExamDate(examStart ?? '');
      setMaxMarks('80');
      setPassMarks('27');
      setErrors({});
      setError(null);
    }
  }, [open, examStart]);
  const list = (subjects.data?.data ?? []).filter((s) => !s.isGradedOnly);
  const toggle = (sid: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return next;
    });

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (!classId) e.classId = 'Choose a class';
    if (picked.size === 0) e.subjectIds = 'Pick at least one subject';
    if (!examDate) e.examDate = 'Choose the exam date';
    const max = Number(maxMarks);
    const pass = passMarks.trim() === '' ? undefined : Number(passMarks);
    if (!(max > 0 && max <= 1000)) e.maxMarks = 'Between 1 and 1000';
    if (pass !== undefined && (Number.isNaN(pass) || pass < 0 || pass > max)) e.passMarks = 'Cannot exceed the maximum';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<Wrapped<{ created: number; skipped: number }>>('POST', `/exams/${examId}/papers`, { classId, subjectIds: [...picked], examDate, maxMarks: max, passMarks: pass });
      onCreated(res.data.created, res.data.skipped);
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title="Add papers"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="papers-form" loading={busy}>
            Add {picked.size || ''} paper{picked.size === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <form id="papers-form" onSubmit={submit} noValidate className="space-y-4">
        <Select label="Class" value={classId} onChange={(e) => setClassId(e.target.value)} error={errors.classId} hint="Papers are set for every section of the class.">
          <option value="">Choose…</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <fieldset>
          <legend className="mb-1 flex w-full items-center justify-between text-sm font-medium text-slate-700 dark:text-slate-300">
            Subjects
            {list.length > 0 && (
              <button type="button" className="text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-300" onClick={() => setPicked(picked.size === list.length ? new Set() : new Set(list.map((s) => s.id)))}>
                {picked.size === list.length ? 'Clear all' : 'Select all'}
              </button>
            )}
          </legend>
          {subjects.loading ? (
            <Spinner />
          ) : (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {list.map((s) => (
                <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm hover:bg-slate-50 has-[:checked]:border-indigo-400 has-[:checked]:bg-indigo-50 dark:border-slate-700 dark:hover:bg-slate-800 dark:has-[:checked]:bg-indigo-500/10">
                  <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} className="h-4 w-4 rounded border-slate-300" />
                  {s.name}
                  <span className="ml-auto text-xs text-slate-400">{s.code}</span>
                </label>
              ))}
            </div>
          )}
          {errors.subjectIds && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.subjectIds}</p>}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Exam date" type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} error={errors.examDate} />
          <Input label="Maximum marks" inputMode="decimal" value={maxMarks} onChange={(e) => setMaxMarks(e.target.value)} error={errors.maxMarks} />
          <Input label="Pass marks" inputMode="decimal" value={passMarks} onChange={(e) => setPassMarks(e.target.value)} error={errors.passMarks} hint="Optional" />
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </Modal>
  );
}
