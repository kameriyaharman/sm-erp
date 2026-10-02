'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, ClipboardList, Eye, Lock, PencilLine } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, Page, PageHeader, Select, Spinner, Tabs, cx, type BadgeTone } from '@/components/ui';
import { qs, useApi } from '@/lib/useApi';
import { apiGet } from '@/lib/session';
import { friendlyError } from '@/lib/access';
import { formatDate } from '@/lib/format';
import { useSections } from './useSections';
import MarksEntry, { type MarksSectionOption } from './MarksEntry';
import ReportCardsPanel from './ReportCardsPanel';
import type { ExamStatus, SectionChoice, TeacherPaper } from './types';

const EXAM_STATUS: Record<ExamStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Draft', tone: 'gray' },
  scheduled: { label: 'Scheduled', tone: 'indigo' },
  ongoing: { label: 'Ongoing', tone: 'amber' },
  completed: { label: 'Completed', tone: 'green' },
  results_published: { label: 'Results published', tone: 'green' },
};

type View = 'marks' | 'class' | 'report-cards';
type Opened = { paper: TeacherPaper; sections: MarksSectionOption[]; sectionId: string };

export default function MarksScreen() {
  const papers = useApi<{ data: TeacherPaper[] }>('/teacher/papers');
  const { sections, mine, error: secError, reload: reloadSections, subjectsFor } = useSections();
  const [view, setView] = useState<View>('marks');
  const [open, setOpen] = useState<Opened | null>(null);
  const [classFilter, setClassFilter] = useState<string | null>(null);

  const myClassId = mine[0]?.classId ?? '';
  const activeClass = classFilter ?? '';

  const classes = useMemo(() => {
    const map = new Map<string, string>();
    papers.data?.data.forEach((p) => map.set(p.class.id, p.class.name));
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'en-IN', { numeric: true }));
  }, [papers.data]);

  const groups = useMemo(() => groupByExam((papers.data?.data ?? []).filter((p) => !activeClass || p.class.id === activeClass)), [papers.data, activeClass]);

  /** Sections of a paper the teacher may open (from the API); view-only ones are labelled. */
  function sectionsFor(paper: TeacherPaper): MarksSectionOption[] {
    if (paper.sections?.length) {
      return paper.sections.map((s) => ({ id: s.id, label: s.label, canEdit: s.canEdit, mine: mine.some((m) => m.id === s.id) }));
    }
    // Older API without `sections`: fall back to the teacher's sections of that class.
    const all = sections ?? [];
    const list = paper.section ? all.filter((s) => s.id === paper.section!.id) : all.filter((s) => s.classId === paper.class.id);
    return list.map((s) => ({ id: s.id, label: s.label, canEdit: (subjectsFor(s.id) ?? []).some((x) => x.id === paper.subject.id), mine: s.mine }));
  }

  function openPaper(paper: TeacherPaper, options = sectionsFor(paper)) {
    const preferred = options.find((s) => s.canEdit) ?? options[0];
    setOpen({ paper, sections: options, sectionId: preferred?.id ?? '' });
  }

  if (open) {
    return (
      <Page wide>
        <MarksEntry
          paper={open.paper}
          sections={open.sections}
          initialSectionId={open.sectionId}
          onBack={() => {
            setOpen(null);
            papers.reload();
          }}
        />
      </Page>
    );
  }

  const tabs: Array<{ value: View; label: string }> = [{ value: 'marks', label: 'My papers' }];
  if (mine.length) tabs.push({ value: 'class', label: `My class (${mine.map((m) => m.label.replace(/^Grade\s+/i, '')).join(', ')})` });
  tabs.push({ value: 'report-cards', label: 'Report cards' });

  return (
    <Page wide>
      <PageHeader title="Marks entry" description="Enter marks for the subjects you teach. Class teachers can also review every subject of their class and its report cards." />
      <Tabs<View> value={view} onChange={setView} items={tabs} />

      {view === 'report-cards' ? (
        secError ? <ErrorState message={secError} onRetry={reloadSections} /> : !sections ? <Spinner /> : <ReportCardsPanel sections={mine} />
      ) : view === 'class' ? (
        secError ? (
          <ErrorState message={secError} onRetry={reloadSections} />
        ) : !sections ? (
          <Spinner />
        ) : (
          <ClassPapers
            mine={mine}
            canEditSubject={(sectionId, subjectId) => (subjectsFor(sectionId) ?? []).some((s) => s.id === subjectId)}
            onOpen={(paper, section, canEdit) => openPaper(paper, [{ id: section.id, label: section.label, canEdit, mine: true }])}
          />
        )
      ) : papers.error ? (
        <ErrorState message={papers.error} onRetry={papers.reload} />
      ) : !papers.data || !sections ? (
        <Spinner label="Loading exam papers…" />
      ) : papers.data.data.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ClipboardList className="h-7 w-7" aria-hidden />}
            title="No exam papers for your subjects"
            description="Papers of the subjects you teach appear here once the school office schedules exams. If a subject is missing, ask the office to assign it to you."
          />
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

          {groups.map(({ exam, papers: list }) => (
            <ExamCard key={exam.id} exam={exam} papers={list} renderAction={(p) => <PaperButton paper={p} exam={exam.name} editable={sectionsFor(p).some((s) => s.canEdit)} onClick={() => openPaper(p)} />} />
          ))}
        </div>
      )}
    </Page>
  );
}

