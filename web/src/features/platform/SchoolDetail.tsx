'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CirclePause, CirclePlay } from 'lucide-react';
import { Badge, Button, Card, ErrorState, Input, Notice, Page, PageHeader, Select, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { useApi } from '@/lib/useApi';
import { apiSend } from '@/lib/session';
import { formatDate } from '@/lib/format';
import { ConfirmModal, DefinitionList, errorText, useFlash } from '@/features/admin/shared';
import { CHANNEL_LABEL, numberOrNull, SaveBar, timeAgo } from '@/features/settings/bits';
import type { Channel, Limits } from '@/features/settings/types';
import type { ModuleKey } from '@/lib/entitlements';
import { SUB_LABEL, SUB_TONE } from './SchoolsPage';
import type { ModuleDef, Plan, SubStatus, TenantDetail } from './types';

const LIMITS: Array<{ key: keyof Limits; label: string }> = [
  { key: 'maxStudents', label: 'Students' },
  { key: 'maxBranches', label: 'Branches' },
  { key: 'whatsappPerMonth', label: 'WhatsApp / month' },
  { key: 'smsPerMonth', label: 'SMS / month' },
  { key: 'emailsPerMonth', label: 'Emails / month' },
];

type Form = {
  planId: string;
  status: SubStatus;
  trialEndsAt: string;
  currentPeriodEnd: string;
  notes: string;
  overrides: Partial<Record<ModuleKey, boolean>>;
  limits: Record<keyof Limits, string>;
};

const day = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : '');

