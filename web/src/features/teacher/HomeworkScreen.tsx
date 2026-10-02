'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { BookOpenCheck, Paperclip, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, Notice, Page, PageHeader, Pagination, Select, Spinner, Table, Td, Textarea, Th, cx } from '@/components/ui';
import { AttachmentChip } from '@/components/Attachments';
import { qs, useApi } from '@/lib/useApi';
import { ApiError, apiSend } from '@/lib/session';
import { MAX_FILES, friendlyError } from '@/lib/access';
import { formatDate, formatDateTime, todayIso } from '@/lib/format';
import { useSections } from './useSections';
import { EditAttachmentsModal, FileDropZone, PendingFileList, RejectedFiles, useFileQueue } from './HomeworkFiles';
import type { HomeworkRow, PageMeta, SectionChoice, Subject } from './types';

const PAGE_SIZE = 20;
const ALL = '';
const NO_SUBJECTS = "You haven't been assigned any subjects yet. Ask the school office to assign your classes.";

function dueBadge(due: string) {
  const today = todayIso();
  if (due < today) return <Badge tone="gray">Was due {formatDate(due)}</Badge>;
  if (due === today) return <Badge tone="amber">Due today</Badge>;
  return <Badge tone="indigo">Due {formatDate(due)}</Badge>;
}

/** Subjects offered when setting homework for a section: a teacher's own subjects there; admins any (or none). */
type SubjectOptions = (sectionId: string) => { options: Array<{ id: string; name: string }>; required: boolean };

