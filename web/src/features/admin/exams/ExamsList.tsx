'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, Plus } from 'lucide-react';
import { Button, Card, EmptyState, ErrorState, Input, Modal, Notice, Page, PageHeader, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { useApi } from '@/lib/useApi';
import { apiSend } from '@/lib/session';
import { formatDate, titleCase } from '@/lib/format';
import { ProgressBar, errorText, fieldErrors, useFlash } from '../shared';
import { COMPONENT_CODES, EXAM_TYPES, type Exam, type Term, type Wrapped } from '../types';
import { ExamStatusBadge } from './ExamStatusBadge';

const COMPONENT_LABEL: Record<string, string> = {
  PT: 'Periodic test',
  NB: 'Notebook',
  SEA: 'Subject enrichment',
  MA: 'Multiple assessment',
  PF: 'Portfolio',
  TERM: 'Term exam',
};

export default function ExamsList() {
  const router = useRouter();
  const { data, error, loading, reload } = useApi<Wrapped<Exam[]>>('/exams');
  const flash = useFlash();
  const [creating, setCreating] = useState(false);
  const exams = data?.data ?? [];

  return (
    <Page wide>
      <PageHeader
        title="Exams & marks"
        description="Plan exams, add papers per class and enter marks"
        actions={
          <Button icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setCreating(true)}>
            New exam
          </Button>
        }
      />
      {flash.node}
      <Card padded={false}>
        {loading && !data ? (
          <Spinner label="Loading exams…" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : exams.length === 0 ? (
          <EmptyState title="No exams this year" description="Create the first exam, then add papers for each class." action={<Button onClick={() => setCreating(true)}>New exam</Button>} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Exam</Th>
                <Th>Term</Th>
                <Th>Dates</Th>
                <Th align="right">Papers</Th>
                <Th>Marks entered</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Open</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {exams.map((e) => (
                <tr key={e.id} className="cursor-pointer hover:bg-slate-50/70 dark:hover:bg-white/[0.025]" onClick={() => router.push(`/exams/${e.id}`)}>
                  <Td>
                    <Link href={`/exams/${e.id}`} onClick={(ev) => ev.stopPropagation()} className="whitespace-nowrap font-medium hover:text-indigo-700 hover:underline dark:hover:text-indigo-300">
                      {e.name}
                    </Link>
                    <p className="whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
                      {titleCase(e.examType)}
                      {e.componentCode ? `, ${COMPONENT_LABEL[e.componentCode] ?? e.componentCode}` : ''}
                    </p>
                  </Td>
                  <Td className="whitespace-nowrap">{e.term?.name ?? '-'}</Td>
                  <Td className="whitespace-nowrap">{e.startDate ? `${formatDate(e.startDate)}${e.endDate && e.endDate !== e.startDate ? ` – ${formatDate(e.endDate)}` : ''}` : '-'}</Td>
                  <Td align="right">{e.papers}</Td>
                  <Td>
                    {e.marksExpected > 0 ? (
                      <div className="min-w-[10rem]">
                        <ProgressBar value={e.marksEntered} max={e.marksExpected} label={`${e.marksEntered} of ${e.marksExpected} marks entered`} />
                        <p className="mt-0.5 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                          {e.marksEntered} / {e.marksExpected}
                        </p>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500">No papers yet</span>
                    )}
                  </Td>
                  <Td>
                    <ExamStatusBadge status={e.status} />
                  </Td>
                  <Td align="right">
                    <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <NewExamModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(e) => {
          setCreating(false);
          router.push(`/exams/${e.id}?created=1`);
        }}
      />
    </Page>
  );
}

function NewExamModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (e: Exam) => void }) {
  const terms = useApi<Wrapped<Term[]>>(open ? '/school/terms' : null);
  const empty = { name: '', examType: 'unit_test', componentCode: '', termId: '', startDate: '', endDate: '' };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setForm({ name: '', examType: 'unit_test', componentCode: '', termId: '', startDate: '', endDate: '' });
      setErrors({});
      setError(null);
    }
  }, [open]);
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (form.name.trim().length < 2) e.name = 'Give the exam a name';
    if (form.startDate && form.endDate && form.endDate < form.startDate) e.endDate = 'Must be on or after the start date';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<Wrapped<Exam>>('POST', '/exams', {
        name: form.name.trim(),
        examType: form.examType,
        componentCode: form.componentCode || undefined,
        termId: form.termId || undefined,
        startDate: form.startDate || undefined,
        endDate: form.endDate || undefined,
      });
      onCreated(res.data);
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
      title="New exam"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="exam-form" loading={busy}>
            Create exam
          </Button>
        </>
      }
    >
      <form id="exam-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Input label="Exam name" value={form.name} onChange={set('name')} error={errors.name} placeholder="e.g. Periodic Test 3" className="sm:col-span-2" required />
        <Select label="Type" value={form.examType} onChange={set('examType')} error={errors.examType}>
          {EXAM_TYPES.map((t) => (
            <option key={t} value={t}>
              {titleCase(t)}
            </option>
          ))}
        </Select>
        <Select label="Report card component" value={form.componentCode} onChange={set('componentCode')} error={errors.componentCode} hint="Where these marks count on the CBSE report card.">
          <option value="">None</option>
          {COMPONENT_CODES.map((c) => (
            <option key={c} value={c}>
              {c}, {COMPONENT_LABEL[c]}
            </option>
          ))}
        </Select>
        <Select label="Term" value={form.termId} onChange={set('termId')} error={errors.termId}>
          <option value="">No term</option>
          {terms.data?.data.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <div className="hidden sm:block" />
        <Input label="Start date" type="date" value={form.startDate} onChange={set('startDate')} error={errors.startDate} />
        <Input label="End date" type="date" value={form.endDate} min={form.startDate || undefined} onChange={set('endDate')} error={errors.endDate} />
        {error && (
          <div className="sm:col-span-2">
            <Notice tone="error">{error}</Notice>
          </div>
        )}
      </form>
    </Modal>
  );
}
