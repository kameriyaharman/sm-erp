'use client';

import { useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, Notice, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { useApi } from '@/lib/useApi';
import { apiSend } from '@/lib/session';
import { ConfirmModal, errorText } from '@/features/admin/shared';
import { RowActions } from './RowActions';
import type { SetupSubject } from './types';

const TYPES: Record<SetupSubject['subjectType'], string> = { theory: 'Theory', practical: 'Practical', both: 'Theory + practical', activity: 'Activity' };

type Dialog = { kind: 'edit'; subject?: SetupSubject } | { kind: 'delete'; subject: SetupSubject } | { kind: 'toggle'; subject: SetupSubject } | null;

export default function SubjectsTab({ onMessage }: { onMessage: (text: string) => void }) {
  const { data, error, loading, reload } = useApi<{ data: SetupSubject[] }>('/setup/subjects');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const close = () => {
    setDialog(null);
    setDialogError(null);
  };
  async function run(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setDialogError(null);
    try {
      await fn();
      close();
      onMessage(message);
      reload();
    } catch (err) {
      setDialogError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <Spinner label="Loading subjects…" />;
  if (error || !data) return <ErrorState message={error ?? 'Could not load the subjects'} onRetry={reload} />;
  const subjects = data.data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">The subjects taught in this branch. Exams, marks, timetables and teacher assignments use this list.</p>
        <Button icon={<Plus aria-hidden />} onClick={() => setDialog({ kind: 'edit' })}>
          Add subject
        </Button>
      </div>
      <Card padded={false}>
        {subjects.length === 0 ? (
          <EmptyState title="No subjects yet" description="Add the subjects you teach, e.g. English (ENG), Mathematics (MAT)." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Subject</Th>
                <Th>Code</Th>
                <Th>Type</Th>
                <Th>Assessed by</Th>
                <Th align="right">Teachers</Th>
                <Th align="right">Exam papers</Th>
                <Th>Status</Th>
                <Th align="right">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {subjects.map((s) => (
                <tr key={s.id} className={s.status === 'inactive' ? 'opacity-60' : undefined}>
                  <Td className="whitespace-nowrap font-medium">{s.name}</Td>
                  <Td className="font-mono text-13">{s.code}</Td>
                  <Td className="whitespace-nowrap">{TYPES[s.subjectType]}</Td>
                  <Td className="whitespace-nowrap">{s.isGradedOnly ? 'Grade only' : 'Marks'}</Td>
                  <Td align="right">{s.teacherAssignments}</Td>
                  <Td align="right">{s.examPapers}</Td>
                  <Td>
                    <button type="button" onClick={() => setDialog({ kind: 'toggle', subject: s })} className="rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500" title={s.status === 'active' ? 'Mark inactive' : 'Mark active'}>
                      <Badge tone={s.status === 'active' ? 'green' : 'gray'}>{s.status === 'active' ? 'Active' : 'Inactive'}</Badge>
                    </button>
                  </Td>
                  <Td align="right">
                    <RowActions label={s.name} onEdit={() => setDialog({ kind: 'edit', subject: s })} onDelete={() => setDialog({ kind: 'delete', subject: s })} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {dialog?.kind === 'edit' && (
        <SubjectModal
          subject={dialog.subject}
          busy={busy}
          error={dialogError}
          onClose={close}
          onSave={(body) =>
            dialog.subject
              ? run(() => apiSend('PATCH', `/setup/subjects/${dialog.subject!.id}`, body), `${body.name} saved.`)
              : run(() => apiSend('POST', '/setup/subjects', body), `${body.name} added.`)
          }
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmModal open title={`Delete ${dialog.subject.name}?`} confirmLabel="Delete subject" busy={busy} error={dialogError} onClose={close} onConfirm={() => run(() => apiSend('DELETE', `/setup/subjects/${dialog.subject.id}`), `${dialog.subject.name} deleted.`)}>
          <p>A subject with exam papers, marks, homework, timetable periods or teachers cannot be deleted. Mark it inactive instead.</p>
        </ConfirmModal>
      )}
      {dialog?.kind === 'toggle' && (
        <ConfirmModal
          open
          tone="primary"
          title={dialog.subject.status === 'active' ? `Mark ${dialog.subject.name} inactive?` : `Mark ${dialog.subject.name} active?`}
          confirmLabel={dialog.subject.status === 'active' ? 'Mark inactive' : 'Mark active'}
          busy={busy}
          error={dialogError}
          onClose={close}
          onConfirm={() => run(() => apiSend('PATCH', `/setup/subjects/${dialog.subject.id}`, { status: dialog.subject.status === 'active' ? 'inactive' : 'active' }), `${dialog.subject.name} is now ${dialog.subject.status === 'active' ? 'inactive' : 'active'}.`)}
        >
          <p>{dialog.subject.status === 'active' ? 'It is hidden from new exams, timetables and homework. Past marks stay on report cards.' : 'It appears in subject lists again.'}</p>
        </ConfirmModal>
      )}
    </div>
  );
}

function SubjectModal({
  subject,
  busy,
  error,
  onClose,
  onSave,
}: {
  subject?: SetupSubject;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (b: { name: string; code: string; subjectType: SetupSubject['subjectType']; isGradedOnly: boolean; displayOrder?: number }) => void;
}) {
  const [name, setName] = useState(subject?.name ?? '');
  const [code, setCode] = useState(subject?.code ?? '');
  const [type, setType] = useState<SetupSubject['subjectType']>(subject?.subjectType ?? 'theory');
  const [graded, setGraded] = useState(subject?.isGradedOnly ?? false);
  const [order, setOrder] = useState(subject ? String(subject.displayOrder) : '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  function submit(e: FormEvent) {
    e.preventDefault();
    const x: Record<string, string> = {};
    if (!name.trim()) x.name = 'Enter the subject name';
    if (!/^[A-Za-z0-9-]{1,20}$/.test(code.trim())) x.code = 'Letters, digits or - (e.g. ENG)';
    if (order && !/^\d{1,3}$/.test(order)) x.order = 'A number';
    setErrors(x);
    if (Object.keys(x).length) return;
    onSave({ name: name.trim(), code: code.trim().toUpperCase(), subjectType: type, isGradedOnly: graded, ...(order && { displayOrder: Number(order) }) });
  }
  return (
    <Modal
      open
      size="sm"
      title={subject ? `Edit ${subject.name}` : 'Add subject'}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="subject-form" loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <form id="subject-form" onSubmit={submit} noValidate className="space-y-4">
        <Input
          label="Subject name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => !code && name.trim() && setCode(name.trim().replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase())}
          error={errors.name}
          placeholder="e.g. Computer Science"
        />
        <div className="grid grid-cols-2 gap-4">
          <Input label="Code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} error={errors.code} placeholder="e.g. CS" />
          <Input label="Order in lists" inputMode="numeric" value={order} onChange={(e) => setOrder(e.target.value)} error={errors.order} placeholder="Auto" />
        </div>
        <Select label="Type" value={type} onChange={(e) => setType(e.target.value as SetupSubject['subjectType'])}>
          {Object.entries(TYPES).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={graded} onChange={(e) => setGraded(e.target.checked)} className="mt-0.5 h-4 w-4 accent-indigo-600" />
          <span>
            <span className="font-medium">Graded only (no marks)</span>
            <span className="block text-13 text-slate-500 dark:text-slate-400">Co-scholastic areas like Art, Health &amp; PE or Discipline get a grade on the report card.</span>
          </span>
        </label>
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </Modal>
  );
}
