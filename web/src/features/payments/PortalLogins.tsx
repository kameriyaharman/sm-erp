'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, KeyRound, Printer, Smartphone, Users, UserRoundCheck } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, Notice, Page, PageHeader, Pagination, SearchInput, Select, Spinner, Table, Tabs, Td, Th, cx } from '@/components/ui';
import { qs, useApi } from '@/lib/useApi';
import { apiSend, currentUser } from '@/lib/session';
import { FilterBar, errorText, fieldErrors, useClasses, useDebounced, useFlash } from '@/features/admin/shared';
import { CopyButton, CopyField, LOGIN_STATUS_LABEL, LoginStatusBadge, ago } from './bits';
import LoginSlips from './LoginSlips';
import type { BulkResult, LoginSlip, LoginStatus, PortalMeta, PortalRow, ResetResult } from './types';

type Kind = 'parent' | 'student';
const STATUSES: LoginStatus[] = ['none', 'temporary', 'active', 'locked', 'inactive'];

/**
 * Settings -> Portal logins: who can sign in to the family portal (parents with their mobile
 * number, students with their admission number), and temporary passwords for them.
 */
export default function PortalLogins() {
  const [kind, setKind] = useState<Kind>('parent');
  const [search, setSearch] = useState('');
  const [classId, setClassId] = useState('');
  const [status, setStatus] = useState<LoginStatus | ''>('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search.trim(), 300);
  useEffect(() => setPage(1), [kind, q, classId, status]);
  const { classes } = useClasses();
  const flash = useFlash(10000);

  const list = useApi<{ data: PortalRow[]; meta: PortalMeta }>(`/portal-access${qs({ type: kind, search: q, classId, status, page, limit: 25 })}`);
  const rows = list.data?.data ?? [];
  const meta = list.data?.meta;
  const schoolCode = meta?.schoolCode ?? '';
  const schoolName = meta?.schoolName ?? currentUser()?.schoolName ?? 'School';

  const [resetFor, setResetFor] = useState<PortalRow | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [slips, setSlips] = useState<{ slips: LoginSlip[]; title: string; portalUrl: string; schoolCode: string } | null>(null);

  const loginUrl = typeof window !== 'undefined' ? `${window.location.origin}/login` : '/login';
  const total = meta ? Object.values(meta.counts).reduce((a, b) => a + b, 0) : 0;

  return (
    <Page wide>
      <PageHeader
        title="Portal logins"
        breadcrumb={
          <Link href="/settings" className="inline-flex items-center gap-1 hover:text-slate-800 dark:hover:text-slate-200">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Settings
          </Link>
        }
        description="Parents sign in with their mobile number, students with their admission number. Give them a temporary password; they choose their own at first sign-in."
        actions={
          <Button icon={<Printer aria-hidden />} onClick={() => setBulkOpen(true)}>
            Logins for a class
          </Button>
        }
      />
      {flash.node}

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <HowItWorks icon={<Smartphone aria-hidden />} title="Parents" text="Mobile number (any format: 98100 55555, +91…) or email." />
        <HowItWorks icon={<UserRoundCheck aria-hidden />} title="Students" text="Admission number, e.g. DPS-1001 (capital or small letters)." />
        <HowItWorks icon={<KeyRound aria-hidden />} title={`School code: ${schoolCode || '…'}`} text={`Sign in at ${loginUrl.replace(/^https?:\/\//, '')}`} />
      </div>

      <Tabs
        value={kind}
        onChange={(v) => {
          setKind(v);
          setStatus('');
        }}
        items={[
          { value: 'parent', label: 'Parents' },
          { value: 'student', label: 'Students' },
        ]}
      />

      <Card padded={false}>
        <FilterBar>
          <SearchInput
            label="Search"
            showLabel
            placeholder={kind === 'parent' ? 'Name, mobile, email or child' : 'Name or admission no.'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            containerClassName="sm:!min-w-[16rem]"
          />
          <Select label="Class" value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select label="Login" value={status} onChange={(e) => setStatus(e.target.value as LoginStatus | '')}>
            <option value="">Everyone{meta ? ` (${total})` : ''}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {LOGIN_STATUS_LABEL[s]}
                {meta ? ` (${meta.counts[s]})` : ''}
              </option>
            ))}
          </Select>
        </FilterBar>

        {list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : list.loading && !list.data ? (
          <Spinner skeleton label="Loading" />
        ) : rows.length === 0 ? (
          <EmptyState icon={<Users aria-hidden />} title="Nobody matches" description="Change the search or filters." />
        ) : (
          <>
            <ul className="divide-y divide-line sm:hidden">
              {rows.map((r) => (
                <li key={r.userId} className="flex items-start justify-between gap-3 px-4 py-3.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{r.name}</p>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">{subLine(r)}</p>
                    <p className="mt-1 truncate font-mono text-xs text-slate-700 dark:text-slate-300">{r.loginId ?? '-'}</p>
                    <div className="mt-1.5">
                      <LoginStatusBadge status={r.status} />
                    </div>
                  </div>
                  <Button size="sm" variant="secondary" disabled={r.status === 'inactive'} onClick={() => setResetFor(r)}>
                    {r.status === 'none' ? 'Give login' : 'Reset'}
                  </Button>
                </li>
              ))}
            </ul>
            <Table className="hidden sm:block">
              <thead>
                <tr>
                  <Th>{kind === 'parent' ? 'Parent' : 'Student'}</Th>
                  <Th>{kind === 'parent' ? 'Children' : 'Class'}</Th>
                  <Th>Login</Th>
                  <Th>Status</Th>
                  <Th className="hidden md:table-cell">Last sign-in</Th>
                  <Th align="right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.userId}>
                    <Td>
                      <span className="font-medium text-slate-900 dark:text-white">{r.name}</span>
                      {kind === 'parent' && r.email && r.loginId !== r.email && <span className="block text-xs text-slate-500 dark:text-slate-400">{r.email}</span>}
                    </Td>
                    <Td className="text-13 text-slate-600 dark:text-slate-300">{subLine(r)}</Td>
                    <Td className="font-mono text-13">{r.loginId ?? '-'}</Td>
                    <Td>
                      <LoginStatusBadge status={r.status} />
                    </Td>
                    <Td className="hidden whitespace-nowrap text-13 text-slate-500 dark:text-slate-400 md:table-cell">{ago(r.lastLoginAt)}</Td>
                    <Td align="right">
                      <Button size="sm" variant="secondary" disabled={r.status === 'inactive'} onClick={() => setResetFor(r)}>
                        {r.status === 'none' ? 'Give login' : 'Reset password'}
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} totalPages={meta?.totalPages ?? 1} onChange={setPage} />
          </>
        )}
      </Card>

      {resetFor && (
        <ResetModal
          row={resetFor}
          schoolName={schoolName}
          onClose={() => setResetFor(null)}
          onDone={() => list.reload()}
          onPrint={(r) => setSlips({ slips: [r.slip], title: r.slip.name, portalUrl: r.portalUrl, schoolCode: r.schoolCode })}
        />
      )}
      {bulkOpen && (
        <BulkModal
          kind={kind}
          classes={classes}
          onClose={() => setBulkOpen(false)}
          onDone={(r) => {
            setBulkOpen(false);
            list.reload();
            if (r.issued === 0) {
              flash.show('info', `Everyone in ${r.classLabel} already has a login (${r.skipped}). Use "Reset password" for someone who forgot theirs.`);
              return;
            }
            flash.show('success', `${r.issued} login${r.issued === 1 ? '' : 's'} created for ${r.classLabel}${r.skipped ? `; ${r.skipped} already had one` : ''}. Print the slips now.`);
            setSlips({ slips: r.slips, title: `${r.classLabel} ${kind === 'parent' ? 'parents' : 'students'}`, portalUrl: r.portalUrl, schoolCode: r.schoolCode });
          }}
        />
      )}
      {slips && <LoginSlips {...slips} schoolName={schoolName} onClose={() => setSlips(null)} />}
    </Page>
  );
}

