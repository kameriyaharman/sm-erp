'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { RefreshCw, RotateCcw, SendHorizontal } from 'lucide-react';
import { Badge, Button, Card, ErrorState, Input, Notice, Page, Spinner, Tabs, Textarea, cx } from '@/components/ui';
import { useApi } from '@/lib/useApi';
import { apiSend } from '@/lib/session';
import { errorText, fieldErrors, useFlash } from '@/features/admin/shared';
import { ApprovalBadge, CHANNEL_LABEL, ChannelIcon, SettingsHeader, timeAgo } from './bits';
import type { Channel, EventKey, TemplateEvent, TemplatesData } from './types';

/**
 * Settings -> Message templates. Every automatic message, per channel: the default text and the
 * school's own. Own SMS / WhatsApp text needs the school's own account (Settings -> WhatsApp, SMS
 * & email); email text can always be changed.
 */
export default function TemplatesPage() {
  const { data, error, loading, reload } = useApi<{ data: TemplatesData }>('/settings/templates');
  const flash = useFlash(10000);
  const d = data?.data;
  const [selected, setSelected] = useState<EventKey>('absentee_alert');
  const [channel, setChannel] = useState<Channel>('whatsapp');
  const [syncing, setSyncing] = useState(false);
  const event = d?.events.find((e) => e.key === selected) ?? null;

  const groups = useMemo(() => {
    const out = new Map<string, TemplateEvent[]>();
    for (const e of d?.events ?? []) out.set(e.group, [...(out.get(e.group) ?? []), e]);
    return [...out];
  }, [d]);

  async function sync() {
    setSyncing(true);
    try {
      const r = await apiSend<{ data: { updated: number; templates: unknown[] } }>('POST', '/settings/templates/whatsapp/sync', {});
      flash.show('success', `Approval status updated for ${r.data.updated} template${r.data.updated === 1 ? '' : 's'} (${r.data.templates.length} on your WhatsApp account).`);
      reload();
    } catch (err) {
      flash.show('error', errorText(err));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Page wide>
      <SettingsHeader
        title="Message templates"
        description="What each message says. SMS text must match your DLT-registered template word for word; WhatsApp messages must use a template Meta has approved."
        actions={
          d?.ownProviders.whatsapp === 'meta_cloud' && d.canEdit ? (
            <Button variant="secondary" icon={<RefreshCw aria-hidden />} loading={syncing} onClick={sync}>
              Sync WhatsApp approvals
            </Button>
          ) : undefined
        }
      />
      {flash.node}
      {error ? (
        <Card>
          <ErrorState message={error} onRetry={reload} />
        </Card>
      ) : loading && !d ? (
        <Spinner label="Loading templates" />
      ) : d && event ? (
        <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start">
          <nav aria-label="Messages" className="rounded-xl border border-line bg-surface p-2 lg:sticky lg:top-20">
            {groups.map(([group, events]) => (
              <div key={group} className="mb-2 last:mb-0">
                <p className="px-2.5 pb-1 pt-2 text-xs font-medium text-slate-500 dark:text-slate-400">{group}</p>
                <ul>
                  {events.map((e) => {
                    const custom = (['whatsapp', 'sms', 'email'] as Channel[]).filter((c) => e.channels[c].custom);
                    return (
                      <li key={e.key}>
                        <button
                          type="button"
                          onClick={() => setSelected(e.key)}
                          aria-current={selected === e.key ? 'true' : undefined}
                          className={cx(
                            'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                            selected === e.key ? 'bg-indigo-50 font-medium text-indigo-800 dark:bg-indigo-400/10 dark:text-indigo-200' : 'text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-white/5',
                          )}
                        >
                          <span className="truncate">{e.label}</span>
                          {custom.length > 0 && <span className="shrink-0 rounded bg-indigo-100 px-1.5 text-[11px] font-medium text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-200">{custom.length}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>

          <div className="min-w-0">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{event.label}</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">{event.description}</p>
            </div>
            <Tabs
              value={channel}
              onChange={setChannel}
              items={(['whatsapp', 'sms', 'email'] as Channel[]).map((c) => ({
                value: c,
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <ChannelIcon channel={c} className="h-3.5 w-3.5" />
                    {CHANNEL_LABEL[c]}
                    {event.channels[c].custom && <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" aria-label="customised" />}
                  </span>
                ),
              }))}
            />
            <TemplateEditor
              key={`${event.key}-${channel}-${event.channels[channel].custom?.updatedAt ?? 'd'}`}
              event={event}
              channel={channel}
              data={d}
              onSaved={(msg) => {
                flash.show('success', msg);
                reload();
              }}
              onError={(msg) => flash.show('error', msg)}
            />
          </div>
        </div>
      ) : null}
    </Page>
  );
}

function TemplateEditor({ event, channel, data, onSaved, onError }: { event: TemplateEvent; channel: Channel; data: TemplatesData; onSaved: (m: string) => void; onError: (m: string) => void }) {
  const slot = event.channels[channel];
  const own = data.ownProviders[channel];
  const start = slot.custom ?? slot.default;
  const [body, setBody] = useState(start.body);
  const [subject, setSubject] = useState(start.subject ?? '');
  const [name, setName] = useState(slot.custom?.name ?? (channel === 'whatsapp' ? slot.default.name ?? '' : ''));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ text?: string; subject?: string; segments?: number; characters?: number; unicode?: boolean; problems?: string[] } | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const editable = data.canEdit && slot.applies;

  // Live preview with sample values.
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const r = await apiSend<{ data: typeof preview }>('POST', '/settings/templates/preview', { eventType: event.key, channel, body, subject: subject || null });
        setPreview(r.data);
      } catch {
        setPreview(null);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [body, subject, channel, event.key]);

  const params = useMemo(() => {
    const seen: string[] = [];
    for (const m of body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) if (!seen.includes(m[1])) seen.push(m[1]);
    return seen;
  }, [body]);

  function insert(variable: string) {
    const el = areaRef.current;
    const token = `{{${variable}}}`;
    if (!el) return setBody((b) => b + token);
    const { selectionStart: a, selectionEnd: b } = el;
    const next = body.slice(0, a) + token + body.slice(b);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + token.length, a + token.length);
    });
  }

  async function save() {
    setBusy(true);
    setErrors({});
    try {
      await apiSend('PUT', `/settings/templates/${event.key}/${channel}`, {
        body,
        ...(channel === 'email' && { subject }),
        ...(channel !== 'email' && { name: name.trim() || null }),
        ...(channel === 'whatsapp' && { params }),
      });
      onSaved(
        channel === 'whatsapp' && own === 'meta_cloud'
          ? `Saved as a draft. Submit it for approval: until Meta approves it, the default template keeps being used.`
          : `${event.label} (${CHANNEL_LABEL[channel]}) saved.`,
      );
    } catch (err) {
      setErrors(fieldErrors(err));
      onError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      await apiSend('DELETE', `/settings/templates/${event.key}/${channel}`);
      onSaved(`${event.label} (${CHANNEL_LABEL[channel]}) is back to the default text.`);
    } catch (err) {
      onError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    try {
      const r = await apiSend<{ data: { status: string } }>('POST', `/settings/templates/${event.key}/whatsapp/submit`, {});
      onSaved(`Submitted to Meta (${r.data.status}). Approval usually takes minutes to a day; use "Sync WhatsApp approvals" to check.`);
    } catch (err) {
      onError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const dirty = body !== start.body || (channel === 'email' && subject !== (start.subject ?? '')) || (channel !== 'email' && name !== (slot.custom?.name ?? (channel === 'whatsapp' ? slot.default.name ?? '' : '')));

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] xl:items-start">
      <Card
        title={slot.custom ? 'Your text' : 'Default text'}
        description={slot.custom ? `Saved ${timeAgo(slot.custom.updatedAt)}` : 'Used until you save your own.'}
        actions={slot.custom && channel === 'whatsapp' ? <ApprovalBadge status={slot.custom.approvalStatus} /> : undefined}
      >
        <div className="flex flex-col gap-4">
          {!slot.applies && (
            <Notice>
              {CHANNEL_LABEL[channel]} goes out from the SM ERP account, whose templates are fixed.{' '}
              <Link href="/settings/communication" className="font-medium underline">
                Connect your own account
              </Link>{' '}
              to use your own text.
            </Notice>
          )}
          {slot.custom?.approvalNote && <Notice tone="error">Meta: {slot.custom.approvalNote}</Notice>}

          {channel === 'whatsapp' && (
            <Input
              label={own === 'twilio' ? 'Content SID of the approved template' : 'Template name (as approved)'}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!editable}
              placeholder={own === 'twilio' ? 'HX...' : 'absentee_alert'}
              hint={own === 'meta_cloud' ? 'Lower-case letters, digits and _ . A new name is created on submit.' : 'Must match the template approved in your WhatsApp provider.'}
              error={errors.name}
              className="[&_input]:font-mono"
            />
          )}
          {channel === 'sms' && (
            <Input
              label={own === 'msg91' ? 'DLT template ID / MSG91 template ID' : 'DLT template ID (optional)'}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!editable}
              placeholder="1207161234567890123"
              error={errors.name}
              className="[&_input]:font-mono"
            />
          )}
          {channel === 'email' && <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!editable} error={errors.subject} />}

          <Textarea label="Message" value={body} onChange={(e) => setBody(e.target.value)} disabled={!editable} rows={channel === 'email' ? 8 : 5} error={errors.body} className="font-mono text-13" id={`body-${event.key}-${channel}`} />
          {/* Textarea doesn't forward refs; find it by id for cursor insertion. */}
          <RefBinder id={`body-${event.key}-${channel}`} target={areaRef} />

          {editable && (
            <div>
              <p className="mb-1.5 text-13 font-medium text-slate-700 dark:text-slate-300">Insert</p>
              <div className="flex flex-wrap gap-1.5">
                {event.variables.map((v) => (
                  <button key={v} type="button" onClick={() => insert(v)} className="rounded-md border border-line bg-surface-muted px-2 py-1 font-mono text-xs text-slate-700 hover:border-indigo-300 hover:text-indigo-700 dark:text-slate-300 dark:hover:text-indigo-300">
                    {`{{${v}}}`}
                    <span className="ml-1.5 font-sans text-slate-400">{data.variables[v]?.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {channel === 'whatsapp' && params.length > 0 && (
            <div className="rounded-lg bg-surface-muted/60 p-3 text-13">
              <p className="mb-1 font-medium text-slate-700 dark:text-slate-300">Parameters in the approved template</p>
              <ul className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
                {params.map((p, i) => (
                  <li key={p} className="font-mono text-slate-600 dark:text-slate-300">
                    {`{{${i + 1}}}`} = {p}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {editable && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={save} loading={busy} disabled={!dirty && Boolean(slot.custom)}>
                Save
              </Button>
              {channel === 'whatsapp' && own === 'meta_cloud' && slot.custom && ['draft', 'rejected'].includes(slot.custom.approvalStatus) && (
                <Button variant="secondary" icon={<SendHorizontal aria-hidden />} onClick={submit} loading={busy} disabled={dirty}>
                  Submit to Meta for approval
                </Button>
              )}
              {slot.custom && (
                <Button variant="ghost" icon={<RotateCcw aria-hidden />} onClick={reset} disabled={busy}>
                  Back to default
                </Button>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card title="Preview" description="With sample values.">
        {preview ? (
          <div className="flex flex-col gap-3">
            {channel === 'email' && preview.subject && (
              <p className="text-sm">
                <span className="text-slate-500">Subject: </span>
                <span className="font-medium">{preview.subject}</span>
              </p>
            )}
            <div
              className={cx(
                'whitespace-pre-wrap rounded-xl p-3.5 text-sm leading-6',
                channel === 'whatsapp' ? 'max-w-sm rounded-tl-sm bg-[#e7fbd8] text-slate-900 dark:bg-emerald-900/40 dark:text-emerald-50' : channel === 'sms' ? 'max-w-sm rounded-tl-sm bg-slate-100 dark:bg-white/[0.06]' : 'border border-line bg-surface',
              )}
            >
              {preview.text}
            </div>
            {channel === 'sms' && preview.characters !== undefined && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {preview.characters} characters · {preview.segments} SMS part{preview.segments === 1 ? '' : 's'}
                {preview.unicode && <Badge tone="amber">Unicode: 70 characters per part</Badge>}
              </p>
            )}
            {preview.problems && preview.problems.length > 0 && <Notice tone="error">{preview.problems.join('. ')}</Notice>}
          </div>
        ) : (
          <p className="text-sm text-slate-500">…</p>
        )}
      </Card>
    </div>
  );
}

/** Points a ref at an element rendered by a component that doesn't forward refs. */
function RefBinder({ id, target }: { id: string; target: MutableRefObject<HTMLTextAreaElement | null> }) {
  useEffect(() => {
    target.current = document.getElementById(id) as HTMLTextAreaElement | null;
  });
  return null;
}
