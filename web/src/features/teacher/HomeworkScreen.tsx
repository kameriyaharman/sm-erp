'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { BookOpenCheck, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, Notice, Page, PageHeader, Pagination, Select, Spinner, Table, Td, Textarea, Th, cx } from '@/components/ui';
import { qs, useApi } from '@/lib/useApi';
import { ApiError, apiSend } from '@/lib/session';
import { formatDate, formatDateTime, todayIso } from '@/lib/format';
import { fullName, isAdminRole, useSections } from './useSections';
import type { HomeworkRow, PageMeta, SectionChoice, Subject } from './types';

const PAGE_SIZE = 20;
const ALL = '';

function dueBadge(due: string) {
  const today = todayIso();
  if (due < today) return <Badge tone="gray">Was due {formatDate(due)}</Badge>;
  if (due === today) return <Badge tone="amber">Due today</Badge>;
  return <Badge tone="indigo">Due {formatDate(due)}</Badge>;
}

export default function HomeworkScreen() {
  const { sections, defaultId, error: secError, reload: reloadSections } = useSections();
  const subjects = useApi<{ data: Subject[] }>('/school/subjects');
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState(ALL);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<HomeworkRow | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    if (sectionId === null && sections) setSectionId(defaultId);
  }, [sections, defaultId, sectionId]);

  // The API filters by section only; a subject filter looks at the latest 100 items of the section.
  const path =
    sectionId === null ? null : subjectId ? `/homework${qs({ sectionId, page: 1, limit: 100 })}` : `/homework${qs({ sectionId, page, limit: PAGE_SIZE })}`;
  const list = useApi<{ data: HomeworkRow[]; meta: PageMeta }>(path);
  const rows = (list.data?.data ?? []).filter((h) => !subjectId || h.subject?.id === subjectId);
  const me = fullName();
  const admin = isAdminRole();

  return (
    <Page wide>
      <PageHeader
        title="Homework"
        description="Set homework for a class; parents see it in the parent app the same day."
        actions={
          <Button icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setCreating(true)} disabled={!sections?.length}>
            Set homework
          </Button>
        }
      />

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
          <option value={ALL}>All classes</option>
          {sections?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
              {s.mine ? ' (my class)' : ''}
            </option>
          ))}
        </Select>
        <Select aria-label="Subject" value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="!w-48" disabled={!subjects.data}>
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
          <Notice tone="success">{flash}</Notice>
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
              <Button size="sm" icon={<Plus className="h-3.5 w-3.5" aria-hidden />} onClick={() => setCreating(true)} disabled={!sections?.length}>
                Set homework
              </Button>
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
                  <Th>Due</Th>
                  <Th align="right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((h) => {
                  const own = admin || (!!h.teacher.name && h.teacher.name === me);
                  return (
                    <tr key={h.id}>
                      <Td className="max-w-xl">
                        <span className="flex flex-wrap items-center gap-2">
                          <Badge tone="indigo">{h.subject?.name ?? 'General'}</Badge>
                          <span className="font-medium">{h.title}</span>
                        </span>
                        {h.details && <span className="mt-1 line-clamp-2 block text-xs text-slate-500 dark:text-slate-400">{h.details}</span>}
                        <span className="mt-1 block text-xs text-slate-400 md:hidden">
                          {h.section.label}, {h.teacher.name ?? '–'}
                        </span>
                      </Td>
                      <Td className="hidden whitespace-nowrap md:table-cell">{h.section.label}</Td>
                      <Td className="hidden lg:table-cell">
                        <span className="block">{h.teacher.name ?? '–'}</span>
                        <span className="block text-xs text-slate-500 dark:text-slate-400">{formatDateTime(h.assignedAt)}</span>
                      </Td>
                      <Td className="whitespace-nowrap">{dueBadge(h.dueDate)}</Td>
                      <Td align="right">
                        {own && (
                          <Button variant="ghost" size="sm" icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />} onClick={() => setDeleting(h)} aria-label={`Delete homework: ${h.title}`}>
                            <span className="hidden sm:inline">Delete</span>
                          </Button>
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

      {creating && sections && (
        <CreateHomework
          sections={sections}
          subjects={subjects.data?.data ?? []}
          initialSectionId={sectionId || defaultId}
          initialSubjectId={subjectId}
          onClose={() => setCreating(false)}
          onCreated={(row) => {
            setCreating(false);
            setFlash(`Homework "${row.title}" set for ${row.section.label}.`);
            if (sectionId && sectionId !== row.section.id) setSectionId(row.section.id);
            setPage(1);
            list.reload();
          }}
        />
      )}
      {deleting && (
        <DeleteHomework
          item={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setFlash(`Deleted "${deleting.title}".`);
            setDeleting(null);
            list.reload();
          }}
        />
      )}
    </Page>
  );
}

function CreateHomework({
  sections,
  subjects,
  initialSectionId,
  initialSubjectId,
  onClose,
  onCreated,
}: {
  sections: SectionChoice[];
  subjects: Subject[];
  initialSectionId: string;
  initialSubjectId: string;
  onClose: () => void;
  onCreated: (row: HomeworkRow) => void;
}) {
  const tomorrow = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const [form, setForm] = useState({ sectionId: initialSectionId || sections[0]?.id || '', subjectId: initialSubjectId, title: '', details: '', dueDate: tomorrow });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: '' }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!form.sectionId) local.sectionId = 'Choose a class';
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
      onCreated(res.data);
    } catch (err) {
      const apiErr = err as ApiError;
      const body = (apiErr.details as Record<string, unknown> | undefined)?.body as Record<string, string[] | undefined> | undefined;
      if (body) setErrors(Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v?.[0] ?? 'Invalid'])));
      setError(apiErr.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title="Set homework"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="hw-form" loading={saving}>
            Set homework
          </Button>
        </>
      }
    >
      <form id="hw-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Class" value={form.sectionId} onChange={(e) => set('sectionId', e.target.value)} error={errors.sectionId} required>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
                {s.mine ? ' (my class)' : ''}
              </option>
            ))}
          </Select>
          <Select label="Subject" value={form.subjectId} onChange={(e) => set('subjectId', e.target.value)} error={errors.subjectId}>
            <option value="">General (no subject)</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <Input label="Title" value={form.title} onChange={(e) => set('title', e.target.value)} error={errors.title} maxLength={200} required placeholder="e.g. Exercise 4.2, questions 1 to 10" />
        <Textarea label="Details (optional)" value={form.details} onChange={(e) => set('details', e.target.value)} error={errors.details} maxLength={4000} rows={4} placeholder="Instructions for students and parents" />
        <Input label="Due date" type="date" value={form.dueDate} min={todayIso()} onChange={(e) => set('dueDate', e.target.value)} error={errors.dueDate} required className="sm:w-1/2" />
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
      setError((e as ApiError).message);
      setBusy(false);
    }
  }
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
        &ldquo;{item.title}&rdquo; for {item.section.label} will be removed from the parent app too.
      </p>
    </Modal>
  );
}