function subLine(r: PortalRow): string {
  if (r.type === 'student') return r.student?.classLabel ?? '';
  return (r.children ?? []).map((c) => `${c.name.split(' ')[0]} (${c.classLabel})`).join(', ');
}

function HowItWorks({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line bg-surface p-3.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{title}</p>
        <p className="text-13 text-slate-500 dark:text-slate-400">{text}</p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ reset one

function ResetModal({ row, schoolName, onClose, onDone, onPrint }: { row: PortalRow; schoolName: string; onClose: () => void; onDone: () => void; onPrint: (r: ResetResult) => void }) {
  const [how, setHow] = useState<'generate' | 'type'>('generate');
  const [password, setPassword] = useState('');
  const [mustChange, setMustChange] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResetResult | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await apiSend<{ data: ResetResult }>('POST', `/portal-access/${row.userId}/reset`, how === 'type' ? { password, mustChange } : {});
      setResult(r.data);
      onDone();
    } catch (err) {
      setError(fieldErrors(err).password ?? errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const shareText = result
    ? [`${schoolName}: family portal login for ${result.slip.name}`, `Open: ${result.portalUrl}`, `School code: ${result.schoolCode}`, `Login: ${result.slip.loginId}`, `Temporary password: ${result.slip.password}`, 'You will set your own password after signing in.'].join('\n')
    : '';

  if (result) {
    return (
      <Modal
        open
        title={`Login ready for ${result.slip.name}`}
        description={result.slip.password ? 'Shown only this once. Give it to them, print a slip, or copy the message.' : 'The password you typed is now active.'}
        onClose={onClose}
        size="sm"
        footer={
          <>
            {result.slip.password && (
              <Button variant="secondary" icon={<Printer aria-hidden />} onClick={() => onPrint(result)}>
                Print login slip
              </Button>
            )}
            <Button onClick={onClose}>Done</Button>
          </>
        }
      >
        <dl className="flex flex-col gap-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-13 text-slate-500 dark:text-slate-400">School code</dt>
              <dd className="mt-0.5 font-mono font-semibold">{result.schoolCode}</dd>
            </div>
            <div>
              <dt className="text-13 text-slate-500 dark:text-slate-400">Login</dt>
              <dd className="mt-0.5 break-all font-mono font-semibold">{result.slip.loginId}</dd>
            </div>
          </div>
          {result.slip.password && (
            <div>
              <dt className="mb-1 text-13 text-slate-500 dark:text-slate-400">Temporary password</dt>
              <dd>
                <CopyField value={result.slip.password} label="Temporary password" large />
              </dd>
            </div>
          )}
          {result.slip.alsoWorks.length > 0 && <p className="text-xs text-slate-500 dark:text-slate-400">Also works as login: {result.slip.alsoWorks.join(', ')}</p>}
        </dl>
        {result.slip.password && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-surface-muted px-3 py-2.5 text-13 text-slate-600 dark:text-slate-300">
            <span>Send it on WhatsApp or SMS yourself:</span>
            <CopyButton text={shareText} label="Copy message" />
          </div>
        )}
        {result.mustChangePassword && <p className="mt-3 text-13 text-slate-500 dark:text-slate-400">They will be asked to choose their own password at first sign-in. Their other sessions were signed out.</p>}
      </Modal>
    );
  }

  return (
    <Modal
      open
      title={row.status === 'none' ? `Give ${row.name} a login` : `Reset password for ${row.name}`}
      description={`Login: ${row.loginId ?? '-'}`}
      onClose={busy ? () => undefined : onClose}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button loading={busy} onClick={submit} disabled={how === 'type' && password.length < 8}>
            {how === 'generate' ? 'Create password' : 'Set password'}
          </Button>
        </>
      }
    >
      <fieldset className="flex flex-col gap-2.5">
        <legend className="sr-only">Password</legend>
        <Choice checked={how === 'generate'} onChange={() => setHow('generate')} title="Create a temporary password (recommended)" text="A random password is shown once. They choose their own at first sign-in." />
        <Choice checked={how === 'type'} onChange={() => setHow('type')} title="Type a password" text="For example when the parent is at the office and picks one." />
      </fieldset>
      {how === 'type' && (
        <div className="mt-3 flex flex-col gap-3 pl-7">
          <Input label="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" hint="At least 8 characters, letters and a number." />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} className="h-4 w-4 accent-indigo-600" />
            Ask them to change it at first sign-in
          </label>
        </div>
      )}
      {row.status !== 'none' && <p className="mt-4 text-13 text-slate-500 dark:text-slate-400">Their current password stops working and they are signed out everywhere.</p>}
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </Modal>
  );
}

