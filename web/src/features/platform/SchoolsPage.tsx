'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { Building2, Plus } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, Notice, Page, PageHeader, Pagination, SearchInput, Select, Spinner, Stat, Table, Td, Th, type BadgeTone } from '@/components/ui';
import { qs, useApi } from '@/lib/useApi';
import { apiSend } from '@/lib/session';
import { formatDate } from '@/lib/format';
import { errorText, fieldErrors, useDebounced } from '@/features/admin/shared';
import { CopyField } from '@/features/payments/bits';
import { timeAgo } from '@/features/settings/bits';
import type { Plan, PlatformOverview, SubStatus, TenantRow } from './types';

export const SUB_TONE: Record<SubStatus, BadgeTone> = { trial: 'amber', active: 'green', past_due: 'red', suspended: 'red', cancelled: 'gray' };
export const SUB_LABEL: Record<SubStatus, string> = { trial: 'Trial', active: 'Active', past_due: 'Payment due', suspended: 'Suspended', cancelled: 'Cancelled' };

/** Platform console: every school, its plan and status; onboard a new school. */
export default function SchoolsPage() {
  const overview = useApi<{ data: PlatformOverview }>('/platform/overview');
  const plans = useApi<{ data: { plans: Plan[] } }>('/platform/plans');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [planId, setPlanId] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  const list = useApi<{ data: TenantRow[]; meta: { total: number; totalPages: number } }>(`/platform/tenants${qs({ search: debounced, status, planId, page, limit: 25 })}`);
  const [adding, setAdding] = useState(false);
  const o = overview.data?.data;
  const sent = (channel: string) => (o?.messagesThisMonth ?? []).filter((m) => m.channel === channel && m.account === 'platform').reduce((s, m) => s + m.sent, 0);

  return (
    <Page wide>
      <PageHeader
        title="Schools"
        description="Every school on SM ERP: plan, trial and usage. Onboard a new school, change its plan, or suspend it."
        actions={
          <Button icon={<Plus aria-hidden />} onClick={() => setAdding(true)}>
            New school
          </Button>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Active schools" value={o ? o.schools.active : '…'} />
        <Stat label="On trial" value={o ? o.schools.trial : '…'} tone={o && o.trialsEnding.length ? 'warn' : 'default'} hint={o?.trialsEnding.length ? `${o.trialsEnding.length} ending this week` : undefined} />
        <Stat label="Students" value={o ? o.students.toLocaleString('en-IN') : '…'} />
        <Stat label="WhatsApp this month" value={o ? sent('whatsapp').toLocaleString('en-IN') : '…'} hint="SM ERP account" />
        <Stat label="SMS this month" value={o ? sent('sms').toLocaleString('en-IN') : '…'} hint="SM ERP account" />
      </div>

      {o && o.trialsEnding.length > 0 && (
        <div className="mb-5">
          <Notice tone="warn">
            Trials ending soon:{' '}
            {o.trialsEnding.map((t, i) => (
              <span key={t.id}>
                {i > 0 && ', '}
                <Link href={`/platform/tenants/${t.id}`} className="font-medium underline">
                  {t.name}
                </Link>{' '}
                ({formatDate(String(t.trialEndsAt).slice(0, 10))})
              </span>
            ))}
          </Notice>
        </div>
      )}

      <Card padded={false}>
        <div className="flex flex-wrap gap-3 border-b border-line p-3">
          <SearchInput label="Search schools" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} placeholder="Name, code or email" containerClassName="min-w-[14rem] flex-1" />
          <div className="w-44">
          <Select aria-label="Status" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
            <option value="">All statuses</option>
            {Object.entries(SUB_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          </div>
          <div className="w-44">
          <Select aria-label="Plan" value={planId} onChange={(e) => (setPlanId(e.target.value), setPage(1))}>
            <option value="">All plans</option>
            {plans.data?.data.plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          </div>
        </div>
        {list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : !list.data ? (
          <Spinner skeleton />
        ) : list.data.data.length === 0 ? (
          <EmptyState icon={<Building2 aria-hidden />} title="No schools found" action={<Button onClick={() => setAdding(true)}>New school</Button>} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>School</Th>
                  <Th>Plan</Th>
                  <Th>Status</Th>
                  <Th align="right">Students</Th>
                  <Th align="right">Branches</Th>
                  <Th>Last sign-in</Th>
                </tr>
              </thead>
              <tbody>
                {list.data.data.map((t) => (
                  <tr key={t.id}>
                    <Td>
                      <Link href={`/platform/tenants/${t.id}`} className="font-medium text-slate-900 hover:text-indigo-700 dark:text-white dark:hover:text-indigo-300">
                        {t.name}
                      </Link>
                      <span className="block font-mono text-xs text-slate-500">{t.code}</span>
                    </Td>
                    <Td>{t.plan?.name ?? <span className="text-slate-400">No plan</span>}</Td>
                    <Td>
                      {t.status === 'suspended' ? (
                        <Badge tone="red">School suspended</Badge>
                      ) : t.subscriptionStatus ? (
                        <Badge tone={SUB_TONE[t.subscriptionStatus]}>
                          {SUB_LABEL[t.subscriptionStatus]}
                          {t.subscriptionStatus === 'trial' && t.trialEndsAt ? ` to ${formatDate(String(t.trialEndsAt).slice(0, 10))}` : ''}
                        </Badge>
                      ) : (
                        <Badge>Unmanaged</Badge>
                      )}
                    </Td>
                    <Td align="right">{t.students.toLocaleString('en-IN')}</Td>
                    <Td align="right">{t.branches}</Td>
                    <Td className="text-13 text-slate-500">{t.lastLoginAt ? timeAgo(t.lastLoginAt) : 'Never'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} totalPages={list.data.meta.totalPages} onChange={setPage} />
          </>
        )}
      </Card>

      <NewSchoolModal
        open={adding}
        plans={plans.data?.data.plans ?? []}
        onClose={() => setAdding(false)}
        onCreated={() => {
          list.reload();
          overview.reload();
        }}
      />
    </Page>
  );
}

type Created = { school: { id: string; name: string; code: string }; plan: { name: string }; ownerLogin: { schoolCode: string; identifier: string; temporaryPassword: string } };

function NewSchoolModal({ open, plans, onClose, onCreated }: { open: boolean; plans: Plan[]; onClose: () => void; onCreated: () => void }) {
  const empty = { name: '', code: '', contactEmail: '', contactPhone: '', branchName: 'Main Campus', branchCode: 'MAIN', city: '', state: '', firstName: '', lastName: '', ownerEmail: '', ownerPhone: '', planCode: '', trialDays: '14' };
  const [f, setF] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  useEffect(() => {
    if (open) {
      setF({ ...empty, planCode: plans.find((p) => p.code === 'standard')?.code ?? plans[0]?.code ?? '' });
      setErrors({});
      setFormError(null);
      setCreated(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      const r = await apiSend<{ data: Created }>('POST', '/platform/tenants', {
        name: f.name.trim(),
        code: f.code.trim().toLowerCase(),
        contactEmail: f.contactEmail.trim() || null,
        contactPhone: f.contactPhone.trim() || null,
        branch: { name: f.branchName.trim(), code: f.branchCode.trim().toUpperCase(), city: f.city.trim() || null, state: f.state.trim() || null },
        owner: { firstName: f.firstName.trim(), lastName: f.lastName.trim() || null, email: f.ownerEmail.trim() || null, phone: f.ownerPhone.trim() || null },
        planCode: f.planCode,
        trialDays: Number(f.trialDays) || 0,
      });
      setCreated(r.data);
      onCreated();
    } catch (err) {
      const fe = fieldErrors(err);
      // Nested owner / branch errors come back under their own keys.
      setErrors(fe);
      setFormError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    const loginUrl = typeof window !== 'undefined' ? `${window.location.origin}/login` : '/login';
    return (
      <Modal open={open} onClose={onClose} title={`${created.school.name} is ready`} description={`On ${created.plan.name}. Give the owner these sign-in details: the password is shown only once.`} footer={<Button onClick={onClose}>Done</Button>}>
        <div className="flex flex-col gap-3 text-sm">
          <div>
            <p className="mb-1 text-13 text-slate-500">Sign-in page</p>
            <CopyField value={loginUrl} label="Sign-in page" />
          </div>
          <div>
            <p className="mb-1 text-13 text-slate-500">School code</p>
            <CopyField value={created.ownerLogin.schoolCode} label="School code" />
          </div>
          <div>
            <p className="mb-1 text-13 text-slate-500">Login</p>
            <CopyField value={created.ownerLogin.identifier} label="Login" />
          </div>
          <div>
            <p className="mb-1 text-13 text-slate-500">Temporary password</p>
            <CopyField value={created.ownerLogin.temporaryPassword} label="Temporary password" large />
          </div>
          <Notice>At first sign-in the owner sets their own password, then goes through Settings: school profile, classes, fee structure, messaging.</Notice>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New school"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="new-school" loading={busy}>
            Create school
          </Button>
        </>
      }
    >
      <form id="new-school" onSubmit={submit} noValidate className="flex flex-col gap-5">
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">School</legend>
          <Input label="School name" value={f.name} onChange={set('name')} placeholder="Green Valley Public School" error={errors.name} />
          <Input
            label="School code"
            value={f.code}
            onChange={(e) => setF((x) => ({ ...x, code: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
            placeholder="green-valley"
            hint="Typed at sign-in. Lower-case letters, digits and -."
            error={errors.code}
            className="[&_input]:font-mono"
          />
          <Input label="Office email" value={f.contactEmail} onChange={set('contactEmail')} type="email" error={errors.contactEmail} />
          <Input label="Office phone" value={f.contactPhone} onChange={set('contactPhone')} inputMode="tel" error={errors.contactPhone} />
        </fieldset>
        <fieldset className="grid gap-4 sm:grid-cols-4">
          <legend className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">First branch</legend>
          <Input label="Name" value={f.branchName} onChange={set('branchName')} className="sm:col-span-2" />
          <Input label="Code" value={f.branchCode} onChange={set('branchCode')} hint="In receipt numbers" className="[&_input]:font-mono" />
          <Input label="City" value={f.city} onChange={set('city')} />
        </fieldset>
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Owner login</legend>
          <Input label="First name" value={f.firstName} onChange={set('firstName')} error={errors.firstName} />
          <Input label="Last name" value={f.lastName} onChange={set('lastName')} />
          <Input label="Email" value={f.ownerEmail} onChange={set('ownerEmail')} type="email" error={errors.email} hint="Used to sign in (or the mobile number)." />
          <Input label="Mobile" value={f.ownerPhone} onChange={set('ownerPhone')} inputMode="tel" error={errors.phone} />
        </fieldset>
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Plan</legend>
          <Select label="Plan" value={f.planCode} onChange={set('planCode')}>
            {plans
              .filter((p) => p.isActive)
              .map((p) => (
                <option key={p.id} value={p.code}>
                  {p.name}
                </option>
              ))}
          </Select>
          <Input label="Free trial (days)" type="number" min={0} max={365} value={f.trialDays} onChange={set('trialDays')} hint="0 = active from today." />
        </fieldset>
        {formError && <Notice tone="error">{formError}</Notice>}
      </form>
    </Modal>
  );
}