/** Platform console -> one school: plan, status, module and limit overrides, usage, admins. */
export default function SchoolDetail({ id }: { id: string }) {
  const { data, error, reload, setData } = useApi<{ data: TenantDetail }>(`/platform/tenants/${id}`);
  const plans = useApi<{ data: { plans: Plan[]; modules: ModuleDef[] } }>('/platform/plans');
  const flash = useFlash();
  const t = data?.data;
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmSuspend, setConfirmSuspend] = useState(false);

  const initial = useMemo<Form | null>(() => {
    if (!t) return null;
    const s = t.subscription;
    return {
      planId: s?.planId ?? '',
      status: s?.status ?? 'active',
      trialEndsAt: day(s?.trialEndsAt),
      currentPeriodEnd: day(s?.currentPeriodEnd),
      notes: s?.notes ?? '',
      overrides: { ...(s?.moduleOverrides ?? {}) },
      limits: Object.fromEntries(LIMITS.map((l) => [l.key, s?.limitOverrides?.[l.key] === undefined || s?.limitOverrides?.[l.key] === null ? '' : String(s.limitOverrides[l.key])])) as Form['limits'],
    };
  }, [t]);
  useEffect(() => setForm(initial), [initial]);

  const plan = plans.data?.data.plans.find((p) => p.id === form?.planId) ?? null;
  const optional = (plans.data?.data.modules ?? []).filter((m) => !m.core);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  async function save() {
    if (!form) return;
    setBusy(true);
    try {
      const limitOverrides = Object.fromEntries(LIMITS.filter((l) => form.limits[l.key].trim() !== '').map((l) => [l.key, numberOrNull(form.limits[l.key])]));
      const r = await apiSend<{ data: TenantDetail }>('PATCH', `/platform/tenants/${id}`, {
        subscription: {
          planId: form.planId,
          status: form.status,
          trialEndsAt: form.trialEndsAt || null,
          currentPeriodEnd: form.currentPeriodEnd || null,
          notes: form.notes.trim() || null,
          moduleOverrides: form.overrides,
          limitOverrides,
        },
      });
      setData(r);
      flash.show('success', 'Saved. The school sees the change within a minute.');
    } catch (err) {
      flash.show('error', errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleSchool() {
    if (!t) return;
    setBusy(true);
    try {
      const r = await apiSend<{ data: TenantDetail }>('PATCH', `/platform/tenants/${id}`, { status: t.status === 'suspended' ? 'active' : 'suspended' });
      setData(r);
      setConfirmSuspend(false);
      flash.show('success', r.data.status === 'suspended' ? 'School suspended: nobody from this school can sign in.' : 'School re-activated.');
    } catch (err) {
      flash.show('error', errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page wide>
      <PageHeader
        title={t?.name ?? 'School'}
        breadcrumb={
          <Link href="/platform" className="inline-flex items-center gap-1 hover:text-slate-800 dark:hover:text-slate-200">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Schools
          </Link>
        }
        description={t ? <span className="font-mono">{t.code}</span> : undefined}
        actions={
          t && (
            <Button variant={t.status === 'suspended' ? 'primary' : 'secondary'} icon={t.status === 'suspended' ? <CirclePlay aria-hidden /> : <CirclePause aria-hidden />} onClick={() => (t.status === 'suspended' ? toggleSchool() : setConfirmSuspend(true))} loading={busy && !form}>
              {t.status === 'suspended' ? 'Re-activate school' : 'Suspend school'}
            </Button>
          )
        }
      />
      {flash.node}
      {error ? (
        <Card>
          <ErrorState message={error} onRetry={reload} />
        </Card>
      ) : !t || !form ? (
        <Spinner label="Loading school" />
      ) : (
        <>
          {t.status === 'suspended' && (
            <div className="mb-5">
              <Notice tone="error">This school is suspended: its staff, parents and students cannot sign in.</Notice>
            </div>
          )}
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] xl:items-start">
            <div className="flex min-w-0 flex-col gap-5">
              <Card title="Subscription" actions={t.subscription ? <Badge tone={SUB_TONE[t.subscription.status]}>{SUB_LABEL[t.subscription.status]}</Badge> : <Badge>No plan</Badge>}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Select label="Plan" value={form.planId} onChange={(e) => setForm({ ...form, planId: e.target.value })}>
                    {!form.planId && <option value="">Choose a plan</option>}
                    {plans.data?.data.plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {!p.isActive ? ' (retired)' : ''}
                      </option>
                    ))}
                  </Select>
                  <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as SubStatus })} hint="Suspended / cancelled also blocks sign-in.">
                    {(Object.keys(SUB_LABEL) as SubStatus[]).map((s) => (
                      <option key={s} value={s}>
                        {SUB_LABEL[s]}
                      </option>
                    ))}
                  </Select>
                  <Input label="Trial ends" type="date" value={form.trialEndsAt} onChange={(e) => setForm({ ...form, trialEndsAt: e.target.value })} />
                  <Input label="Paid until" type="date" value={form.currentPeriodEnd} onChange={(e) => setForm({ ...form, currentPeriodEnd: e.target.value })} />
                  <Textarea label="Notes (internal)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="sm:col-span-2" />
                </div>
              </Card>

              <Card title="Modules" description="Plan default, or force a module on / off for this school only." padded={false}>
                <Table>
                  <thead>
                    <tr>
                      <Th>Module</Th>
                      <Th>In {plan?.name ?? 'plan'}</Th>
                      <Th>For this school</Th>
                      <Th>School&apos;s switch</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {optional.map((m) => {
                      const inPlan = plan?.modules.includes(m.key) ?? false;
                      const o = form.overrides[m.key];
                      const available = t.entitlements?.availableModules.includes(m.key);
                      const enabled = t.entitlements?.modules.includes(m.key);
                      return (
                        <tr key={m.key}>
                          <Td>{m.label}</Td>
                          <Td>{inPlan ? <Badge tone="green">Yes</Badge> : <Badge>No</Badge>}</Td>
                          <Td>
                            <Select
                              aria-label={`${m.label} for this school`}
                              value={o === undefined ? 'plan' : o ? 'on' : 'off'}
                              onChange={(e) => {
                                const next = { ...form.overrides };
                                if (e.target.value === 'plan') delete next[m.key];
                                else next[m.key] = e.target.value === 'on';
                                setForm({ ...form, overrides: next });
                              }}
                              className="w-40"
                            >
                              <option value="plan">As plan</option>
                              <option value="on">Force on</option>
                              <option value="off">Force off</option>
                            </Select>
                          </Td>
                          <Td className="text-13 text-slate-500">{available ? (enabled ? 'On' : 'Switched off') : '—'}</Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </Card>

              <Card title="Limits" description="Empty = the plan's limit. Message limits count only messages sent through the SM ERP account.">
                <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
                  {LIMITS.map((l) => (
                    <Input
                      key={l.key}
                      label={l.label}
                      type="number"
                      min={0}
                      value={form.limits[l.key]}
                      placeholder={plan ? (plan.limits[l.key] === null ? 'No limit' : String(plan.limits[l.key])) : ''}
                      onChange={(e) => setForm({ ...form, limits: { ...form.limits, [l.key]: e.target.value } })}
                    />
                  ))}
                </div>
              </Card>
            </div>

            <div className="flex min-w-0 flex-col gap-5">
              <Card title="School">
                <DefinitionList
                  items={[
                    ['Students', t.students.toLocaleString('en-IN')],
                    ['Office email', t.contactEmail ?? '—'],
                    ['Office phone', t.contactPhone ?? '—'],
                    ['Time zone', t.timezone],
                    ['Joined', formatDate(day(t.createdAt))],
                  ]}
                />
              </Card>
              <Card title="Messages this month">
                <div className="grid grid-cols-3 gap-3">
                  {(['whatsapp', 'sms', 'email'] as Channel[]).map((c) => (
                    <div key={c} className="rounded-lg bg-surface-muted/70 p-3">
                      <p className="text-13 text-slate-500">{CHANNEL_LABEL[c]}</p>
                      <p className="text-lg font-semibold tabular-nums">{(t.usage[c].school + t.usage[c].platform).toLocaleString('en-IN')}</p>
                      <p className="text-xs text-slate-500">{t.usage[c].platform.toLocaleString('en-IN')} via SM ERP</p>
                    </div>
                  ))}
                </div>
              </Card>
              <Card title="Branches" padded={false}>
                <ul className="divide-y divide-line">
                  {t.branches.map((b) => (
                    <li key={b.id} className="flex items-center justify-between px-4 py-2.5 text-sm sm:px-5">
                      <span>
                        {b.name} <span className="font-mono text-xs text-slate-500">{b.code}</span>
                      </span>
                      {b.isHeadOffice && <Badge>Head office</Badge>}
                    </li>
                  ))}
                </ul>
              </Card>
              <Card title="Administrators" padded={false}>
                <ul className="divide-y divide-line">
                  {t.admins.map((a) => (
                    <li key={a.id} className="px-4 py-2.5 text-sm sm:px-5">
                      <p className="font-medium">
                        {a.name} <span className="text-xs font-normal text-slate-500">{a.role === 'super_admin' ? 'Owner' : 'Branch admin'}</span>
                      </p>
                      <p className="text-xs text-slate-500">
                        {a.email ?? a.phone} · {a.mustChangePassword ? 'has not signed in yet' : `signed in ${timeAgo(a.lastLoginAt)}`}
                      </p>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </div>
          <SaveBar dirty={dirty} busy={busy} onSave={save} onReset={() => setForm(initial)} />
        </>
      )}
      <ConfirmModal open={confirmSuspend} title={`Suspend ${t?.name ?? 'school'}?`} confirmLabel="Suspend" busy={busy} onConfirm={toggleSchool} onClose={() => setConfirmSuspend(false)}>
        <p>Nobody from this school can sign in until you re-activate it. Its data is kept, and scheduled messages stop.</p>
      </ConfirmModal>
    </Page>
  );
}
