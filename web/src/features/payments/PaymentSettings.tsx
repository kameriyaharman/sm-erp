'use client';

import Link from 'next/link';
import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, CircleCheck, CirclePower, ExternalLink, Eye, EyeOff, Link2, PlugZap, ShieldCheck, Unplug, Webhook } from 'lucide-react';
import { Badge, Button, Card, ErrorState, Field, Input, Notice, Page, PageHeader, Spinner, Tabs, controlClass, cx } from '@/components/ui';
import { useApi } from '@/lib/useApi';
import { apiSend } from '@/lib/session';
import { formatDateTime } from '@/lib/format';
import { ConfirmModal, errorCode, errorText, fieldErrors, useFlash } from '@/features/admin/shared';
import { CopyField, ModeBadge, ago } from './bits';
import type { GatewaySettings, PaymentSettingsData, TestResult } from './types';

const KEY_RE = /^rzp_(test|live)_[A-Za-z0-9]{6,40}$/;
const modeOf = (keyId: string) => (keyId.startsWith('rzp_live_') ? 'live' : keyId.startsWith('rzp_test_') ? 'test' : null);

/**
 * Settings -> Online payments. The school connects its OWN Razorpay account: money goes to the
 * school's bank account, SM ERP only starts payments and records them when Razorpay confirms.
 * Owner: school-wide account (+ per-branch accounts for schools whose branches bank separately).
 * Branch admin: an account for their own branch only.
 */
