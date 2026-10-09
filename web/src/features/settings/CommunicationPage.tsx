'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import { CircleCheck, CirclePower, Eye, EyeOff, PlugZap, Send, ShieldCheck, Unplug } from 'lucide-react';
import { Badge, Button, Card, ErrorState, Field, Input, Modal, Notice, Page, Select, Spinner, controlClass, cx } from '@/components/ui';
import { useApi } from '@/lib/useApi';
import { apiSend, currentUser } from '@/lib/session';
import { ConfirmModal, errorCode, errorText, fieldErrors, useFlash } from '@/features/admin/shared';
import { BranchPicker, CHANNEL_LABEL, ChannelIcon, SettingsHeader, Switch, timeAgo } from './bits';
import type { Channel, ChannelInfo, ChannelSettings, CommunicationData, MessagingValue, ProviderInfo, SectionData } from './types';

/**
 * Settings -> WhatsApp, SMS & email. For each channel: the SM ERP shared account (counted against
 * the plan) or the school's own (Meta WhatsApp Cloud API, WATI, Twilio, MSG91, SMTP). Owner: whole
 * school and per branch; branch admin: their branch.
 */

type FieldDef = { key: string; label: string; placeholder?: string; hint?: string; type?: 'text' | 'number' | 'select'; options?: Array<{ value: string; label: string }>; optional?: boolean; mono?: boolean };

const FIELDS: Record<string, FieldDef[]> = {
  'whatsapp:meta_cloud': [
    { key: 'phoneNumberId', label: 'Phone number ID', placeholder: '1093847562901234', hint: 'Meta app -> WhatsApp -> API setup, or WhatsApp Manager -> Phone numbers.', mono: true },
    { key: 'wabaId', label: 'WhatsApp Business Account ID', placeholder: '2093847562901234', hint: 'Needed to submit templates and read their approval status.', mono: true },
    { key: 'displayNumber', label: 'Number shown to parents', placeholder: '+919876543210', optional: true },
  ],
  'whatsapp:wati': [
    { key: 'apiEndpoint', label: 'API endpoint', placeholder: 'https://live-mt-server.wati.io/123456', hint: 'WATI -> API Docs. It includes your account number.', mono: true },
    { key: 'channelNumber', label: 'WhatsApp number', placeholder: '+919876543210' },
  ],
  'whatsapp:twilio': [
    { key: 'accountSid', label: 'Account SID', placeholder: 'AC...', mono: true },
    { key: 'whatsappFrom', label: 'WhatsApp sender number', placeholder: '+919876543210' },
  ],
  'sms:msg91': [
    { key: 'senderId', label: 'DLT sender ID', placeholder: 'DPSDWK', hint: '6 capital letters, approved on the DLT portal.', mono: true },
    {
      key: 'idField',
      label: 'Template ID type',
      type: 'select',
      options: [
        { value: 'template_id', label: 'MSG91 template ID (newer accounts)' },
        { value: 'flow_id', label: 'MSG91 flow ID (older accounts)' },
      ],
    },
  ],
  'sms:twilio': [
    { key: 'accountSid', label: 'Account SID', placeholder: 'AC...', mono: true },
    { key: 'smsFrom', label: 'Sender number', placeholder: '+15005550006', optional: true },
    { key: 'messagingServiceSid', label: 'or Messaging Service SID', placeholder: 'MG...', optional: true, mono: true },
  ],
  'email:smtp': [
    { key: 'host', label: 'SMTP server', placeholder: 'smtp.gmail.com', mono: true },
    { key: 'port', label: 'Port', placeholder: '587', type: 'number', hint: '587 (STARTTLS) or 465 (SSL).' },
    { key: 'user', label: 'Username', placeholder: 'office@yourschool.in' },
    { key: 'fromEmail', label: 'Send from address', placeholder: 'office@yourschool.in' },
    { key: 'fromName', label: 'Sender name', placeholder: 'Delhi Public School, Dwarka', optional: true },
  ],
};

const CHANNELS: Channel[] = ['whatsapp', 'sms', 'email'];
const PROVIDER_SHORT: Record<string, string> = { platform: 'SM ERP account', meta_cloud: 'WhatsApp Cloud API', wati: 'WATI', twilio: 'Twilio', msg91: 'MSG91', smtp: 'Own mailbox (SMTP)' };

