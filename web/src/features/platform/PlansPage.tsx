'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Badge, Button, Card, ErrorState, Input, Modal, Notice, Page, PageHeader, Spinner, Textarea, cx } from '@/components/ui';
import { useApi } from '@/lib/useApi';
import { apiSend } from '@/lib/session';
import { errorText, fieldErrors, useFlash } from '@/features/admin/shared';
import { numberOrNull, Switch } from '@/features/settings/bits';
import type { Limits } from '@/features/settings/types';
import type { ModuleKey } from '@/lib/entitlements';
import type { ModuleDef, Plan } from './types';

const LIMITS: Array<{ key: keyof Limits; label: string }> = [
  { key: 'maxStudents', label: 'Students' },
  { key: 'maxBranches', label: 'Branches' },
  { key: 'whatsappPerMonth', label: 'WhatsApp / month' },
  { key: 'smsPerMonth', label: 'SMS / month' },
  { key: 'emailsPerMonth', label: 'Emails / month' },
];

type Draft = {
  code: string;
  name: string;
  description: string;
  modules: ModuleKey[];
  limits: Record<keyof Limits, string>;
  priceMonthly: string;
  priceYearly: string;
  priceNote: string;
  isActive: boolean;
};

const toDraft = (p: Plan | null): Draft => ({
  code: p?.code ?? '',
  name: p?.name ?? '',
  description: p?.description ?? '',
  modules: p?.modules ?? [],
  limits: Object.fromEntries(LIMITS.map((l) => [l.key, p?.limits[l.key] === null || p?.limits[l.key] === undefined ? '' : String(p.limits[l.key])])) as Draft['limits'],
  priceMonthly: p?.priceMonthly ?? '',
  priceYearly: p?.priceYearly ?? '',
  priceNote: p?.priceNote ?? 'per student per year',
  isActive: p?.isActive ?? true,
});

const body = (d: Draft) => ({
  name: d.name.trim(),
  description: d.description.trim() || null,
  modules: d.modules,
  limits: Object.fromEntries(LIMITS.map((l) => [l.key, numberOrNull(d.limits[l.key])])),
  priceMonthly: d.priceMonthly.trim() || null,
  priceYearly: d.priceYearly.trim() || null,
  priceNote: d.priceNote.trim() || null,
  isActive: d.isActive,
});

