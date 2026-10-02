'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { Megaphone, Pin, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, Notice, Page, PageHeader, Select, Spinner, Textarea } from '@/components/ui';
import { useApi } from '@/lib/useApi';
import { apiSend } from '@/lib/session';
import { formatDateTime } from '@/lib/format';
import { ConfirmModal, errorText, fieldErrors, isAdminRole, useFlash, useRole } from './shared';
import type { Audience, ClassInfo, NoticeCreated, NoticeItem, Wrapped } from './types';

const AUDIENCE: Record<Audience, { label: string; tone: 'indigo' | 'green' | 'amber' }> = {
  all: { label: 'Everyone', tone: 'indigo' },
  parents: { label: 'Parents', tone: 'green' },
  teachers: { label: 'Teachers', tone: 'amber' },
};

export default function NoticesPage() {
  const role = useRole();
  const admin = isAdminRole(role);
  const params = useSearchParams();
  const { data, error, loading, reload } = useApi<Wrapped<NoticeItem[]>>('/notices?limit=100');
  const flash = useFlash();
  const [filter, setFilter] = useState<'' | Audience>('');
  const [composing, setComposing] = useState(false);
  const [deleting, setDeleting] = useState<NoticeItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (admin && params.get('new') === '1') setComposing(true);
  }, [admin, params]);

  const list = useMemo(() => {
    const rows = (data?.data ?? []).filter((n) => !filter || n.audience === filter);
    return [...rows].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt));
  }, [data, filter]);

  async function doDelete() {
    if (!deleting) return;
    setBusy(true);
    setDeleteError(null);
    try {
      await apiSend('DELETE', `/notices/${deleting.id}`);
      flash.show('success', `Deleted “${deleting.title}”.`);
      setDeleting(null);
      reload();
    } catch (err) {
      setDeleteError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <PageHeader
        title="Notices"
        description={admin ? 'Announcements for parents and staff' : 'Announcements from the school office'}
        actions={
          <>
            <div className="w-44">
            <Select aria-label="Filter by audience" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
              <option value="">All notices</option>
              <option value="all">For everyone</option>
              <option value="parents">For parents</option>
              <option value="teachers">For teachers</option>
            </Select>
            </div>
            {admin && (
              <Button icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setComposing(true)}>
                Post notice
              </Button>
            )}
          </>
        }
      />
      {flash.node}
      {loading && !data ? (
        <Spinner label="Loading notices…" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState icon={<Megaphone className="h-7 w-7" aria-hidden />} title="No notices yet" description={admin ? 'Post a notice and parents see it in their app.' : 'Notices from the office will appear here.'} action={admin && <Button onClick={() => setComposing(true)}>Post notice</Button>} />
        </Card>
      ) : (
        <ul className="space-y-3">
          {list.map((n) => (
            <li key={n.id}>
              <article className={`rounded-xl border bg-white p-4 shadow-sm dark:bg-slate-900 sm:p-5 ${n.pinned ? 'border-indigo-200 dark:border-indigo-500/40' : 'border-slate-200 dark:border-slate-800'}`}>
                <header className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      {n.pinned && (
                        <Badge tone="indigo">
                          <Pin className="h-3 w-3" aria-hidden /> Pinned
                        </Badge>
                      )}
                      <Badge tone={AUDIENCE[n.audience].tone}>{AUDIENCE[n.audience].label}</Badge>
                      {n.class && <Badge>{n.class.name}</Badge>}
                    </div>
                    <h2 className="text-base font-semibold">{n.title}</h2>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {formatDateTime(n.createdAt)}
                      {n.createdBy?.name ? ` · ${n.createdBy.name}` : ''}
                    </p>
                  </div>
                  {admin && (
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError(null);
                        setDeleting(n);
                      }}
                      aria-label={`Delete notice ${n.title}`}
                      className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                </header>
                <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-700 dark:text-slate-300">{n.body}</p>
              </article>
            </li>
          ))}
        </ul>
      )}

      {admin && (
        <ComposeModal
          open={composing}
          onClose={() => setComposing(false)}
          onPosted={(res) => {
            setComposing(false);
            flash.show('success', res.broadcast ? `Notice posted. SMS / WhatsApp queued for ${res.broadcast.recipients} recipient(s).` : 'Notice posted.');
            reload();
          }}
        />
      )}
      <ConfirmModal open={!!deleting} title="Delete notice?" confirmLabel="Delete" busy={busy} error={deleteError} onConfirm={doDelete} onClose={() => setDeleting(null)}>
        <p>
          “{deleting?.title}” will disappear from the parent and teacher apps. Messages already sent are not recalled.
        </p>
      </ConfirmModal>
    </Page>
  );
}

function ComposeModal({ open, onClose, onPosted }: { open: boolean; onClose: () => void; onPosted: (r: NoticeCreated) => void }) {
  const classes = useApi<Wrapped<ClassInfo[]>>(open ? '/school/classes' : null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<Audience>('all');
  const [classId, setClassId] = useState('');
  const [pinned, setPinned] = useState(false);
  const [sendSms, setSendSms] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setTitle('');
      setBody('');
      setAudience('all');
      setClassId('');
      setPinned(false);
      setSendSms(false);
      setErrors({});
      setError(null);
    }
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (title.trim().length < 3) local.title = 'At least 3 characters';
    if (body.trim().length < 3) local.body = 'Write the notice';
    setErrors(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<Wrapped<NoticeCreated>>('POST', '/notices', {
        title: title.trim(),
        body: body.trim(),
        audience,
        classId: audience !== 'teachers' && classId ? classId : undefined,
        pinned,
        sendSms,
      });
      onPosted(res.data);
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
      title="Post a notice"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="notice-form" loading={busy}>
            Post notice
          </Button>
        </>
      }
    >
      <form id="notice-form" onSubmit={submit} noValidate className="space-y-4">
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} error={errors.title} placeholder="e.g. School closed on Friday" required />
        <Textarea label="Message" value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} rows={6} error={errors.body} hint={`${body.length}/4000`} required />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Audience" value={audience} onChange={(e) => setAudience(e.target.value as Audience)} error={errors.audience}>
            <option value="all">Everyone (parents and teachers)</option>
            <option value="parents">Parents only</option>
            <option value="teachers">Teachers only</option>
          </Select>
          <Select label="Class" value={classId} onChange={(e) => setClassId(e.target.value)} disabled={audience === 'teachers'} error={errors.classId} hint={audience === 'teachers' ? 'Teacher notices go to all teachers.' : 'Optional: only parents of this class see it.'}>
            <option value="">Whole school</option>
            {classes.data?.data.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
          Pin to the top
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={sendSms} onChange={(e) => setSendSms(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300" />
          <span>
            Also send as SMS / WhatsApp
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              Goes to every {audience === 'teachers' ? 'teacher' : 'parent'} of the school. No SMS provider is configured in this demo, so messages are logged as failed in the SMS / WhatsApp log.
            </span>
          </span>
        </label>
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </Modal>
  );
}