export default function PaymentSettings() {
  const { data, error, loading, reload, setData } = useApi<{ data: PaymentSettingsData }>('/settings/payments');
  const flash = useFlash(12000);
  const s = data?.data;
  const [target, setTarget] = useState<string | null>(null);

  // Owner starts on the school-wide account, a branch admin on their branch.
  useEffect(() => {
    if (s && target === null) setTarget(s.canEditSchool ? 'school' : s.branches[0]?.id ?? 'school');
  }, [s, target]);

  if (error) {
    return (
      <Page>
        <Header />
        <Card>
          <ErrorState message={error} onRetry={reload} />
        </Card>
      </Page>
    );
  }
  if (loading && !s) {
    return (
      <Page>
        <Header />
        <Spinner label="Loading payment settings" />
      </Page>
    );
  }
  if (!s || target === null) return null;

  const branch = target === 'school' ? null : s.branches.find((b) => b.id === target) ?? null;
  const settings = target === 'school' ? s.school : branch?.settings ?? null;
  const replace = (next: PaymentSettingsData) => setData({ data: next });

  return (
    <Page>
      <Header />
      {flash.node}
      {!s.encryptionReady && (
        <div className="mb-5">
          <Notice tone="error">
            The server is missing its encryption key (<code>SETTINGS_ENCRYPTION_KEY</code>), so Razorpay keys can&apos;t be saved yet. Ask your SM ERP administrator to set it.
          </Notice>
        </div>
      )}

      {s.canEditSchool && s.branches.length > 1 && (
        <Tabs
          value={target}
          onChange={setTarget}
          items={[
            { value: 'school', label: 'Whole school' },
            ...s.branches.map((b) => ({ value: b.id, label: b.settings ? `${b.name} (own account)` : b.name })),
          ]}
        />
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-5">
          <StatusCard s={s} target={target} settings={settings} branchName={branch?.name ?? null} />

          {branch && !branch.settings && (s.school || !s.canEditSchool) ? (
            <UsesSchoolAccount s={s} branchName={branch.name}>
              <KeysForm
                key={`new-${target}`}
                settings={null}
                target={target}
                collapsedLabel={`Use a separate Razorpay account for ${branch.name}`}
                testKeysAllowed={s.testKeysAllowed}
                disabled={!s.encryptionReady}
                onSaved={(next, warning) => {
                  replace(next);
                  flash.show(warning ? 'warn' : 'success', warning ?? 'Saved. Razorpay accepted the keys.');
                }}
              />
            </UsesSchoolAccount>
          ) : (
            <>
              <KeysForm
                key={`${target}-${settings?.id ?? 'new'}-${settings?.updatedAt ?? ''}`}
                settings={settings}
                target={target}
                testKeysAllowed={s.testKeysAllowed}
                disabled={!s.encryptionReady || (target === 'school' && !s.canEditSchool)}
                onSaved={(next, warning) => {
                  replace(next);
                  flash.show(warning ? 'warn' : 'success', warning ?? (settings ? 'Saved.' : 'Saved. Razorpay accepted the keys. Add the webhook (step 4), then switch online payment on.'));
                }}
              />
              {settings && (
                <ConnectionCard
                  settings={settings}
                  target={target}
                  onChanged={reload}
                  onFlash={flash.show}
                  replace={replace}
                  canEdit={target !== 'school' || s.canEditSchool}
                />
              )}
            </>
          )}

          <WebhookCard url={s.webhook.url} events={s.webhook.events} lastWebhookAt={settings?.lastWebhookAt ?? null} />
        </div>

        <aside className="lg:sticky lg:top-6">
          <HowTo webhookUrl={s.webhook.url} />
        </aside>
      </div>
    </Page>
  );
}

function Header() {
  return (
    <PageHeader
      title="Online payments"
      breadcrumb={
        <Link href="/settings" className="inline-flex items-center gap-1 hover:text-slate-800 dark:hover:text-slate-200">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Settings
        </Link>
      }
      description="Connect your school's own Razorpay account. Parents and students pay fees from their portal; the money goes straight to your bank account and the receipt is created automatically."
    />
  );
}

// ------------------------------------------------------------------ status

function StatusCard({ s, target, settings, branchName }: { s: PaymentSettingsData; target: string; settings: GatewaySettings | null; branchName: string | null }) {
  const effective = target === 'school' ? null : s.branches.find((b) => b.id === target)?.effective;
  const applies = settings ?? (effective?.source === 'school' ? s.school : null);
  const on = applies ? applies.enabled : effective?.source === 'platform';
  const mode = applies?.mode ?? effective?.mode ?? null;

  let title: string;
  let text: ReactNode;
  if (!applies && effective?.source !== 'platform') {
    title = 'Not connected';
    text = 'Parents see "pay at the school office" until you connect a Razorpay account and switch online payment on.';
  } else if (!on) {
    title = 'Connected, switched off';
    text = applies?.verifiedAt ? 'Keys work. Switch online payment on below when the webhook is added.' : 'Test the connection, then switch online payment on.';
  } else {
    title = mode === 'test' ? 'On, in test mode' : 'On: parents can pay online';
    text =
      mode === 'test'
        ? 'Payments use Razorpay test cards and UPI: no real money moves. Switch to Live keys when you are ready.'
        : `Parents and students${branchName ? ` of ${branchName}` : ''} see "Pay now" on every open bill.`;
  }
  return (
    <section className={cx('flex items-start gap-4 rounded-xl border p-4 sm:p-5', on ? (mode === 'test' ? 'border-amber-200 bg-amber-50/60 dark:border-amber-400/25 dark:bg-amber-400/[0.06]' : 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-400/25 dark:bg-emerald-400/[0.06]') : 'border-line bg-surface')}>
      <span
        className={cx(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
          on ? (mode === 'test' ? 'bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300') : 'bg-slate-100 text-slate-500 dark:bg-white/[0.06] dark:text-slate-400',
        )}
      >
        {on ? <CircleCheck className="h-5 w-5" aria-hidden /> : <CirclePower className="h-5 w-5" aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h2>
          <ModeBadge mode={on || applies ? mode : null} />
          {!settings && effective?.source === 'school' && <Badge tone="gray">School-wide account</Badge>}
          {effective?.source === 'platform' && !settings && <Badge tone="gray">SM ERP platform account</Badge>}
        </div>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{text}</p>
      </div>
    </section>
  );
}

function UsesSchoolAccount({ s, branchName, children }: { s: PaymentSettingsData; branchName: string; children: ReactNode }) {
  return (
    <Card title={`${branchName} uses the school-wide account`} description="Most schools need only one Razorpay account.">
      {s.school ? (
        <dl className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-13 text-slate-500 dark:text-slate-400">Key ID</dt>
            <dd className="mt-0.5 break-all font-mono text-13">{s.school.keyId}</dd>
          </div>
          <div>
            <dt className="text-13 text-slate-500 dark:text-slate-400">Mode</dt>
            <dd className="mt-0.5">
              <ModeBadge mode={s.school.mode} />
            </dd>
          </div>
          <div>
            <dt className="text-13 text-slate-500 dark:text-slate-400">Online payment</dt>
            <dd className="mt-0.5">{s.school.enabled ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>}</dd>
          </div>
        </dl>
      ) : (
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">The school owner hasn&apos;t connected a school-wide account yet.</p>
      )}
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">Add a separate account only if this branch collects fees into a different bank account.</p>
      {children}
    </Card>
  );
}

// ------------------------------------------------------------------ keys form

function SecretInput({
  label,
  value,
  onChange,
  saved,
  error,
  hint,
  id,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  saved: string | null;
  error?: string;
  hint: ReactNode;
  id: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <Field label={label} htmlFor={id} error={error} hint={saved ? 'Saved. Leave empty to keep it, or paste a new one.' : hint}>
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
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? `Hide ${label}` : `Show ${label}`}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        >
          {show ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
        </button>
      </div>
    </Field>
  );
}

function KeysForm({
  settings,
  target,
  testKeysAllowed,
  disabled,
  onSaved,
  collapsedLabel,
}: {
  settings: GatewaySettings | null;
  target: string;
  testKeysAllowed: boolean;
  disabled: boolean;
  onSaved: (next: PaymentSettingsData, warning: string | null) => void;
  /** Start as a button that opens the form (branch overrides). */
  collapsedLabel?: string;
}) {
  const ids = { keyId: useId(), keySecret: useId(), webhookSecret: useId(), min: useId() };
  const [open, setOpen] = useState(!collapsedLabel);
  const [keyId, setKeyId] = useState(settings?.keyId ?? '');
  const [keySecret, setKeySecret] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [allowPartial, setAllowPartial] = useState(settings?.allowPartial ?? false);
  const [minAmount, setMinAmount] = useState(settings ? String(Number(settings.minAmount)) : '500');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const clear = (field: string) => setErrors((e) => (e[field] ? { ...e, [field]: '' } : e));
  const mode = modeOf(keyId.trim());
  const keyChanged = !settings || keyId.trim() !== settings.keyId;
  const modeChanged = Boolean(settings) && mode !== null && mode !== settings!.mode;
  const dirty =
    keyChanged || keySecret !== '' || webhookSecret !== '' || allowPartial !== (settings?.allowPartial ?? false) || (allowPartial && Number(minAmount) !== Number(settings?.minAmount ?? 0));

  if (!open) {
    return (
      <Button variant="secondary" icon={<PlugZap aria-hidden />} onClick={() => setOpen(true)} disabled={disabled}>
        {collapsedLabel}
      </Button>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    const k = keyId.trim();
    if (!KEY_RE.test(k)) next.keyId = 'Paste the Key ID from Razorpay: it starts with rzp_test_ or rzp_live_';
    else if (modeOf(k) === 'test' && !testKeysAllowed) next.keyId = 'This school must use Live keys (rzp_live_...)';
    if (keyChanged && !keySecret.trim()) next.keySecret = settings ? 'Enter the Key secret that belongs to this Key ID' : 'Required';
    if ((!settings || modeChanged) && !webhookSecret.trim()) next.webhookSecret = settings ? 'Test and Live mode have separate webhooks: enter this mode\'s webhook secret' : 'Required';
    if (allowPartial && !(Number(minAmount) >= 1 && Number(minAmount) <= 100000 && /^\d+(\.\d{1,2})?$/.test(minAmount))) next.minAmount = 'Between ₹1 and ₹1,00,000';
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const res = await apiSend<{ data: PaymentSettingsData }>('PUT', '/settings/payments', {
        branchId: target === 'school' ? null : target,
        keyId: k,
        ...(keySecret.trim() && { keySecret: keySecret.trim() }),
        ...(webhookSecret.trim() && { webhookSecret: webhookSecret.trim() }),
        allowPartial,
        ...(allowPartial && { minAmount }),
      });
      setKeySecret('');
      setWebhookSecret('');
      onSaved(res.data, res.data.warning ?? null);
    } catch (err) {
      const fe = fieldErrors(err);
      if (errorCode(err) === 'INVALID_KEYS') fe.keySecret = 'Razorpay did not accept this Key ID and Key secret';
      setErrors(fe);
      setFormError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title={settings ? 'Razorpay keys' : 'Connect Razorpay'}
      description={settings ? `Saved ${ago(settings.updatedAt)}${settings.updatedBy ? ` by ${settings.updatedBy.name}` : ''}` : 'From your Razorpay Dashboard (see the steps on the right).'}
      actions={settings ? <ModeBadge mode={settings.mode} /> : undefined}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field
          label="Key ID"
          htmlFor={ids.keyId}
          error={errors.keyId}
          hint={
            mode === 'test' ? (
              <span className="inline-flex items-center gap-1.5">
                <ModeBadge mode="test" /> No real money: for trying it out.
              </span>
            ) : mode === 'live' ? (
              <span className="inline-flex items-center gap-1.5">
                <ModeBadge mode="live" /> Real payments into your bank account.
              </span>
            ) : (
              'Starts with rzp_test_ (Test mode) or rzp_live_ (Live mode).'
            )
          }
        >
          <input
            id={ids.keyId}
            value={keyId}
            onChange={(e) => {
              setKeyId(e.target.value.trim());
              clear('keyId');
            }}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="rzp_live_XXXXXXXXXXXXXX"
            aria-invalid={errors.keyId ? true : undefined}
            className={cx(controlClass, 'h-10 font-mono sm:h-9', errors.keyId && 'border-red-500')}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <SecretInput
            id={ids.keySecret}
            label="Key secret"
            value={keySecret}
            onChange={(v) => {
              setKeySecret(v);
              clear('keySecret');
            }}
            saved={settings?.keySecretLast4 ?? null}
            error={errors.keySecret}
            hint="Shown once by Razorpay when you generate the key."
          />
          <SecretInput
            id={ids.webhookSecret}
            label="Webhook secret"
            value={webhookSecret}
            onChange={(v) => {
              setWebhookSecret(v);
              clear('webhookSecret');
            }}
            saved={settings?.webhookSecretLast4 ?? null}
            error={errors.webhookSecret}
            hint="The secret you typed when adding the webhook."
          />
        </div>

        <fieldset className="rounded-lg border border-line p-3.5">
          <legend className="px-1 text-13 font-medium text-slate-700 dark:text-slate-300">Options</legend>
          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <input type="checkbox" checked={allowPartial} onChange={(e) => setAllowPartial(e.target.checked)} className="mt-0.5 h-4 w-4 accent-indigo-600" />
            <span>
              <span className="font-medium text-slate-900 dark:text-white">Allow part payments</span>
              <span className="block text-13 text-slate-500 dark:text-slate-400">Parents may pay less than a bill&apos;s balance (oldest due first, like the counter).</span>
            </span>
          </label>
          {allowPartial && (
            <div className="mt-3 max-w-[14rem] pl-6">
              <Input
                id={ids.min}
                label="Smallest part payment (₹)"
                inputMode="decimal"
                value={minAmount}
                onChange={(e) => {
                  setMinAmount(e.target.value.trim());
                  clear('minAmount');
                }}
                error={errors.minAmount}
              />
            </div>
          )}
        </fieldset>

        {formError && <Notice tone="error">{formError}</Notice>}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" loading={busy} disabled={disabled || !dirty} icon={<ShieldCheck aria-hidden />}>
            {settings ? 'Save changes' : 'Save and check keys'}
          </Button>
          {collapsedLabel && !settings && (
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
          )}
          <span className="text-13 text-slate-500 dark:text-slate-400">Secrets are encrypted and never shown again.</span>
        </div>
      </form>
    </Card>
  );
}

// ------------------------------------------------------------------ connection: test, switch on/off, disconnect

function ConnectionCard({
  settings,
  target,
  onChanged,
  onFlash,
  replace,
  canEdit,
}: {
  settings: GatewaySettings;
  target: string;
  onChanged: () => void;
  onFlash: (tone: 'success' | 'error' | 'info' | 'warn', text: ReactNode) => void;
  replace: (next: PaymentSettingsData) => void;
  canEdit: boolean;
}) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [toggling, setToggling] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const branchId = target === 'school' ? null : target;

  async function test() {
    setTesting(true);
    setResult(null);
    try {
      const r = await apiSend<{ data: TestResult }>('POST', '/settings/payments/test', { branchId });
      setResult(r.data);
      onChanged();
    } catch (err) {
      onFlash('error', errorText(err));
    } finally {
      setTesting(false);
    }
  }

  async function toggle() {
    setToggling(true);
    try {
      const r = await apiSend<{ data: PaymentSettingsData }>('PUT', '/settings/payments', { branchId, keyId: settings.keyId, enabled: !settings.enabled });
      replace(r.data);
      const now = (branchId ? r.data.branches.find((b) => b.id === branchId)?.settings : r.data.school)?.enabled;
      onFlash(r.data.warning ? 'warn' : 'success', r.data.warning ?? (now ? 'Online payment is on. Parents now see "Pay now".' : 'Online payment is off. Parents are asked to pay at the school office.'));
    } catch (err) {
      onFlash('error', errorText(err));
    } finally {
      setToggling(false);
    }
  }

  async function disconnect() {
    setRemoving(true);
    setRemoveError(null);
    try {
      const r = await apiSend<{ data: { openOrders: number } }>('DELETE', `/settings/payments${branchId ? `?branchId=${branchId}` : ''}`);
      setConfirm(false);
      onFlash('success', `Razorpay disconnected.${r.data.openOrders ? ` ${r.data.openOrders} payment(s) were still in progress: check them in Razorpay Dashboard.` : ''}`);
      onChanged();
    } catch (err) {
      setRemoveError(errorText(err));
    } finally {
      setRemoving(false);
    }
  }

  const verified = Boolean(settings.verifiedAt);
  return (
    <Card title="Connection" description="Check the keys, then switch online payment on.">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className="inline-flex items-center gap-1.5">
            {verified ? <CircleCheck className="h-4 w-4 text-emerald-600" aria-hidden /> : <CirclePower className="h-4 w-4 text-slate-400" aria-hidden />}
            {verified ? `Keys checked ${ago(settings.verifiedAt)}` : 'Keys not checked yet'}
          </span>
          <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
            <Webhook className="h-4 w-4 text-slate-400" aria-hidden />
            {settings.lastWebhookAt ? `Last webhook ${ago(settings.lastWebhookAt)}` : 'No webhook received yet'}
          </span>
        </div>
        {settings.verifyError && !result && <Notice tone="warn">{settings.verifyError}</Notice>}
        {result && <Notice tone={result.ok ? 'success' : 'error'}>{result.message}</Notice>}

        <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-muted/60 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900 dark:text-white">Take fees online</p>
            <p className="text-13 text-slate-500 dark:text-slate-400">
              {settings.enabled ? 'Parents and students see "Pay now" on open bills.' : verified ? 'Off: parents are asked to pay at the office.' : 'Test the connection first.'}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.enabled}
            aria-label="Take fees online"
            disabled={!canEdit || toggling || (!settings.enabled && !verified)}
            onClick={toggle}
            className={cx(
              'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-slate-900',
              settings.enabled ? 'bg-indigo-600 dark:bg-indigo-500' : 'bg-slate-300 dark:bg-white/15',
            )}
          >
            <span className={cx('inline-block h-5 w-5 rounded-full bg-white shadow transition-transform', settings.enabled ? 'translate-x-6' : 'translate-x-1')} />
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" loading={testing} onClick={test} icon={<ShieldCheck aria-hidden />}>
            Test connection
          </Button>
          {canEdit && (
            <Button variant="ghost" className="text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/10" onClick={() => setConfirm(true)} icon={<Unplug aria-hidden />}>
              Disconnect
            </Button>
          )}
        </div>
      </div>

      <ConfirmModal
        open={confirm}
        title="Disconnect Razorpay?"
        confirmLabel="Disconnect"
        busy={removing}
        error={removeError}
        onConfirm={disconnect}
        onClose={() => setConfirm(false)}
      >
        <p>The saved keys are deleted and parents can no longer pay online{branchId ? ' at this branch' : ''}. Payments already received and their receipts stay as they are.</p>
        <p className="mt-2">A payment someone is making right now can&apos;t be confirmed automatically afterwards: check it in the Razorpay Dashboard.</p>
      </ConfirmModal>
    </Card>
  );
}

// ------------------------------------------------------------------ webhook + guide

function WebhookCard({ url, events, lastWebhookAt }: { url: string; events: string[]; lastWebhookAt: string | null }) {
  return (
    <Card
      title="Webhook"
      description="Razorpay tells SM ERP about each payment through this address. Without it, payments wait until someone presses Reconcile."
      actions={lastWebhookAt ? <Badge tone="green" dot>Receiving</Badge> : <Badge tone="gray">Nothing received yet</Badge>}
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="mb-1.5 text-13 font-medium text-slate-700 dark:text-slate-300">Webhook URL (unique to your school)</p>
          <CopyField value={url} label="Webhook URL" />
        </div>
        <div>
          <p className="mb-1.5 text-13 font-medium text-slate-700 dark:text-slate-300">Active events to tick</p>
          <ul className="flex flex-wrap gap-2">
            {events.map((e) => (
              <li key={e}>
                <code className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-muted px-2 py-1 font-mono text-13">
                  <CircleCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                  {e}
                </code>
              </li>
            ))}
          </ul>
        </div>
        {lastWebhookAt && <p className="text-13 text-slate-500 dark:text-slate-400">Last webhook received {formatDateTime(lastWebhookAt)}.</p>}
      </div>
    </Card>
  );
}

function HowTo({ webhookUrl }: { webhookUrl: string }) {
  const steps = useMemo(
    () => [
      {
        title: 'Open the Razorpay Dashboard',
        body: (
          <>
            Sign in at{' '}
            <a href="https://dashboard.razorpay.com" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-indigo-700 underline-offset-2 hover:underline dark:text-indigo-300">
              dashboard.razorpay.com <ExternalLink className="h-3 w-3" aria-hidden />
            </a>{' '}
            with the school&apos;s own account. Live payments need Razorpay&apos;s KYC to be complete.
          </>
        ),
      },
      {
        title: 'Pick Test or Live mode',
        body: 'Use the Test / Live switch at the top of the Dashboard. Start with Test mode to try a payment without real money; repeat these steps in Live mode later.',
      },
      {
        title: 'Create API keys',
        body: 'Account & Settings → API Keys → Generate key. Copy the Key ID and the Key secret (Razorpay shows the secret only once).',
      },
      {
        title: 'Add the webhook',
        body: (
          <>
            Account & Settings → Webhooks → Add new webhook. Paste the Webhook URL{webhookUrl ? ' shown on this page' : ''}, type a secret (any long password; you&apos;ll paste it here too), tick{' '}
            <span className="font-mono text-[12px]">payment.captured</span>, <span className="font-mono text-[12px]">payment.failed</span> and <span className="font-mono text-[12px]">order.paid</span>, and save.
          </>
        ),
      },
      {
        title: 'Paste and switch on',
        body: 'Paste the Key ID, Key secret and Webhook secret here, save, press Test connection, then switch "Take fees online" on.',
      },
    ],
    [webhookUrl],
  );
  return (
    <Card title="How to connect" description="About 5 minutes, once.">
      <ol className="flex flex-col gap-4">
        {steps.map((st, i) => (
          <li key={st.title} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-950 text-xs font-semibold text-white dark:bg-indigo-500">{i + 1}</span>
            <div className="min-w-0 text-sm">
              <p className="font-medium text-slate-900 dark:text-white">{st.title}</p>
              <p className="mt-0.5 text-slate-600 dark:text-slate-300">{st.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-5 rounded-lg bg-surface-muted px-3.5 py-3 text-13 text-slate-600 dark:text-slate-300">
        <p className="flex items-center gap-1.5 font-medium text-slate-900 dark:text-white">
          <Link2 className="h-3.5 w-3.5" aria-hidden /> Trying it in Test mode
        </p>
        <p className="mt-1">Sign in as a parent, open Fees and press Pay now. In Razorpay&apos;s test window use UPI ID <span className="font-mono">success@razorpay</span> or a test card from Razorpay&apos;s docs. The receipt appears within seconds.</p>
      </div>
    </Card>
  );
}