/** Platform console -> Plans: what each plan includes and its limits. */
export default function PlansPage() {
  const { data, error, reload } = useApi<{ data: { plans: Plan[]; modules: ModuleDef[] } }>('/platform/plans');
  const flash = useFlash();
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const d = data?.data;
  const optional = useMemo(() => (d?.modules ?? []).filter((m) => !m.core), [d]);

  return (
    <Page wide>
      <PageHeader
        title="Plans"
        description="Core modules (students, staff, attendance, fees) are in every plan. Changes apply to every school on the plan within a minute."
        actions={
          <Button icon={<Plus aria-hidden />} onClick={() => setEditing('new')}>
            New plan
          </Button>
        }
      />
      {flash.node}
      {error ? (
        <Card>
          <ErrorState message={error} onRetry={reload} />
        </Card>
      ) : !d ? (
        <Spinner label="Loading plans" />
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          {d.plans.map((p) => (
            <Card
              key={p.id}
              title={
                <span className="flex items-center gap-2">
                  {p.name} {!p.isActive && <Badge>Retired</Badge>}
                </span>
              }
              description={`${p.schools} school${p.schools === 1 ? '' : 's'}`}
              actions={
                <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>
                  Edit
                </Button>
              }
            >
              {p.description && <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">{p.description}</p>}
              <p className="mb-3 text-sm">
                {p.priceYearly || p.priceMonthly ? (
                  <>
                    <span className="text-lg font-semibold">₹{Number(p.priceYearly ?? p.priceMonthly).toLocaleString('en-IN')}</span>{' '}
                    <span className="text-slate-500">{p.priceYearly ? '/ year' : '/ month'} {p.priceNote}</span>
                  </>
                ) : (
                  <span className="text-slate-500">No price set</span>
                )}
              </p>
              <ul className="mb-3 flex flex-wrap gap-1.5">
                {optional.map((m) => (
                  <li key={m.key} className={cx('rounded-md px-2 py-0.5 text-xs', p.modules.includes(m.key) ? 'bg-indigo-50 text-indigo-800 dark:bg-indigo-400/10 dark:text-indigo-200' : 'bg-slate-100 text-slate-400 line-through dark:bg-white/5')}>
                    {m.label}
                  </li>
                ))}
              </ul>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-13">
                {LIMITS.map((l) => (
                  <div key={l.key} className="flex justify-between gap-2">
                    <dt className="text-slate-500">{l.label}</dt>
                    <dd className="tabular-nums">{p.limits[l.key] === null ? 'No limit' : p.limits[l.key]!.toLocaleString('en-IN')}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          ))}
        </div>
      )}
      <PlanModal
        plan={editing}
        modules={optional}
        onClose={() => setEditing(null)}
        onSaved={(msg) => {
          setEditing(null);
          flash.show('success', msg);
          reload();
        }}
      />
    </Page>
  );
}

function PlanModal({ plan, modules, onClose, onSaved }: { plan: Plan | 'new' | null; modules: ModuleDef[]; onClose: () => void; onSaved: (msg: string) => void }) {
  const isNew = plan === 'new';
  const [draft, setDraft] = useState<Draft>(toDraft(null));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (plan) {
      setDraft(toDraft(plan === 'new' ? null : plan));
      setErrors({});
      setFormError(null);
    }
  }, [plan]);

  const groups = useMemo(() => {
    const out = new Map<string, ModuleDef[]>();
    for (const m of modules) out.set(m.group, [...(out.get(m.group) ?? []), m]);
    return [...out];
  }, [modules]);

  async function save() {
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      if (isNew) await apiSend('POST', '/platform/plans', { code: draft.code.trim().toLowerCase(), ...body(draft) });
      else if (plan) await apiSend('PATCH', `/platform/plans/${plan.id}`, body(draft));
      onSaved(isNew ? `Plan ${draft.name} created.` : `Plan ${draft.name} saved.`);
    } catch (err) {
      setErrors(fieldErrors(err));
      setFormError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (k: ModuleKey) => setDraft((d) => ({ ...d, modules: d.modules.includes(k) ? d.modules.filter((x) => x !== k) : [...d.modules, k] }));

  return (
    <Modal
      open={Boolean(plan)}
      onClose={onClose}
      title={isNew ? 'New plan' : `Edit ${typeof plan === 'object' && plan ? plan.name : ''}`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy}>
            Save plan
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {isNew && <Input label="Code" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="gold" hint="Permanent. Lower-case letters, digits, - and _." error={errors.code} className="[&_input]:font-mono" />}
          <Input label="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} error={errors.name} />
          <Textarea label="Description" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={2} className="sm:col-span-2" />
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold">Modules</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {groups.map(([group, mods]) => (
              <div key={group}>
                <p className="mb-1 text-xs font-medium text-slate-500">{group}</p>
                {mods.map((m) => (
                  <label key={m.key} className="flex cursor-pointer items-center gap-2 py-1 text-sm">
                    <input type="checkbox" className="accent-indigo-600" checked={draft.modules.includes(m.key)} onChange={() => toggle(m.key)} />
                    {m.label}
                  </label>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold">Limits</p>
          <div className="grid gap-3 sm:grid-cols-5">
            {LIMITS.map((l) => (
              <Input key={l.key} label={l.label} type="number" min={0} value={draft.limits[l.key]} placeholder="No limit" onChange={(e) => setDraft({ ...draft, limits: { ...draft.limits, [l.key]: e.target.value } })} />
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Price / month (₹)" value={draft.priceMonthly} onChange={(e) => setDraft({ ...draft, priceMonthly: e.target.value })} inputMode="decimal" />
          <Input label="Price / year (₹)" value={draft.priceYearly} onChange={(e) => setDraft({ ...draft, priceYearly: e.target.value })} inputMode="decimal" />
          <Input label="Price note" value={draft.priceNote} onChange={(e) => setDraft({ ...draft, priceNote: e.target.value })} placeholder="per student per year" />
        </div>
        <label className="flex items-center justify-between gap-3 rounded-lg bg-surface-muted/60 px-3.5 py-2.5 text-sm">
          <span>
            <span className="font-medium">Offered to new schools</span>
            <span className="block text-13 text-slate-500">Retired plans keep their current schools.</span>
          </span>
          <Switch checked={draft.isActive} onChange={(v) => setDraft({ ...draft, isActive: v })} label="Offered to new schools" />
        </label>
        {formError && <Notice tone="error">{formError}</Notice>}
      </div>
    </Modal>
  );
}
