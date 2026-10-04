'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Check, Eye, EyeOff, KeyRound, UserRound, X } from 'lucide-react';
import { Badge, Button, Card, cx, ErrorState, Input, Notice, Page, PageHeader, Spinner } from '@/components/ui';
import { useApi } from '@/lib/useApi';
import { apiSend, refresh, ROLE_LABEL, updateSessionUser, type Role } from '@/lib/session';
import { formatDateTime } from '@/lib/format';
import { errorText, fieldErrors, useFlash } from '@/features/admin/shared';
import { displayPhone, mobileError } from './india';

interface Me {
  id: string;
  role: Role;
  firstName: string;
  lastName: string | null;
  email: string | null;
  username: string | null;
  phone: string | null;
  schoolName: string | null;
  branchName: string | null;
  staff: { employeeCode: string; designation: string | null; department: string | null } | null;
  lastLoginAt: string | null;
  passwordChangedAt: string | null;
}

export default function AccountPage() {
  const { data, error, loading, reload, setData } = useApi<{ data: Me }>('/me');
  const flash = useFlash();
  const me = data?.data;

  if (loading && !me) return <Spinner label="Loading your account…" />;
  if (error || !me) return <ErrorState message={error ?? 'Could not load your account'} onRetry={reload} />;

  return (
    <Page>
      <PageHeader title="My account" description="Your name, mobile number and password." />
      {flash.node}
      <div className="grid gap-5 lg:grid-cols-2">
        <ProfileCard me={me} onSaved={(m) => { setData({ data: m }); flash.show('success', 'Your details are saved.'); }} />
        <PasswordCard me={me} onChanged={(ended) => {
          flash.show('success', `Password changed.${ended > 0 ? ' You have been signed out on your other devices.' : ''}`);
          reload();
        }} />
      </div>
    </Page>
  );
}

function ProfileCard({ me, onSaved }: { me: Me; onSaved: (m: Me) => void }) {
  const [firstName, setFirstName] = useState(me.firstName);
  const [lastName, setLastName] = useState(me.lastName ?? '');
  const [phone, setPhone] = useState(displayPhone(me.phone));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setFirstName(me.firstName);
    setLastName(me.lastName ?? '');
    setPhone(displayPhone(me.phone));
  }, [me]);
  const dirty = firstName !== me.firstName || lastName !== (me.lastName ?? '') || phone !== displayPhone(me.phone);

  async function save(ev: FormEvent) {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (!firstName.trim()) e.firstName = 'Enter your first name';
    const m = mobileError(phone);
    if (m) e.phone = m;
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<{ data: Me }>('PATCH', '/me', { firstName: firstName.trim(), lastName: lastName.trim() || null, phone: phone.trim() || null });
      updateSessionUser({ firstName: res.data.firstName, lastName: res.data.lastName });
      onSaved(res.data);
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={<span className="flex items-center gap-2"><UserRound className="h-4 w-4 text-slate-400" aria-hidden />Profile</span>}>
      <form onSubmit={save} noValidate className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-13 text-slate-500 dark:text-slate-400">
          <Badge tone="indigo">{ROLE_LABEL[me.role]}</Badge>
          {me.staff?.designation && <span>{me.staff.designation}</span>}
          {me.staff?.employeeCode && <span className="tabular-nums">· {me.staff.employeeCode}</span>}
          {me.schoolName && <span>· {[me.schoolName, me.branchName].filter(Boolean).join(', ')}</span>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} error={errors.firstName} autoComplete="given-name" />
          <Input label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} error={errors.lastName} autoComplete="family-name" />
          <Input label="Mobile" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} error={errors.phone} autoComplete="tel" />
          <Input label="Sign-in email" value={me.email ?? me.username ?? ''} disabled hint="Ask the school office to change it" />
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-13 text-slate-500 dark:text-slate-400">{me.lastLoginAt ? `Last sign-in ${formatDateTime(me.lastLoginAt)}` : ''}</p>
          <Button type="submit" loading={busy} disabled={!dirty}>
            Save details
          </Button>
        </div>
      </form>
    </Card>
  );
}

const RULES: Array<{ label: string; test: (p: string) => boolean }> = [
  { label: 'At least 10 characters', test: (p) => p.length >= 10 },
  { label: 'Letters and numbers', test: (p) => /[A-Za-z]/.test(p) && /\d/.test(p) },
];

function PasswordCard({ me, onChanged }: { me: Me; onChanged: (endedSessions: number) => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (!current) e.currentPassword = 'Enter your current password';
    if (!RULES.every((r) => r.test(next))) e.newPassword = 'Use at least 10 characters with letters and numbers';
    else if (next === current) e.newPassword = 'The new password must be different from the current one';
    if (confirm !== next) e.confirm = 'The two new passwords do not match';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<{ data: { endedSessions: number } }>('POST', '/me/password', { currentPassword: current, newPassword: next });
      // The response set a new session cookie; swap this tab's (now void) access token for a fresh one.
      await refresh();
      setCurrent('');
      setNext('');
      setConfirm('');
      onChanged(Math.max(0, (res.data.endedSessions ?? 1) - 1));
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const type = show ? 'text' : 'password';
  return (
    <Card
      title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-slate-400" aria-hidden />Change password</span>}
      description={me.passwordChangedAt ? `Last changed ${formatDateTime(me.passwordChangedAt)}` : 'Signs you out everywhere else.'}
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <Input label="Current password" type={type} value={current} onChange={(e) => setCurrent(e.target.value)} error={errors.currentPassword} autoComplete="current-password" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="New password" type={type} value={next} onChange={(e) => setNext(e.target.value)} error={errors.newPassword} autoComplete="new-password" />
          <Input label="Repeat new password" type={type} value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} autoComplete="new-password" />
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-13">
          {RULES.map((r) => {
            const ok = r.test(next);
            return (
              <li key={r.label} className={cx('flex items-center gap-1', ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400')}>
                {ok ? <Check className="h-3.5 w-3.5" aria-hidden /> : <X className="h-3.5 w-3.5" aria-hidden />}
                {r.label}
              </li>
            );
          })}
        </ul>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={() => setShow((s) => !s)} className="inline-flex items-center gap-1.5 text-13 font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white">
            {show ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
            {show ? 'Hide passwords' : 'Show passwords'}
          </button>
          <Button type="submit" loading={busy}>
            Change password
          </Button>
        </div>
      </form>
    </Card>
  );
}
