'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Search, UserPlus } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, Notice, Page, PageHeader, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { useApi } from '@/lib/useApi';
import { apiSend, currentUser } from '@/lib/session';
import { formatDate } from '@/lib/format';
import { Avatar, ConfirmModal, FilterBar, PhoneLink, errorCode, errorText, fieldErrors, useFlash } from './shared';
import type { StaffMember, StaffRole, Wrapped } from './types';

const ROLE_BADGE: Record<StaffRole, { label: string; tone: 'indigo' | 'amber' | 'gray' }> = {
  teacher: { label: 'Teacher', tone: 'gray' },
  branch_admin: { label: 'Admin', tone: 'indigo' },
  super_admin: { label: 'Owner', tone: 'amber' },
};

export default function StaffPage() {
  const { data, error, loading, reload, setData } = useApi<Wrapped<StaffMember[]>>('/staff');
  const flash = useFlash();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<'' | StaffRole>('');
  const [status, setStatus] = useState<'' | 'active' | 'inactive'>('active');
  const [adding, setAdding] = useState(false);
  const [toggle, setToggle] = useState<StaffMember | null>(null);
  const [busy, setBusy] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const me = useMemo(() => currentUser(), []);

  const rows = useMemo(() => {
    const t = search.trim().toLowerCase();
    return (data?.data ?? []).filter(
      (s) =>
        (!role || s.role === role) &&
        (!status || s.status === status) &&
        (!t || [s.name, s.email, s.phone, s.designation, s.employeeCode, s.department].some((v) => v?.toLowerCase().includes(t))),
    );
  }, [data, search, role, status]);
  const counts = useMemo(() => {
    const all = data?.data ?? [];
    return { active: all.filter((s) => s.status === 'active').length, teachers: all.filter((s) => s.role === 'teacher' && s.status === 'active').length };
  }, [data]);

  async function doToggle() {
    if (!toggle) return;
    const next = toggle.status === 'active' ? 'inactive' : 'active';
    setBusy(true);
    setToggleError(null);
    try {
      const res = await apiSend<Wrapped<StaffMember>>('PATCH', `/staff/${toggle.id}`, { status: next });
      setData((prev) => (prev ? { data: prev.data.map((s) => (s.id === toggle.id ? { ...s, ...(res?.data ?? { status: next }) } : s)) } : prev));
      flash.show('success', `${toggle.name} is now ${next}.${next === 'inactive' ? ' They can no longer sign in.' : ''}`);
      setToggle(null);
    } catch (err) {
      setToggleError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page wide>
      <PageHeader
        title="Staff"
        description={data ? `${counts.active} active staff, ${counts.teachers} teachers` : 'Teachers and office staff'}
        actions={
          <Button icon={<UserPlus className="h-4 w-4" aria-hidden />} onClick={() => setAdding(true)}>
            Add staff
          </Button>
        }
      />
      {flash.node}
      <Card padded={false}>
        <FilterBar>
          <label className="relative block sm:w-72">
            <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Search</span>
            <Search className="pointer-events-none absolute bottom-2.5 left-3 h-4 w-4 text-slate-400" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, email, designation"
              className="block h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-950"
            />
          </label>
          <Select label="Role" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
            <option value="">All roles</option>
            <option value="teacher">Teachers</option>
            <option value="branch_admin">Admins</option>
            <option value="super_admin">Owners</option>
          </Select>
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="">All</option>
          </Select>
        </FilterBar>
        {loading && !data ? (
          <Spinner label="Loading staff…" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : rows.length === 0 ? (
          <EmptyState title="No staff match" description="Try another search or status." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Role</Th>
                <Th>Designation</Th>
                <Th>Contact</Th>
                <Th>Class teacher of</Th>
                <Th>Joined</Th>
                <Th>Status</Th>
                <Th align="right">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className={s.status === 'inactive' ? 'opacity-70' : undefined}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <Avatar name={s.name} />
                      <div>
                        <p className="whitespace-nowrap font-medium">{s.name}</p>
                        <p className="text-xs tabular-nums text-slate-500 dark:text-slate-400">{s.employeeCode ?? '-'}</p>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <Badge tone={ROLE_BADGE[s.role].tone}>{ROLE_BADGE[s.role].label}</Badge>
                  </Td>
                  <Td className="whitespace-nowrap">
                    {s.designation ?? '-'}
                    {s.department && <span className="block text-xs text-slate-500 dark:text-slate-400">{s.department}</span>}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {s.email ? (
                      <a href={`mailto:${s.email}`} className="block text-sm hover:underline">
                        {s.email}
                      </a>
                    ) : null}
                    {s.phone && <PhoneLink phone={s.phone} className="text-xs" />}
                  </Td>
                  <Td>
                    {s.classTeacherOf.length ? (
                      <div className="flex flex-wrap gap-1">
                        {s.classTeacherOf.map((c) => (
                          <Badge key={c.sectionId} tone="indigo">
                            {c.label}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">{s.dateOfJoining ? formatDate(s.dateOfJoining) : '-'}</Td>
                  <Td>
                    <Badge tone={s.status === 'active' ? 'green' : 'gray'}>{s.status === 'active' ? 'Active' : 'Inactive'}</Badge>
                  </Td>
                  <Td align="right">
                    {s.userId !== me?.id && s.role !== 'super_admin' && (
                      <Button
                        size="sm"
                        variant={s.status === 'active' ? 'ghost' : 'secondary'}
                        onClick={() => {
                          setToggleError(null);
                          setToggle(s);
                        }}
                      >
                        {s.status === 'active' ? 'Deactivate' : 'Activate'}
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <AddStaffModal
        open={adding}
        canCreateAdmin={me?.role === 'super_admin'}
        onClose={() => setAdding(false)}
        onCreated={(s) => {
          setAdding(false);
          setData((prev) => (prev ? { data: [s, ...prev.data] } : prev));
          flash.show('success', `${s.name} added. They can sign in with ${s.email} and the password you set.`);
        }}
      />
      <ConfirmModal
        open={!!toggle}
        title={toggle?.status === 'active' ? 'Deactivate staff member?' : 'Activate staff member?'}
        confirmLabel={toggle?.status === 'active' ? 'Deactivate' : 'Activate'}
        tone={toggle?.status === 'active' ? 'danger' : 'primary'}
        busy={busy}
        error={toggleError}
        onConfirm={doToggle}
        onClose={() => setToggle(null)}
      >
        {toggle?.status === 'active' ? (
          <p>
            <strong>{toggle?.name}</strong> will be signed out and won&apos;t be able to sign in. Their attendance and marks records stay as they are.
          </p>
        ) : (
          <p>
            <strong>{toggle?.name}</strong> will be able to sign in again.
          </p>
        )}
      </ConfirmModal>
    </Page>
  );
}

interface StaffForm {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  designation: string;
  department: string;
  employeeCode: string;
  dateOfJoining: string;
  role: 'teacher' | 'branch_admin';
  password: string;
}
const EMPTY = (): StaffForm => ({ firstName: '', lastName: '', email: '', phone: '', designation: '', department: '', employeeCode: '', dateOfJoining: '', role: 'teacher', password: '' });

function AddStaffModal({ open, canCreateAdmin, onClose, onCreated }: { open: boolean; canCreateAdmin: boolean; onClose: () => void; onCreated: (s: StaffMember) => void }) {
  const [form, setForm] = useState<StaffForm>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setForm(EMPTY());
      setErrors({});
      setError(null);
    }
  }, [open]);
  const set = (k: keyof StaffForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (!form.firstName.trim()) e.firstName = 'Required';
    if (!form.lastName.trim()) e.lastName = 'Required';
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) e.email = 'Enter a valid email';
    if (!form.designation.trim()) e.designation = 'Required, e.g. TGT English';
    if (form.password.length < 10) e.password = 'At least 10 characters';
    setErrors(e);
    if (Object.keys(e).length) return;
    const opt = (v: string) => (v.trim() ? v.trim() : undefined);
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<Wrapped<StaffMember>>('POST', '/staff', {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: opt(form.phone),
        designation: form.designation.trim(),
        department: opt(form.department),
        employeeCode: opt(form.employeeCode),
        dateOfJoining: opt(form.dateOfJoining),
        role: form.role,
        password: form.password,
      });
      onCreated(res.data);
    } catch (err) {
      const fe = fieldErrors(err);
      if (errorCode(err) === 'CONFLICT') fe[/employee code/i.test(errorText(err)) ? 'employeeCode' : 'email'] = errorText(err);
      setErrors(fe);
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title="Add staff member"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="staff-form" loading={busy}>
            Add staff
          </Button>
        </>
      }
    >
      <form id="staff-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Input label="First name" value={form.firstName} onChange={set('firstName')} error={errors.firstName} required />
        <Input label="Last name" value={form.lastName} onChange={set('lastName')} error={errors.lastName} required />
        <Input label="Email (used to sign in)" type="email" value={form.email} onChange={set('email')} error={errors.email} autoComplete="off" required />
        <Input label="Mobile" type="tel" value={form.phone} onChange={set('phone')} error={errors.phone} placeholder="Optional" />
        <Select label="Role" value={form.role} onChange={set('role')} error={errors.role} hint={canCreateAdmin ? undefined : 'Branch admins can add teachers.'}>
          <option value="teacher">Teacher</option>
          {canCreateAdmin && <option value="branch_admin">Branch admin</option>}
        </Select>
        <Input label="Designation" value={form.designation} onChange={set('designation')} error={errors.designation} placeholder="e.g. TGT English" required />
        <Input label="Department" value={form.department} onChange={set('department')} error={errors.department} placeholder="e.g. Primary" />
        <Input label="Employee code" value={form.employeeCode} onChange={set('employeeCode')} error={errors.employeeCode} hint="Leave blank for the next code." />
        <Input label="Date of joining" type="date" value={form.dateOfJoining} onChange={set('dateOfJoining')} error={errors.dateOfJoining} />
        <Input label="Temporary password" type="password" value={form.password} onChange={set('password')} error={errors.password} autoComplete="new-password" hint="At least 10 characters. Share it privately." required />
        {error && (
          <div className="sm:col-span-2">
            <Notice tone="error">{error}</Notice>
          </div>
        )}
      </form>
    </Modal>
  );
}