function groupByExam(list: TeacherPaper[]) {
  const byExam = new Map<string, { exam: TeacherPaper['exam']; papers: TeacherPaper[] }>();
  for (const p of list) {
    const g = byExam.get(p.exam.id) ?? { exam: p.exam, papers: [] };
    g.papers.push(p);
    byExam.set(p.exam.id, g);
  }
  return [...byExam.values()];
}

function ExamCard({ exam, papers: list, renderAction }: { exam: TeacherPaper['exam']; papers: TeacherPaper[]; renderAction: (p: TeacherPaper) => ReactNode }) {
  const entered = list.reduce((n, p) => n + p.entered, 0);
  const expected = list.reduce((n, p) => n + p.students, 0);
  const st = EXAM_STATUS[exam.status] ?? { label: exam.status, tone: 'gray' as BadgeTone };
  return (
    <Card
      padded={false}
      title={
        <span className="flex flex-wrap items-center gap-2">
          {exam.name}
          <Badge tone={st.tone}>{st.label}</Badge>
        </span>
      }
      actions={<Progress value={entered} max={expected} />}
    >
      <ul className="divide-y divide-line">
        {list.map((p) => {
          const done = p.students > 0 && p.entered >= p.students;
          return (
            <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
              <div className="min-w-0 flex-1 basis-48">
                <p className="font-medium">{p.subject.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {p.class.name}
                  {p.section ? ` ${p.section.name}` : ', all sections'}
                  {p.examDate ? `, ${formatDate(p.examDate)}` : ''}, Max {p.maxMarks}
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
                {renderAction(p)}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function PaperButton({ paper: p, exam, editable, onClick }: { paper: TeacherPaper; exam: string; editable: boolean; onClick: () => void }) {
  const done = p.students > 0 && p.entered >= p.students;
  const viewOnly = p.marksLocked || !editable;
  return (
    <Button
      size="sm"
      variant={viewOnly || done ? 'secondary' : 'primary'}
      icon={p.marksLocked ? <Lock className="h-3.5 w-3.5" aria-hidden /> : viewOnly ? <Eye className="h-3.5 w-3.5" aria-hidden /> : <PencilLine className="h-3.5 w-3.5" aria-hidden />}
      onClick={onClick}
      aria-label={`${viewOnly ? 'View' : 'Enter'} marks: ${exam}, ${p.subject.name}, ${p.class.name}`}
      className="w-24"
    >
      {viewOnly ? 'View' : done ? 'Edit' : 'Enter'}
    </Button>
  );
}

/**
 * Class teacher: every paper of their class (all subjects), read-only unless they also teach the subject.
 * Built from the schedule endpoints teachers may read (GET /exams, GET /exams/:id/papers?classId=).
 */
function ClassPapers({
  mine,
  canEditSubject,
  onOpen,
}: {
  mine: SectionChoice[];
  canEditSubject: (sectionId: string, subjectId: string) => boolean;
  onOpen: (paper: TeacherPaper, section: SectionChoice, canEdit: boolean) => void;
}) {
  const [sectionId, setSectionId] = useState(mine[0]?.id ?? '');
  const section = mine.find((s) => s.id === sectionId) ?? mine[0];
  const exams = useApi<{ data: Array<{ id: string; name: string; status: ExamStatus; startDate: string | null }> }>('/exams');
  const [papers, setPapers] = useState<TeacherPaper[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!exams.data || !section) return;
    let cancelled = false;
    setPapers(null);
    setError(null);
    // Newest exams first, like the teacher's own list.
    const list = [...exams.data.data].sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''));
    Promise.all(
      list.map((e) =>
        apiGet<{ data: Omit<TeacherPaper, 'exam'>[] }>(`/exams/${e.id}/papers${qs({ classId: section.classId })}`).then((r) =>
          r.data.filter((p) => !p.section || p.section.id === section.id).map((p) => ({ ...p, exam: { id: e.id, name: e.name, status: e.status } }) as TeacherPaper),
        ),
      ),
    )
      .then((all) => !cancelled && setPapers(all.flat()))
      .catch((e) => !cancelled && setError(friendlyError(e)));
    return () => {
      cancelled = true;
    };
  }, [exams.data, section, tick]);

  if (!section) return null;
  const groups = groupByExam(papers ?? []);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        {mine.length > 1 && (
          <Select aria-label="My class" value={section.id} onChange={(e) => setSectionId(e.target.value)} className="!w-44">
            {mine.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        )}
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Every subject of {section.label}. As class teacher you can view these marks; the subject teacher enters them.
        </p>
      </div>
      {exams.error || error ? (
        <ErrorState message={(exams.error ?? error)!} onRetry={() => (exams.error ? exams.reload() : setTick((t) => t + 1))} />
      ) : !papers ? (
        <Spinner label="Loading your class's papers…" />
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState icon={<ClipboardList className="h-7 w-7" aria-hidden />} title="No exam papers yet" description={`Papers for ${section.label} appear here once the school office schedules exams.`} />
        </Card>
      ) : (
        groups.map(({ exam, papers: list }) => (
          <ExamCard
            key={exam.id}
            exam={exam}
            papers={list}
            renderAction={(p) => {
              const editable = canEditSubject(section.id, p.subject.id);
              return <PaperButton paper={p} exam={exam.name} editable={editable} onClick={() => onOpen(p, section, editable)} />;
            }}
          />
        ))
      )}
    </div>
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
