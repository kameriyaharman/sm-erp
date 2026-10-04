'use client';

import { Suspense, useEffect, useId, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, CircleAlert, Eye, EyeOff, KeyRound, LoaderCircle, LogOut } from 'lucide-react';
import { AuthError, changeOwnPassword, currentUser, getAccessToken, homeFor, logout, type SessionUser } from '@/lib/session';
import { takeTemporaryPassword } from '@/lib/pending-password';
import { controlClass, cx } from '@/components/ui';

/**
 * "Set your password": shown after signing in with a temporary password from the school office
 * (the API refuses everything else until this is done), and usable any time to change one's own
 * password. Rules mirror the API (api/src/modules/auth/login-id.js).
 */
export default function SetPasswordPage() {
  return (
    <Suspense>
      <SetPassword />
    </Suspense>
  );
}

function rules(pw: string) {
  return [
    { ok: pw.length >= 8, text: 'At least 8 characters' },
    { ok: /[A-Za-z]/.test(pw) && /\d/.test(pw), text: 'Letters and at least one number' },
  ];
}

function SetPassword() {
  const router = useRouter();
  const params = useSearchParams();
  const ids = { current: useId(), next: useId(), confirm: useId(), rules: useId(), error: useId() };
  const [user, setUser] = useState<SessionUser | null>(null);
  const [remembered, setRemembered] = useState<string | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const temp = takeTemporaryPassword();
    if (temp) setRemembered(temp);
    getAccessToken().then((token) => {
      const me = token ? currentUser() : null;
      if (!me) router.replace('/login');
      else setUser(me);
    });
  }, [router]);

  const forced = Boolean(user?.mustChangePassword);
  const destination = (u: SessionUser) => {
    const n = params.get('next');
    return n && n.startsWith('/') && !n.startsWith('//') && n !== '/set-password' ? n : homeFor(u.role);
  };

  const checks = rules(next);
  const mismatch = confirm.length > 0 && confirm !== next;
  const ready = checks.every((c) => c.ok) && confirm === next && (remembered || current);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await changeOwnPassword(remembered ?? current, next);
      router.replace(destination(updated));
    } catch (err) {
      const code = err instanceof AuthError ? err.code : '';
      if (code === 'CURRENT_PASSWORD_WRONG') {
        // The remembered temporary password can't be wrong, but a typed one can.
        setRemembered(null);
        setError(forced ? 'The temporary password is not correct. Type it exactly as on your login slip.' : 'Your current password is not correct.');
      } else {
        setError(err instanceof Error ? err.message : 'Could not change the password.');
      }
      setBusy(false);
    }
  }

  if (!user) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface" role="status" aria-live="polite">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-100 border-t-indigo-600 dark:border-white/10 dark:border-t-indigo-300" />
        <span className="sr-only">Loading…</span>
      </div>
    );
  }

  const input = cx(controlClass, 'h-11 px-3.5 text-[15px] sm:h-11');
  const label = 'mb-1.5 block text-13 font-medium text-slate-700 dark:text-slate-300';

  return (
    <main className="flex min-h-dvh flex-col bg-canvas px-4 py-8 sm:px-6">
      <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center">
        <div className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200">
            <KeyRound className="h-5 w-5" aria-hidden />
          </span>
          <h1 className="mt-4 text-xl font-semibold text-slate-900 dark:text-white">{forced ? 'Set your password' : 'Change your password'}</h1>
          <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
            {forced
              ? `Welcome${user.firstName ? `, ${user.firstName}` : ''}. You signed in with a temporary password from the school office. Choose your own password to continue.`
              : 'Choose a new password. You will stay signed in here; other devices are signed out.'}
          </p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate aria-describedby={error ? ids.error : undefined}>
            {!remembered && (
              <div>
                <label htmlFor={ids.current} className={label}>
                  {forced ? 'Temporary password (from your login slip)' : 'Current password'}
                </label>
                <input
                  id={ids.current}
                  className={input}
                  type={show ? 'text' : 'password'}
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  autoComplete="current-password"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                />
              </div>
            )}
            <div>
              <label htmlFor={ids.next} className={label}>
                New password
              </label>
              <div className="relative">
                <input
                  id={ids.next}
                  className={`${input} pr-11`}
                  type={show ? 'text' : 'password'}
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  autoComplete="new-password"
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-describedby={ids.rules}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  aria-label={show ? 'Hide passwords' : 'Show passwords'}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                >
                  {show ? <EyeOff className="h-[18px] w-[18px]" aria-hidden /> : <Eye className="h-[18px] w-[18px]" aria-hidden />}
                </button>
              </div>
              <ul id={ids.rules} className="mt-2 space-y-1">
                {checks.map((c) => (
                  <li key={c.text} className={cx('flex items-center gap-1.5 text-xs', c.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400')}>
                    <span className={cx('flex h-3.5 w-3.5 items-center justify-center rounded-full', c.ok ? 'bg-emerald-100 dark:bg-emerald-400/15' : 'bg-slate-100 dark:bg-white/[0.06]')}>
                      {c.ok && <Check className="h-2.5 w-2.5" aria-hidden />}
                    </span>
                    {c.text}
                    <span className="sr-only">{c.ok ? ' (done)' : ' (not yet)'}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <label htmlFor={ids.confirm} className={label}>
                Type it again
              </label>
              <input
                id={ids.confirm}
                className={cx(input, mismatch && 'border-red-500 focus:border-red-500 focus:ring-red-500/20')}
                type={show ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={mismatch || undefined}
                required
              />
              {mismatch && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">The two passwords are not the same.</p>}
            </div>

            {error && (
              <p id={ids.error} role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800 dark:border-red-400/25 dark:bg-red-400/10 dark:text-red-200">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || !ready}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 text-[15px] font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300 dark:bg-indigo-500 dark:hover:bg-indigo-400 dark:disabled:bg-indigo-900 dark:disabled:text-indigo-300"
            >
              {busy && <LoaderCircle className="h-[18px] w-[18px] animate-spin" aria-hidden />}
              {busy ? 'Saving…' : forced ? 'Set password and continue' : 'Change password'}
            </button>
          </form>
        </div>

        <button
          type="button"
          onClick={async () => {
            await logout();
            router.replace('/login');
          }}
          className="mx-auto mt-5 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-13 font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden /> Sign out
        </button>
      </div>
    </main>
  );
}