export default function CommunicationPage() {
  const { data, error, loading, reload, setData } = useApi<{ data: CommunicationData }>('/settings/communication');
  const flash = useFlash(12000);
  const d = data?.data;
  const me = currentUser();
  const [target, setTarget] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (d && target === undefined) setTarget(d.canEditSchool ? null : me?.branchId ?? null);
  }, [d, target, me?.branchId]);

  const branches = d ? d.channels.whatsapp.branches.map((b) => ({ id: b.id, name: b.name, code: '', isHeadOffice: false })) : [];

  return (
    <Page>
      <SettingsHeader
        title="WhatsApp, SMS & email"
        description="Messages go out from the SM ERP account unless you connect your own. With your own account, parents see your school's WhatsApp number and sender ID, and you pay your provider directly."
      />
      {flash.node}
      {error ? (
        <Card>
          <ErrorState message={error} onRetry={reload} />
        </Card>
      ) : loading && !d ? (
        <Spinner label="Loading" />
      ) : d && target !== undefined ? (
        <>
          {!d.encryptionReady && (
            <div className="mb-5">
              <Notice tone="error">
                The server is missing its encryption key (<code>SETTINGS_ENCRYPTION_KEY</code>), so passwords and tokens can&apos;t be saved yet. Ask your SM ERP administrator to set it.
              </Notice>
            </div>
          )}
          <BranchPicker branches={branches} value={target} onChange={setTarget} allowSchool={d.canEditSchool} />
          <div className="flex flex-col gap-5">
            {CHANNELS.map((c) => (
              <ChannelCard
                key={`${c}-${target ?? 'school'}`}
                channel={c}
                info={d.channels[c]}
                target={target}
                canEdit={target !== null || d.canEditSchool}
                encryptionReady={d.encryptionReady}
                onSaved={(next, message, tone = 'success') => {
                  setData({ data: next });
                  flash.show(tone, message);
                }}
                onFlash={flash.show}
                reload={reload}
              />
            ))}
            {d.canEditSchool && <MessagingCard onFlash={flash.show} />}
          </div>
        </>
      ) : null}
    </Page>
  );
}

// ------------------------------------------------------------------ one channel