export default function HomeworkScreen() {
  const { sections, defaultId, error: secError, reload: reloadSections, isTeacher, scope, subjectsFor } = useSections();
  const subjects = useApi<{ data: Subject[] }>('/school/subjects');
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState(ALL);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<HomeworkRow | null>(null);
  const [filesFor, setFilesFor] = useState<HomeworkRow | null>(null);
  const [flash, setFlash] = useState<{ tone: 'success' | 'warn'; text: string } | null>(null);

  useEffect(() => {
    if (sectionId === null && sections) setSectionId(defaultId);
  }, [sections, defaultId, sectionId]);

  // Sections the user may set homework for: teachers only where they teach a subject.
  const settable = useMemo(() => (sections ?? []).filter((s) => !isTeacher || (subjectsFor(s.id)?.length ?? 0) > 0), [sections, isTeacher, subjectsFor]);
  const canSet = settable.length > 0;
  const subjectOptions: SubjectOptions = (id) => {
    const mine = subjectsFor(id);
    if (mine) return { options: mine, required: true };
    return { options: subjects.data?.data ?? [], required: false };
  };

  // The API filters by section only; a subject filter looks at the latest 100 items of the section.
  // Teachers asking for "All classes" get their own sections (the server scopes the list).
  const path =
    sectionId === null ? null : subjectId ? `/homework${qs({ sectionId, page: 1, limit: 100 })}` : `/homework${qs({ sectionId, page, limit: PAGE_SIZE })}`;
  const list = useApi<{ data: HomeworkRow[]; meta: PageMeta }>(path);
  const rows = (list.data?.data ?? []).filter((h) => !subjectId || h.subject?.id === subjectId);

  function patchRow(id: string, change: Partial<HomeworkRow>) {
    list.setData((prev) => (prev ? { ...prev, data: prev.data.map((r) => (r.id === id ? { ...r, ...change } : r)) } : prev));
  }

  const noAssignments = isTeacher && scope && !scope.hasAny;

  return (
    <Page wide>
      <PageHeader
        title="Homework"
        description={isTeacher ? 'Set homework for the subjects you teach; parents see it in the parent app the same day.' : 'Set homework for a class; parents see it in the parent app the same day.'}
        actions={
          <Button icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setCreating(true)} disabled={!canSet}>
            Set homework
          </Button>
        }
      />

      {noAssignments ? (
        <Card>
          <EmptyState icon={<BookOpenCheck className="h-7 w-7" aria-hidden />} title="No classes assigned" description={NO_SUBJECTS} />
        </Card>
      ) : (
        <>
          {isTeacher && sections && !canSet && (
            <div className="mb-4">
              <Notice tone="info">{NO_SUBJECTS} You can still see the homework set for your class.</Notice>
            </div>
          )}
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Select
              aria-label="Class"
              value={sectionId ?? ''}
              onChange={(e) => {
                setSectionId(e.target.value);
                setPage(1);
              }}
              className="!w-48"
              disabled={!sections}
            >
              <option value={ALL}>{isTeacher ? 'All my classes' : 'All classes'}</option>
              {sections?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                  {s.mine ? ' (my class)' : ''}
                </option>
              ))}
            </Select>
            <Select aria-label="Subject filter" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="!w-48" disabled={!subjects.data}>
              <option value={ALL}>All subjects</option>
              {subjects.data?.data.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            {list.data && (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {subjectId ? `${rows.length} item${rows.length === 1 ? '' : 's'}` : `${list.data.meta.total} item${list.data.meta.total === 1 ? '' : 's'}`}
              </p>
            )}
          </div>

          {flash && (
            <div className="mb-4">
              <Notice tone={flash.tone}>{flash.text}</Notice>
            </div>
          )}

          <Card padded={false}>
            {secError ? (
              <ErrorState message={secError} onRetry={reloadSections} />
            ) : list.error ? (
              <ErrorState message={list.error} onRetry={list.reload} />
            ) : !list.data ? (
              <Spinner label="Loading homework…" />
            ) : rows.length === 0 ? (
              <EmptyState
                icon={<BookOpenCheck className="h-7 w-7" aria-hidden />}
                title="No homework here yet"
                description={subjectId ? 'Nothing set for this subject recently.' : 'Homework you set appears here and in the parent app.'}
                action={
                  canSet ? (
                    <Button size="sm" icon={<Plus className="h-3.5 w-3.5" aria-hidden />} onClick={() => setCreating(true)}>
                      Set homework
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <>
                <Table className={cx(list.loading && 'opacity-60')}>
                  <thead>
                    <tr>
                      <Th>Homework</Th>
                      <Th className="hidden md:table-cell">Class</Th>
                      <Th className="hidden lg:table-cell">Set by</Th>
                      <Th className="hidden sm:table-cell">Due</Th>
                      <Th align="right" className="hidden sm:table-cell">
                        <span className="sr-only">Actions</span>
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((h) => {
                      const author = h.createdBy?.name ?? h.teacher.name;
                      const files = h.attachments ?? [];
                      return (
                        <tr key={h.id} data-homework-id={h.id}>
                          <Td className="max-w-xl">
                            <span className="flex flex-wrap items-center gap-2">
                              <Badge tone="indigo">{h.subject?.name ?? 'General'}</Badge>
                              <span className="font-medium">{h.title}</span>
                            </span>
                            {h.details && <span className="mt-1 line-clamp-2 block text-xs text-slate-500 dark:text-slate-400">{h.details}</span>}
                            {files.length > 0 && (
                              <span className="mt-2 flex flex-wrap gap-1.5" aria-label="Attachments">
                                {files.map((a) => (
                                  <AttachmentChip key={a.id} file={{ url: a.url, name: a.fileName, sizeBytes: a.sizeBytes, mimeType: a.mimeType }} />
                                ))}
                              </span>
                            )}
                            <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400 lg:hidden">
                              <span className="md:hidden">{h.section.label}, </span>
                              {author ? `Set by ${author}` : ''}
                            </span>
                            {/* Phones: due date and actions under the title (those columns are hidden). */}
                            <span className="mt-2 flex flex-wrap items-center gap-1 sm:hidden">
                              {dueBadge(h.dueDate)}
                              {h.canEdit && (
                                <span className="ml-auto inline-flex gap-1">
                                  <Button variant="ghost" size="sm" icon={<Paperclip className="h-3.5 w-3.5" aria-hidden />} onClick={() => setFilesFor(h)} aria-label={`Edit attachments: ${h.title}`}>
                                    Files
                                  </Button>
                                  <Button variant="ghost" size="sm" icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />} onClick={() => setDeleting(h)} aria-label={`Delete homework: ${h.title}`}>
                                    Delete
                                  </Button>
                                </span>
                              )}
                            </span>
                          </Td>
                          <Td className="hidden whitespace-nowrap md:table-cell">{h.section.label}</Td>
                          <Td className="hidden lg:table-cell">
                            <span className="block">{author ? `Set by ${author}` : '–'}</span>
                            <span className="block text-xs text-slate-500 dark:text-slate-400">{formatDateTime(h.assignedAt)}</span>
                          </Td>
                          <Td className="hidden whitespace-nowrap sm:table-cell">{dueBadge(h.dueDate)}</Td>
                          <Td align="right" className="hidden sm:table-cell">
                            {h.canEdit && (
                              <span className="inline-flex gap-1">
                                <Button variant="ghost" size="sm" icon={<Paperclip className="h-3.5 w-3.5" aria-hidden />} onClick={() => setFilesFor(h)} aria-label={`Edit attachments: ${h.title}`}>
                                  Files
                                </Button>
                                <Button variant="ghost" size="sm" icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />} onClick={() => setDeleting(h)} aria-label={`Delete homework: ${h.title}`}>
                                  Delete
                                </Button>
                              </span>
                            )}
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
                {!subjectId && <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} onChange={setPage} />}
              </>
            )}
          </Card>
        </>
      )}

      {creating && canSet && (
        <CreateHomework
          sections={settable}
          subjectOptions={subjectOptions}
          initialSectionId={settable.some((s) => s.id === sectionId) ? sectionId! : settable.find((s) => s.mine)?.id ?? settable[0].id}
          initialSubjectId={subjectId}
          onClose={() => setCreating(false)}
          onDone={(row, failedFiles) => {
            setCreating(false);
            const files = row.attachments?.length ?? 0;
            setFlash(
              failedFiles
                ? { tone: 'warn', text: `Homework "${row.title}" set for ${row.section.label}, but ${failedFiles} file${failedFiles === 1 ? '' : 's'} could not be attached. Use "Files" on the homework to try again.` }
                : { tone: 'success', text: `Homework "${row.title}" set for ${row.section.label}${files ? ` with ${files} file${files === 1 ? '' : 's'}` : ''}.` },
            );
            if (sectionId && sectionId !== row.section.id) setSectionId(row.section.id);
            setPage(1);
            list.reload();
          }}
        />
      )}
      {filesFor && (
        <EditAttachmentsModal
          item={filesFor}
          onClose={() => {
            setFilesFor(null);
            list.reload();
          }}
          onChanged={(attachments) => patchRow(filesFor.id, { attachments })}
        />
      )}
      {deleting && (
        <DeleteHomework
          item={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setFlash({ tone: 'success', text: `Deleted "${deleting.title}".` });
            setDeleting(null);
            list.reload();
          }}
        />
      )}
    </Page>
  );
}

function tomorrowIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function CreateHomework({
  sections,
  subjectOptions,
  initialSectionId,
  initialSubjectId,
  onClose,
  onDone,
}: {
  sections: SectionChoice[];
  subjectOptions: SubjectOptions;
  initialSectionId: string;
  initialSubjectId: string;
  onClose: () => void;
  /** Called when the homework exists and every picked file was dealt with (`failedFiles` = files left behind). */
  onDone: (row: HomeworkRow, failedFiles: number) => void;
}) {
  const pickSubject = (sectionId: string, preferred: string) => {
    const { options, required } = subjectOptions(sectionId);
    if (options.some((o) => o.id === preferred)) return preferred;
    return required ? options[0]?.id ?? '' : '';
  };
  const [form, setForm] = useState(() => ({
    sectionId: initialSectionId,
    subjectId: pickSubject(initialSectionId, initialSubjectId),
    title: '',
    details: '',
    dueDate: tomorrowIso(),
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<HomeworkRow | null>(null);
  const queue = useFileQueue(MAX_FILES);
  const { options, required } = subjectOptions(form.sectionId);
  const failed = queue.files.filter((f) => f.status === 'failed').length;
  const busy = saving || queue.files.some((f) => f.status === 'uploading');

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (key === 'sectionId') next.subjectId = pickSubject(String(value), f.subjectId);
      return next;
    });
    setErrors((e) => ({ ...e, [key]: '' }));
  }

  async function uploadFiles(row: HomeworkRow, only?: string) {
    const { uploaded, failed: n } = await queue.uploadAll(row.id, only);
    const withFiles: HomeworkRow = { ...row, attachments: [...(row.attachments ?? []), ...uploaded] };
    setCreated(withFiles);
    return { withFiles, failed: n };
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (created) return;
    const local: Record<string, string> = {};
    if (!form.sectionId) local.sectionId = 'Choose a class';
    if (required && !form.subjectId) local.subjectId = 'Choose the subject';
    if (form.title.trim().length < 3) local.title = 'At least 3 characters';
    if (!form.dueDate) local.dueDate = 'Choose a due date';
    else if (form.dueDate < todayIso()) local.dueDate = 'The due date cannot be in the past';
    setErrors(local);
    if (Object.keys(local).length) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiSend<{ data: HomeworkRow }>('POST', '/homework', {
        sectionId: form.sectionId,
        ...(form.subjectId && { subjectId: form.subjectId }),
        title: form.title.trim(),
        ...(form.details.trim() && { details: form.details.trim() }),
        dueDate: form.dueDate,
      });
      setCreated(res.data);
      if (queue.files.length === 0) {
        onDone(res.data, 0);
        return;
      }
      const { withFiles, failed: n } = await uploadFiles(res.data);
      // Keep the dialog open when a file failed so the teacher can retry it; the homework itself is saved.
      if (n === 0) onDone(withFiles, 0);
    } catch (err) {
      const apiErr = err as ApiError;
      const body = (apiErr.details as Record<string, unknown> | undefined)?.body as Record<string, string[] | undefined> | undefined;
      if (body) setErrors(Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v?.[0] ?? 'Invalid'])));
      setError(friendlyError(apiErr));
    } finally {
      setSaving(false);
    }
  }

  async function retry(key?: string) {
    if (!created) return;
    setSaving(true);
    await uploadFiles(created, key);
    setSaving(false);
  }

  const close = () => {
    if (busy) return;
    if (created) onDone(created, failed);
    else onClose();
  };

  return (
    <Modal
      open
      title="Set homework"
      onClose={close}
      size="lg"
      footer={
        created ? (
          <>
            <Button variant="secondary" onClick={close} disabled={busy}>
              {failed ? 'Finish without these files' : 'Close'}
            </Button>
            {failed > 0 && (
              <Button onClick={() => retry()} loading={saving}>
                Retry {failed === 1 ? 'upload' : `${failed} uploads`}
              </Button>
            )}
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" form="hw-form" loading={saving}>
              {queue.files.length ? `Set homework and upload ${queue.files.length} file${queue.files.length === 1 ? '' : 's'}` : 'Set homework'}
            </Button>
          </>
        )
      }
    >
      <form id="hw-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        {created && failed > 0 && (
          <Notice tone="warn">
            The homework is saved and parents can see it. {failed} file{failed === 1 ? '' : 's'} could not be uploaded: retry, or finish without {failed === 1 ? 'it' : 'them'}.
          </Notice>
        )}
        {created && failed === 0 && busy && <Notice tone="info">Homework saved. Uploading files…</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Class" value={form.sectionId} onChange={(e) => set('sectionId', e.target.value)} error={errors.sectionId} required disabled={!!created}>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
                {s.mine ? ' (my class)' : ''}
              </option>
            ))}
          </Select>
          <Select
            label="Subject"
            value={form.subjectId}
            onChange={(e) => set('subjectId', e.target.value)}
            error={errors.subjectId}
            required={required}
            disabled={!!created}
            hint={required ? (options.length === 1 ? `You teach ${options[0].name} in this class.` : 'Only the subjects you teach in this class.') : undefined}
          >
            {!required && <option value="">General (no subject)</option>}
            {required && options.length === 0 && <option value="">No subjects assigned here</option>}
            {options.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <Input label="Title" value={form.title} onChange={(e) => set('title', e.target.value)} error={errors.title} maxLength={200} required placeholder="e.g. Exercise 4.2, questions 1 to 10" disabled={!!created} />
        <Textarea label="Details (optional)" value={form.details} onChange={(e) => set('details', e.target.value)} error={errors.details} maxLength={4000} rows={3} placeholder="Instructions for students and parents" disabled={!!created} />
        <Input label="Due date" type="date" value={form.dueDate} min={todayIso()} onChange={(e) => set('dueDate', e.target.value)} error={errors.dueDate} required className="sm:w-1/2" disabled={!!created} />
        <div className="flex flex-col gap-3">
          <p className="text-13 font-medium text-slate-700 dark:text-slate-300">Attachments (optional)</p>
          {!created && <FileDropZone onFiles={queue.add} disabled={busy} remaining={MAX_FILES - queue.files.length} />}
          <RejectedFiles messages={queue.rejected} onDismiss={queue.clearRejected} />
          <PendingFileList files={queue.files} onRemove={queue.remove} onRetry={created ? (key) => retry(key) : undefined} locked={busy} />
        </div>
      </form>
    </Modal>
  );
}

function DeleteHomework({ item, onClose, onDeleted }: { item: HomeworkRow; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await apiSend('DELETE', `/homework/${item.id}`);
      onDeleted();
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  }
  const files = item.attachments?.length ?? 0;
  return (
    <Modal
      open
      size="sm"
      title="Delete homework?"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Keep it
          </Button>
          <Button variant="danger" onClick={remove} loading={busy}>
            Delete
          </Button>
        </>
      }
    >
      {error && (
        <div className="mb-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      <p className="text-sm">
        &ldquo;{item.title}&rdquo; for {item.section.label}
        {files ? ` and its ${files} file${files === 1 ? '' : 's'}` : ''} will be removed from the parent app too.
      </p>
    </Modal>
  );
}
