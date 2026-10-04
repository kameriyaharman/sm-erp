'use client';

import { useState, type FormEvent } from 'react';
import { CalendarPlus, Plus, Star } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, Notice, Spinner, Table, Td, Th } from '@/components/ui';
import { useApi } from '@/lib/useApi';
import { apiSend } from '@/lib/session';
import { formatDate } from '@/lib/format';
import { ConfirmModal, errorText } from '@/features/admin/shared';
import { RowActions } from './RowActions';
import type { AcademicYear, Term, YearsResponse } from './types';

type Dialog =
  | { kind: 'new-year' }
  | { kind: 'edit-year'; year: AcademicYear }
  | { kind: 'current'; year: AcademicYear }
  | { kind: 'delete-year'; year: AcademicYear }
  | { kind: 'term'; year: AcademicYear; term?: Term }
  | { kind: 'delete-term'; year: AcademicYear; term: Term }
  | null;

export default function YearsTab({ onMessage }: { onMessage: (text: string) => void }) {
  const { data, error, loading, reload } = useApi<YearsResponse>('/setup/academic-years');
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

  if (loading && !data) return <Spinner label="Loading academic years…" />;
  if (error || !data) return <ErrorState message={error ?? 'Could not load the academic years'} onRetry={reload} />;
  const years = data.data;
  const current = years.find((y) => y.isCurrent);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {current ? (
            <>
              The current year is <strong className="text-slate-900 dark:text-white">{current.name}</strong>. Admissions, fees, attendance and exams use it.
            </>
          ) : (
            'No academic year yet. Create one to start admitting students.'
          )}
        </p>
        <Button icon={<CalendarPlus aria-hidden />} onClick={() => setDialog({ kind: 'new-year' })}>
          {years.length ? `Create ${data.meta.suggestedNext.name}` : 'Create academic year'}
        </Button>
      </div>

      {years.length === 0 && (
        <Card>
          <EmptyState title="No academic years" description="An academic year (e.g. April to March) holds the sections, fees and exams of that session." />
        </Card>
      )}

      {years.map((y) => (
        <Card
          key={y.id}
          padded={false}
          title={
            <span className="flex flex-wrap items-center gap-2">
              {y.name}
              {y.isCurrent && (
                <Badge tone="green" dot>
                  Current year
                </Badge>
              )}
            </span>
          }
          description={`${formatDate(y.startDate)} to ${formatDate(y.endDate)} · ${y.sectionCount} sections · ${y.studentCount} students`}
          actions={
            <>
              {!y.isCurrent && (
                <Button size="sm" variant="secondary" icon={<Star aria-hidden />} onClick={() => setDialog({ kind: 'current', year: y })}>
                  Make current
                </Button>
              )}
              <RowActions
                label={y.name}
                onEdit={() => setDialog({ kind: 'edit-year', year: y })}
                onDelete={y.isCurrent ? undefined : () => setDialog({ kind: 'delete-year', year: y })}
              />
            </>
          }
        >
          {y.terms.length === 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
              <p className="text-sm text-slate-500 dark:text-slate-400">No terms yet. Report cards and exams are grouped by term.</p>
              <Button size="sm" variant="secondary" icon={<Plus aria-hidden />} onClick={() => setDialog({ kind: 'term', year: y })}>
                Add term
              </Button>
            </div>
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <Th>Term</Th>
                    <Th>From</Th>
                    <Th>To</Th>
                    <Th align="right">Exams</Th>
                    <Th align="right">
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {y.terms.map((t) => (
                    <tr key={t.id}>
                      <Td className="whitespace-nowrap font-medium">{t.name}</Td>
                      <Td className="whitespace-nowrap">{formatDate(t.startDate)}</Td>
                      <Td className="whitespace-nowrap">{formatDate(t.endDate)}</Td>
                      <Td align="right">{t.examCount}</Td>
                      <Td align="right">
                        <RowActions label={t.name} onEdit={() => setDialog({ kind: 'term', year: y, term: t })} onDelete={() => setDialog({ kind: 'delete-term', year: y, term: t })} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <div className="border-t border-line px-4 py-2.5 sm:px-5">
                <Button size="sm" variant="ghost" icon={<Plus aria-hidden />} onClick={() => setDialog({ kind: 'term', year: y })}>
                  Add term
                </Button>
              </div>
            </>
          )}
        </Card>
      ))}

      {dialog?.kind === 'new-year' && (
        <YearModal
          title="Create academic year"
          initial={data.meta.suggestedNext}
          copyFrom={current ?? years[0]}
          busy={busy}
          error={dialogError}
          onClose={close}
          onSave={(body) => run(() => apiSend('POST', '/setup/academic-years', body), `Academic year ${body.name || ''} created.`)}
        />
      )}
      {dialog?.kind === 'edit-year' && (
        <YearModal
          title={`Edit ${dialog.year.name}`}
          initial={dialog.year}
          busy={busy}
          error={dialogError}
          onClose={close}
          onSave={(body) => run(() => apiSend('PATCH', `/setup/academic-years/${dialog.year.id}`, { name: body.name, startDate: body.startDate, endDate: body.endDate }), 'Academic year saved.')}
        />
      )}
      {dialog?.kind === 'current' && (
        <ConfirmModal
          open
          title={`Make ${dialog.year.name} the current year?`}
          confirmLabel="Make current"
          tone="primary"
          busy={busy}
          error={dialogError}
          onClose={close}
          onConfirm={() => run(() => apiSend('POST', `/setup/academic-years/${dialog.year.id}/make-current`), `${dialog.year.name} is now the current year.`)}
        >
          <p>New admissions, fee collection, attendance and exams will use {dialog.year.name} and its sections.</p>
          <p>Students stay in their present sections until they are promoted, so do this when the new session starts.</p>
        </ConfirmModal>
      )}
      {dialog?.kind === 'delete-year' && (
        <ConfirmModal
          open
          title={`Delete ${dialog.year.name}?`}
          confirmLabel="Delete year"
          busy={busy}
          error={dialogError}
          onClose={close}
          onConfirm={() => run(() => apiSend('DELETE', `/setup/academic-years/${dialog.year.id}`), `${dialog.year.name} deleted.`)}
        >
          <p>Its terms and any empty sections are deleted with it. A year with students, fees, exams or attendance cannot be deleted.</p>
        </ConfirmModal>
      )}
      {dialog?.kind === 'term' && (
        <TermModal
          year={dialog.year}
          term={dialog.term}
          busy={busy}
          error={dialogError}
          onClose={close}
          onSave={(body) =>
            dialog.term
              ? run(() => apiSend('PATCH', `/setup/terms/${dialog.term!.id}`, body), 'Term saved.')
              : run(() => apiSend('POST', '/setup/terms', { ...body, academicYearId: dialog.year.id }), `${body.name} added.`)
          }
        />
      )}
      {dialog?.kind === 'delete-term' && (
        <ConfirmModal
          open
          title={`Delete ${dialog.term.name} of ${dialog.year.name}?`}
          confirmLabel="Delete term"
          busy={busy}
          error={dialogError}
          onClose={close}
          onConfirm={() => run(() => apiSend('DELETE', `/setup/terms/${dialog.term.id}`), `${dialog.term.name} deleted.`)}
        >
          <p>A term that already has exams, marks or report cards cannot be deleted.</p>
        </ConfirmModal>
      )}
    </div>
  );
}

function YearModal({
  title,
  initial,
  copyFrom,
  busy,
  error,
  onClose,
  onSave,
}: {
  title: string;
  initial: { name: string; startDate: string; endDate: string };
  copyFrom?: AcademicYear;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (body: { name: string; startDate: string; endDate: string; copyFromYearId?: string | null; makeCurrent?: boolean }) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [startDate, setStart] = useState(initial.startDate);
  const [endDate, setEnd] = useState(initial.endDate);
  const [copy, setCopy] = useState(Boolean(copyFrom));
  const [makeCurrent, setMakeCurrent] = useState(!copyFrom);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit(e: FormEvent) {
    e.preventDefault();
    const x: Record<string, string> = {};
    if (!/^\d{4}(-\d{2,4})?$/.test(name.trim())) x.name = 'Use a name like 2027-28';
    if (!startDate) x.startDate = 'Choose the first day';
    if (!endDate) x.endDate = 'Choose the last day';
    else if (startDate && endDate <= startDate) x.endDate = 'The year must end after it starts';
    setErrors(x);
    if (Object.keys(x).length) return;
    onSave({ name: name.trim(), startDate, endDate, ...(copyFrom && { copyFromYearId: copy ? copyFrom.id : null, makeCurrent }) });
  }

  return (
    <Modal
      open
      title={title}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="year-form" loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <form id="year-form" onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
          <Input label="Starts" type="date" value={startDate} onChange={(e) => setStart(e.target.value)} error={errors.startDate} />
          <Input label="Ends" type="date" value={endDate} onChange={(e) => setEnd(e.target.value)} error={errors.endDate} />
        </div>
        {copyFrom && (
          <div className="space-y-3 rounded-lg border border-line p-3.5">
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} className="mt-0.5 h-4 w-4 accent-indigo-600" />
              <span>
                <span className="font-medium">Copy sections and terms from {copyFrom.name}</span>
                <span className="block text-13 text-slate-500 dark:text-slate-400">Same sections with their class teachers and capacity, and the terms moved by a year.</span>
              </span>
            </label>
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" checked={makeCurrent} onChange={(e) => setMakeCurrent(e.target.checked)} className="mt-0.5 h-4 w-4 accent-indigo-600" />
              <span>
                <span className="font-medium">Make it the current year now</span>
                <span className="block text-13 text-slate-500 dark:text-slate-400">Leave this off while you prepare the new session; switch when it starts.</span>
              </span>
            </label>
          </div>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </Modal>
  );
}

function TermModal({
  year,
  term,
  busy,
  error,
  onClose,
  onSave,
}: {
  year: AcademicYear;
  term?: Term;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (body: { name: string; startDate: string; endDate: string }) => void;
}) {
  const last = year.terms.at(-1);
  const [name, setName] = useState(term?.name ?? `Term ${year.terms.length + 1}`);
  const [startDate, setStart] = useState(term?.startDate ?? (last ? nextDay(last.endDate) : year.startDate));
  const [endDate, setEnd] = useState(term?.endDate ?? year.endDate);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit(e: FormEvent) {
    e.preventDefault();
    const x: Record<string, string> = {};
    if (!name.trim()) x.name = 'Enter a name';
    if (!startDate) x.startDate = 'Choose the first day';
    if (!endDate || endDate <= startDate) x.endDate = 'The term must end after it starts';
    if (startDate && (startDate < year.startDate || endDate > year.endDate)) x.startDate = `Within ${formatDate(year.startDate)} to ${formatDate(year.endDate)}`;
    setErrors(x);
    if (Object.keys(x).length) return;
    onSave({ name: name.trim(), startDate, endDate });
  }

  return (
    <Modal
      open
      size="sm"
      title={term ? `Edit ${term.name}` : `Add a term to ${year.name}`}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="term-form" loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <form id="term-form" onSubmit={submit} noValidate className="space-y-4">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} placeholder="e.g. Term 1, Half-yearly" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="From" type="date" min={year.startDate} max={year.endDate} value={startDate} onChange={(e) => setStart(e.target.value)} error={errors.startDate} />
          <Input label="To" type="date" min={year.startDate} max={year.endDate} value={endDate} onChange={(e) => setEnd(e.target.value)} error={errors.endDate} />
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </Modal>
  );
}

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
