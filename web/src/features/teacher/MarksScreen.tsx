'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, ClipboardList, Lock, PencilLine } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, Page, PageHeader, Select, Spinner, Tabs, cx, type BadgeTone } from '@/components/ui';
import { useApi } from '@/lib/useApi';
import { formatDate } from '@/lib/format';
import { useSections } from './useSections';
import MarksEntry from './MarksEntry';
import ReportCardsPanel from './ReportCardsPanel';
import type { ExamStatus, SectionChoice, TeacherPaper } from './types';

const EXAM_STATUS: Record<ExamStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Draft', tone: 'gray' },
  scheduled: { label: 'Scheduled', tone: 'indigo' },
  ongoing: { label: 'Ongoing', tone: 'amber' },
  completed: { label: 'Completed', tone: 'green' },
  results_published: { label: 'Results published', tone: 'green' },
};

type View = 'marks' | 'report-cards';

export default function MarksScreen() {
  const papers = useApi<{ data: TeacherPaper[] }>('/teacher/papers');
  const { sections, mine, error: secError, reload: reloadSections } = useSections();
  const [view, setView] = useState<View>('marks');
  const [open, setOpen] = useState<{ paper: TeacherPaper; sectionId: string } | null>(null);
  const [classFilter, setClassFilter] = useState<string | null>(null);

  const myClassId = mine[0]?.classId ?? '';
  const activeClass = classFilter ?? myClassId;

  const classes = useMemo(() => {
    const map = new Map<string, string>();
    papers.data?.data.forEach((p) => map.set(p.class.id, p.class.name));
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'en-IN', { numeric: true }));
  }, [papers.data]);

  const groups = useMemo(() => {
    const list = (papers.data?.data ?? []).filter((p) => !activeClass || p.class.id === activeClass);
    const byExam = new Map<string, { exam: TeacherPaper['exam']; papers: TeacherPaper[] }>();
    for (const p of list) {
      const g = byExam.get(p.exam.id) ?? { exam: p.exam, papers: [] };
      g.papers.push(p);
      byExam.set(p.exam.id, g);
    }
    return [...byExam.values()];
  }, [papers.data, activeClass]);

  function sectionsFor(paper: TeacherPaper): SectionChoice[] {
    const all = sections ?? [];
    return paper.section ? all.filter((s) => s.id === paper.section!.id) : all.filter((s) => s.classId === paper.class.id);
  }

  function openPaper(paper: TeacherPaper) {
    const options = sectionsFor(paper);
    const preferred = options.find((s) => s.mine) ?? options[0];
    setOpen({ paper, sectionId: paper.section?.id ?? preferred?.id ?? '' });
  }

  if (open) {
    return (
      <Page wide>
        <MarksEntry
          paper={open.paper}
          sections={sectionsFor(open.paper)}
          initialSectionId={open.sectionId}
          onBack={() => {
            setOpen(null);
            papers.reload();
          }}
        />
      </Page>
    );
  }

  return (
    <Page wide>
      <PageHeader title="Marks entry" description="Enter exam marks for your classes and review your class's report cards." />
      <Tabs<View>
        value={view}
        onChange={setView}
        items={[
          { value: 'marks', label: 'Exam papers' },
          { value: 'report-cards', label: 'Report cards' },
        ]}
      />

      {view === 'report-cards' ? (
        secError ? <ErrorState message={secError} onRetry={reloadSections} /> : !sections ? <Spinner /> : <ReportCardsPanel sections={mine} />
      ) : papers.error ? (
        <ErrorState message={papers.error} onRetry={papers.reload} />
      ) : !papers.data || !sections ? (
        <Spinner label="Loading exam papers…" />
      ) : papers.data.data.length === 0 ? (
        <Card>
          <EmptyState icon={<ClipboardList className="h-7 w-7" aria-hidden />} title="No exam papers yet" description="Papers appear here once the school office schedules exams for this year." />
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-3">
            <Select aria-label="Class" value={activeClass} onChange={(e) => setClassFilter(e.target.value)} className="!w-48">
              <option value="">All classes</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.id === myClassId ? ' (my class)' : ''}
                </option>
              ))}
            </Select>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {groups.reduce((n, g) => n + g.papers.length, 0)} papers in {groups.length} exam{groups.length === 1 ? '' : 's'}
            </p>
          </div>

          {groups.length === 0 && (
            <Card>
              <EmptyState title="No papers for this class" description="Pick another class or 'All classes'." />
            </Card>
          )}

          {groups.map(({ exam, papers: list }) => {
            const entered = list.reduce((n, p) => n + p.entered, 0);
            const expected = list.reduce((n, p) => n + p.students, 0);
            const st = EXAM_STATUS[exam.status] ?? { label: exam.status, tone: 'gray' as BadgeTone };
            return (
              <Card
                key={exam.id}
                padded={false}
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {exam.name}
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </span>
                }
                actions={<Progress value={entered} max={expected} />}
              >
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {list.map((p) => {
                    const done = p.students > 0 && p.entered >= p.students;
                    return (
                      <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
                        <div className="min-w-0 flex-1 basis-48">
                          <p className="font-medium">{p.subject.name}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {p.class.name}
                            {p.section ? ` ${p.section.name}` : ', all sections'}
                            {p.examDate ? ` · ${formatDate(p.examDate)}` : ''} · Max {p.maxMarks}
                            {p.passMarks !== null ? `, pass ${p.passMarks}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          {p.marksLocked ? (
                            <Badge tone="gray">
                              <Lock className="h-3 w-3" aria-hidden /> Locked
                            </Badge>
                          ) : done ? (
                            <Badge tone="green">
                              <CheckCircle2 className="h-3 w-3" aria-hidden /> Complete
                            </Badge>
                          ) : p.entered > 0 ? (
                            <Badge tone="amber">In progress</Badge>
                          ) : (
                            <Badge tone="gray">Not started</Badge>
                          )}
                          <Progress value={p.entered} max={p.students} compact />
                          <Button
                            size="sm"
                            variant={p.marksLocked || done ? 'secondary' : 'primary'}
                            icon={p.marksLocked ? <Lock className="h-3.5 w-3.5" aria-hidden /> : <PencilLine className="h-3.5 w-3.5" aria-hidden />}
                            onClick={() => openPaper(p)}
                            aria-label={`${p.marksLocked ? 'View' : 'Enter'} marks: ${exam.name}, ${p.subject.name}, ${p.class.name}`}
                            className="w-24"
                          >
                            {p.marksLocked ? 'View' : done ? 'Edit' : 'Enter'}
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
    </Page>
  );
}

function Progress({ value, max, compact = false }: { value: number; max: number; compact?: boolean }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <span className="inline-flex items-center gap-2 text-xs tabular-nums text-slate-500 dark:text-slate-400">
      <span
        className={cx('h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800', compact ? 'w-14' : 'w-24')}
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label="Marks entered"
      >
        <span className={cx('block h-full rounded-full', pct >= 100 ? 'bg-emerald-500' : 'bg-indigo-500')} style={{ width: `${pct}%` }} />
      </span>
      <span className={compact ? 'w-12' : ''}>
        {value}/{max}
      </span>
    </span>
  );
}