function Choice({ checked, onChange, title, text }: { checked: boolean; onChange: () => void; title: string; text: string }) {
  return (
    <label className={cx('flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors', checked ? 'border-indigo-400 bg-indigo-50/60 dark:border-indigo-400/50 dark:bg-indigo-500/10' : 'border-line hover:bg-slate-50 dark:hover:bg-white/[0.03]')}>
      <input type="radio" checked={checked} onChange={onChange} className="mt-0.5 h-4 w-4 accent-indigo-600" />
      <span>
        <span className="block text-sm font-medium text-slate-900 dark:text-white">{title}</span>
        <span className="block text-13 text-slate-500 dark:text-slate-400">{text}</span>
      </span>
    </label>
  );
}

// ------------------------------------------------------------------ bulk for a class

function BulkModal({
  kind,
  classes,
  onClose,
  onDone,
}: {
  kind: Kind;
  classes: Array<{ id: string; name: string; sections: Array<{ id: string; name: string }> }>;
  onClose: () => void;
  onDone: (r: BulkResult) => void;
}) {
  const [type, setType] = useState<Kind>(kind);
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [onlyNew, setOnlyNew] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sections = useMemo(() => classes.find((c) => c.id === classId)?.sections ?? [], [classes, classId]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await apiSend<{ data: BulkResult }>('POST', '/portal-access/bulk', { type, classId, ...(sectionId && { sectionId }), onlyWithoutLogin: onlyNew });
      onDone(r.data);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="Logins for a whole class"
      description="Creates temporary passwords and opens printable slips to hand out."
      onClose={busy ? () => undefined : onClose}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button loading={busy} disabled={!classId} onClick={submit} icon={<Printer aria-hidden />}>
            Create and print slips
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="For">
          {(['parent', 'student'] as Kind[]).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={type === k}
              onClick={() => setType(k)}
              className={cx('h-10 rounded-lg border text-sm font-medium transition-colors', type === k ? 'border-indigo-500 bg-indigo-50 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-100' : 'border-line text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-white/[0.03]')}
            >
              {k === 'parent' ? 'Parents' : 'Students'}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Select label="Class" value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId(''); }}>
            <option value="">Choose</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} disabled={!classId}>
            <option value="">All sections</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} className="mt-0.5 h-4 w-4 accent-indigo-600" />
          <span>
            Only those without a login <Badge tone="green">Recommended</Badge>
            <span className="block text-13 text-slate-500 dark:text-slate-400">Unticked, everyone gets a new password and current passwords stop working.</span>
          </span>
        </label>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}