function ChannelCard({
  channel,
  info,
  target,
  canEdit,
  encryptionReady,
  onSaved,
  onFlash,
  reload,
}: {
  channel: Channel;
  info: ChannelInfo;
  target: string | null;
  canEdit: boolean;
  encryptionReady: boolean;
  onSaved: (next: CommunicationData, message: string, tone?: 'success' | 'warn') => void;
  onFlash: (tone: 'success' | 'error' | 'info' | 'warn', text: string) => void;
  reload: () => void;
}) {
  const branch = target ? info.branches.find((b) => b.id === target) ?? null : null;
  const own = target ? branch?.settings ?? null : info.school;
  const effective = target ? branch?.effective ?? { source: 'platform' as const, provider: 'platform', enabled: true } : own ? { source: 'school' as const, provider: own.provider, enabled: own.enabled } : { source: 'platform' as const, provider: 'platform', enabled: true };
  const [editing, setEditing] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<{ ok: boolean | null; message: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [removing, setRemoving] = useState(false);

  const branchQs = target ? `?branchId=${target}` : '';

  async function verify() {
    setChecking(true);
    setCheck(null);
    try {
      const r = await apiSend<{ data: { ok: boolean | null; message: string } }>('POST', `/settings/communication/${channel}/verify`, { branchId: target });
      setCheck(r.data);
      reload();
    } catch (err) {
      setCheck({ ok: false, message: errorText(err) });
    } finally {
      setChecking(false);
    }
  }

  async function remove() {
    setRemoving(true);
    try {
      const r = await apiSend<{ data: CommunicationData }>('DELETE', `/settings/communication/${channel}${branchQs}`);
      setConfirm(false);
      onSaved(r.data, target ? `${CHANNEL_LABEL[channel]} for this branch now follows the whole-school setting.` : `${CHANNEL_LABEL[channel]} now goes out from the SM ERP account.`);
    } catch (err) {
      onFlash('error', errorText(err));
    } finally {
      setRemoving(false);
    }
  }

  const usageLimit = info.usage.platformLimit;
  const on = effective.enabled && info.module;

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <ChannelIcon channel={channel} className="h-[18px] w-[18px] text-slate-500" />
          {CHANNEL_LABEL[channel]}
        </span>
      }
      description={
        info.module
          ? `${(info.usage.school + info.usage.platform).toLocaleString('en-IN')} sent this month${usageLimit !== null ? ` · SM ERP account: ${info.usage.platform.toLocaleString('en-IN')} of ${usageLimit.toLocaleString('en-IN')}` : ''}`
          : info.inPlan
            ? 'Switched off under Settings -> Modules'
            : 'Not included in your plan'
      }
      actions={
        info.module ? (
          on ? (
            <Badge tone="green" dot>
              On
            </Badge>
          ) : (
            <Badge dot>Off</Badge>
          )
        ) : undefined
      }
    >
      {!info.module ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {info.inPlan ? 'Switch the module on to send messages on this channel.' : `${CHANNEL_LABEL[channel]} messages are not part of your plan. Contact SM ERP to add them.`}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <span className={cx('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', on ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-white/[0.06]')}>
              {on ? <CircleCheck className="h-4 w-4" aria-hidden /> : <CirclePower className="h-4 w-4" aria-hidden />}
            </span>
            <div className="min-w-0 text-sm">
              <p className="font-medium text-slate-900 dark:text-white">
                {effective.provider === 'platform' ? 'SM ERP shared account' : `Own account: ${PROVIDER_SHORT[effective.provider] ?? effective.provider}`}
                {target && effective.source === 'school' && <span className="ml-2 font-normal text-slate-500">(follows whole school)</span>}
              </p>
              <p className="mt-0.5 text-slate-500 dark:text-slate-400">
                {effective.provider === 'platform'
                  ? info.platformAvailable
                    ? 'Messages use SM ERP-approved templates and sender.'
                    : 'SM ERP has not set up a shared account for this channel on this server: connect your own to send.'
                  : own
                    ? own.verifiedAt
                      ? `Connection checked ${timeAgo(own.verifiedAt)}.`
                      : own.verifyError
                        ? own.verifyError
                        : 'Not checked yet: send a test message.'
                    : null}
                {own?.lastUsedAt && ` Last message ${timeAgo(own.lastUsedAt)}.`}
              </p>
            </div>
          </div>

          {own && own.provider !== 'platform' && !editing && <SavedSummary channel={channel} settings={own} />}
          {check && <Notice tone={check.ok === true ? 'success' : check.ok === false ? 'error' : 'info'}>{check.message}</Notice>}

          {editing ? (
            <ChannelForm
              channel={channel}
              providers={info.providers}
              platformAvailable={info.platformAvailable}
              settings={own}
              target={target}
              disabled={!encryptionReady}
              onCancel={() => setEditing(false)}
              onSaved={(next) => {
                setEditing(false);
                setCheck(null);
                onSaved(next, next.warning ?? `${CHANNEL_LABEL[channel]} saved.`, next.warning ? 'warn' : 'success');
              }}
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              {canEdit && (
                <Button variant="secondary" icon={<PlugZap aria-hidden />} onClick={() => setEditing(true)}>
                  {own ? 'Change account' : target ? 'Use a different account for this branch' : 'Connect own account'}
                </Button>
              )}
              {own && own.provider !== 'platform' && (
                <Button variant="secondary" icon={<ShieldCheck aria-hidden />} loading={checking} onClick={verify}>
                  Test connection
                </Button>
              )}
              <Button variant="secondary" icon={<Send aria-hidden />} onClick={() => setTestOpen(true)} disabled={!on}>
                Send test message
              </Button>
              {own && canEdit && (
                <Button variant="ghost" className="text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/10" icon={<Unplug aria-hidden />} onClick={() => setConfirm(true)}>
                  {target ? 'Remove branch account' : 'Back to SM ERP account'}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      <TestModal open={testOpen} channel={channel} target={target} onClose={() => setTestOpen(false)} />
      <ConfirmModal
        open={confirm}
        title={target ? 'Remove this branch’s own account?' : `Stop using your own ${CHANNEL_LABEL[channel]} account?`}
        confirmLabel="Remove"
        busy={removing}
        onConfirm={remove}
        onClose={() => setConfirm(false)}
      >
        <p>
          The saved credentials are deleted. {target ? 'This branch then uses the whole-school setting.' : `${CHANNEL_LABEL[channel]} messages go out from the SM ERP account (counted against your plan).`}
        </p>
      </ConfirmModal>
    </Card>
  );
}

function SavedSummary({ channel, settings }: { channel: Channel; settings: ChannelSettings }) {
  const fields = FIELDS[`${channel}:${settings.provider}`] ?? [];
  return (
    <dl className="grid gap-x-6 gap-y-2 rounded-lg border border-line bg-surface-muted/50 p-3.5 text-sm sm:grid-cols-2">
      {fields
        .filter((f) => settings.config[f.key] !== undefined && settings.config[f.key] !== null && settings.config[f.key] !== '')
        .map((f) => (
          <div key={f.key} className="min-w-0">
            <dt className="text-13 text-slate-500 dark:text-slate-400">{f.label}</dt>
            <dd className={cx('truncate', f.mono && 'font-mono text-13')}>{String(settings.config[f.key])}</dd>
          </div>
        ))}
      {Object.entries(settings.secrets).map(([k, s]) => (
        <div key={k}>
          <dt className="text-13 text-slate-500 dark:text-slate-400">{k === 'password' ? 'Password' : k === 'authKey' ? 'Auth key' : k === 'authToken' ? 'Auth token' : 'Access token'}</dt>
          <dd className="font-mono text-13">•••• {s.last4}</dd>
        </div>
      ))}
      <div>
        <dt className="text-13 text-slate-500 dark:text-slate-400">Saved</dt>
        <dd>
          {timeAgo(settings.updatedAt)}
          {settings.updatedBy ? ` by ${settings.updatedBy.name}` : ''}
        </dd>
      </div>
    </dl>
  );
}

// ------------------------------------------------------------------ form

function SecretField({ label, value, onChange, saved, error }: { label: string; value: string; onChange: (v: string) => void; saved: string | null; error?: string }) {
  const id = useId();
  const [show, setShow] = useState(false);
  return (
    <Field label={label} htmlFor={id} error={error} hint={saved ? 'Saved. Leave empty to keep it, or paste a new one.' : undefined}>
      <div className="relative">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={saved ? `•••• ${saved} (saved)` : ''}
          aria-invalid={error ? true : undefined}
          className={cx(controlClass, 'h-10 pr-10 font-mono sm:h-9', error && 'border-red-500')}
        />
        <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? `Hide ${label}` : `Show ${label}`} className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
          {show ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
        </button>
      </div>
    </Field>
  );
}

function ChannelForm({
  channel,
  providers,
  platformAvailable,
  settings,
  target,
  disabled,
  onCancel,
  onSaved,
}: {
  channel: Channel;
  providers: ProviderInfo[];
  platformAvailable: boolean;
  settings: ChannelSettings | null;
  target: string | null;
  disabled: boolean;
  onCancel: () => void;
  onSaved: (next: CommunicationData) => void;
}) {
  const choices = providers.filter((p) => p.key !== 'platform' || platformAvailable);
  const [provider, setProvider] = useState(settings?.provider ?? choices.find((p) => p.key !== 'platform')?.key ?? 'platform');
  const [config, setConfig] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(settings?.config ?? {}).map(([k, v]) => [k, v === null || v === undefined ? '' : String(v)])));
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState(settings?.enabled ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const def = providers.find((p) => p.key === provider);
  const fields = FIELDS[`${channel}:${provider}`] ?? [];
  const sameProvider = settings?.provider === provider;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    const cfg: Record<string, unknown> = {};
    for (const f of fields) {
      const v = (config[f.key] ?? '').trim();
      if (v === '') continue;
      cfg[f.key] = f.type === 'number' ? Number(v) : v;
    }
    try {
      const res = await apiSend<{ data: CommunicationData }>('PUT', `/settings/communication/${channel}`, {
        branchId: target,
        provider,
        config: cfg,
        secrets: Object.fromEntries(Object.entries(secrets).filter(([, v]) => v.trim() !== '')),
        enabled,
      });
      onSaved(res.data);
    } catch (err) {
      setErrors(fieldErrors(err));
      setFormError(errorCode(err) === 'INVALID_CREDENTIALS' ? `The provider did not accept these credentials: ${errorText(err)}` : errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4 rounded-lg border border-line p-4">
      <fieldset>
        <legend className="mb-2 text-13 font-medium text-slate-700 dark:text-slate-300">Send {CHANNEL_LABEL[channel]} from</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {choices.map((p) => (
            <label
              key={p.key}
              className={cx(
                'flex cursor-pointer gap-3 rounded-lg border p-3 text-sm transition-colors',
                provider === p.key ? 'border-indigo-400 bg-indigo-50/60 dark:border-indigo-400/60 dark:bg-indigo-400/10' : 'border-line hover:border-slate-300 dark:hover:border-white/20',
              )}
            >
              <input type="radio" name={`${channel}-provider`} value={p.key} checked={provider === p.key} onChange={() => setProvider(p.key)} className="mt-0.5 accent-indigo-600" />
              <span className="min-w-0">
                <span className="block font-medium text-slate-900 dark:text-white">{p.label}</span>
                <span className="mt-0.5 block text-13 text-slate-500 dark:text-slate-400">{p.help}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {fields.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((f) =>
            f.type === 'select' ? (
              <Select key={f.key} label={f.label} value={config[f.key] ?? f.options?.[0]?.value ?? ''} onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))} error={errors[f.key]}>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                key={f.key}
                label={f.optional ? `${f.label} (optional)` : f.label}
                value={config[f.key] ?? ''}
                placeholder={f.placeholder}
                inputMode={f.type === 'number' ? 'numeric' : undefined}
                onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}
                error={errors[f.key]}
                hint={f.hint}
                className={f.mono ? '[&_input]:font-mono' : undefined}
                autoComplete="off"
                spellCheck={false}
              />
            ),
          )}
          {def?.secrets.map((s) => (
            <SecretField
              key={s.key}
              label={s.label}
              value={secrets[s.key] ?? ''}
              onChange={(v) => setSecrets((x) => ({ ...x, [s.key]: v }))}
              saved={sameProvider ? settings?.secrets[s.key]?.last4 ?? null : null}
              error={errors[s.key]}
            />
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-4 rounded-lg bg-surface-muted/60 px-3.5 py-2.5">
        <div className="text-sm">
          <p className="font-medium text-slate-900 dark:text-white">Send {CHANNEL_LABEL[channel]} messages</p>
          <p className="text-13 text-slate-500 dark:text-slate-400">Off: this channel is skipped and the next one in each rule is used.</p>
        </div>
        <Switch checked={enabled} onChange={setEnabled} label={`Send ${CHANNEL_LABEL[channel]} messages`} />
      </div>

      {formError && <Notice tone="error">{formError}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy} disabled={disabled}>
          {provider === 'platform' ? 'Use SM ERP account' : 'Check and save'}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ test message

function TestModal({ open, channel, target, onClose }: { open: boolean; channel: Channel; target: string | null; onClose: () => void }) {
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  useEffect(() => {
    if (open) setResult(null);
  }, [open]);

  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const r = await apiSend<{ data: { ok: boolean; message: string } }>('POST', `/settings/communication/${channel}/test`, { branchId: target, to: to.trim() });
      setResult(r.data);
    } catch (err) {
      setResult({ ok: false, message: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Send a test ${CHANNEL_LABEL[channel]}`}
      description={channel === 'email' ? 'A short test email.' : 'Uses the notice template, so it also checks that the template is approved.'}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button type="submit" form={`test-${channel}`} loading={busy} disabled={to.trim().length < 5}>
            Send
          </Button>
        </>
      }
    >
      <form id={`test-${channel}`} onSubmit={send} className="flex flex-col gap-3">
        <Input
          label={channel === 'email' ? 'Email address' : 'Mobile number'}
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder={channel === 'email' ? 'you@school.in' : '98110 42231'}
          inputMode={channel === 'email' ? 'email' : 'tel'}
          autoFocus
        />
        {result && <Notice tone={result.ok ? 'success' : 'error'}>{result.message}</Notice>}
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ messaging preferences

function MessagingCard({ onFlash }: { onFlash: (tone: 'success' | 'error' | 'info' | 'warn', text: string) => void }) {
  const { data, setData } = useApi<{ data: SectionData<MessagingValue> }>('/settings/sections/messaging');
  const s = data?.data;
  const [displayName, setDisplayName] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [language, setLanguage] = useState<'en' | 'hi'>('en');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!s) return;
    setDisplayName(s.value.displayName ?? '');
    setReplyTo(s.value.replyToEmail ?? '');
    setLanguage(s.value.language);
  }, [s]);
  if (!s) return null;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const r = await apiSend<{ data: SectionData<MessagingValue> }>('PUT', '/settings/sections/messaging', {
        value: { displayName: displayName.trim() || null, replyToEmail: replyTo.trim() || null, language },
        version: s!.version,
      });
      setData(r);
      onFlash('success', 'Messaging preferences saved.');
    } catch (err) {
      setErrors(fieldErrors(err));
      onFlash('error', errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Messaging preferences" description="Apply to every channel.">
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-3" noValidate>
        <Input label="School name in messages" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="DPS Dwarka" maxLength={60} hint="Short names keep SMS to one part. Empty: school and branch name." error={errors.displayName} />
        <Input label="Reply-to email" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="office@yourschool.in" type="email" hint="Where parents' replies to emails go." error={errors.replyToEmail} />
        <Select label="Language of new templates" value={language} onChange={(e) => setLanguage(e.target.value as 'en' | 'hi')} hint="WhatsApp templates are approved per language.">
          <option value="en">English</option>
          <option value="hi">Hindi</option>
        </Select>
        <div className="sm:col-span-3">
          <Button type="submit" loading={busy}>
            Save
          </Button>
        </div>
      </form>
    </Card>
  );
}
