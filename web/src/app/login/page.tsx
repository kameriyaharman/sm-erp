'use client';

import { Suspense, useEffect, useId, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CircleAlert, Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { AuthError, getAccessToken, currentUser, homeFor, login } from '@/lib/session';
import { controlClass, cx } from '@/components/ui';

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const ids = { school: useId(), user: useId(), pass: useId(), error: useId(), remember: useId() };
  const [tenantCode, setTenantCode] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already signed in (e.g. refresh cookie still valid)? Go straight in.
  useEffect(() => {
    getAccessToken().then((token) => {
      const user = token ? currentUser() : null;
      if (user) router.replace(safeNext(params.get('next')) ?? homeFor(user.role));
    });
    try {
      const last = localStorage.getItem('sm_last_school');
      if (last) setTenantCode(last);
    } catch {
      /* ignore */
    }
  }, [params, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const user = await login({ tenantCode, identifier, password });
      try {
        if (remember) localStorage.setItem('sm_last_school', tenantCode.trim().toLowerCase());
        else localStorage.removeItem('sm_last_school');
      } catch {
        /* ignore */
      }
      router.replace(safeNext(params.get('next')) ?? homeFor(user.role));
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Sign-in failed. Please try again.');
      setBusy(false);
    }
  }

  const input = cx(controlClass, 'h-11 px-3.5 text-[15px] sm:h-11');
  const label = 'mb-1.5 block text-13 font-medium text-slate-700 dark:text-slate-300';

  return (
    <main className="grid min-h-dvh bg-surface lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* Brand panel */}
      <section className="relative hidden overflow-hidden bg-ink-950 px-12 py-10 text-white lg:flex lg:flex-col lg:justify-between xl:px-16">
        <Wordmark />
        <div className="relative max-w-lg">
          <RegisterIllustration />
          <h1 className="mt-12 text-3xl font-semibold leading-[1.15] tracking-tight xl:text-[34px]">The school office, in one calm place.</h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-ink-text">
            Fee collection and receipts, daily attendance with SMS to parents, marks and report cards, certificates and the school bus. Built for how Indian schools work.
          </p>
        </div>
        <p className="text-13 text-ink-muted">© {new Date().getFullYear()} SM ERP</p>
      </section>

      {/* Form */}
      <section className="flex flex-col px-5 py-8 sm:px-10">
        <div className="lg:hidden">
          <Wordmark dark />
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[380px]">
            <h2 className="text-2xl font-semibold text-slate-900 dark:text-white">Sign in to your school</h2>
            <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">Use the school code and login your school gave you.</p>

            <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate aria-describedby={error ? ids.error : undefined}>
              <div>
                <label htmlFor={ids.school} className={label}>
                  School code
                </label>
                <input
                  id={ids.school}
                  className={input}
                  value={tenantCode}
                  onChange={(e) => setTenantCode(e.target.value)}
                  autoCapitalize="none"
                  autoComplete="organization"
                  placeholder="e.g. demo"
                  required
                  spellCheck={false}
                />
              </div>
              <div>
                <label htmlFor={ids.user} className={label}>
                  Email or username
                </label>
                <input
                  id={ids.user}
                  className={input}
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  autoCapitalize="none"
                  autoComplete="username"
                  inputMode="email"
                  placeholder="you@school.in"
                  required
                  spellCheck={false}
                />
              </div>
              <div>
                <label htmlFor={ids.pass} className={label}>
                  Password
                </label>
                <div className="relative">
                  <input
                    id={ids.pass}
                    className={`${input} pr-11`}
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  >
                    {showPassword ? <EyeOff className="h-[18px] w-[18px]" aria-hidden /> : <Eye className="h-[18px] w-[18px]" aria-hidden />}
                  </button>
                </div>
              </div>

              <label htmlFor={ids.remember} className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-600 dark:text-slate-300">
                <input
                  id={ids.remember}
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="h-4 w-4 rounded border-line-strong text-indigo-600 accent-indigo-600"
                />
                Remember this school on this device
              </label>

              {error && (
                <p id={ids.error} role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800 dark:border-red-400/25 dark:bg-red-400/10 dark:text-red-200">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={busy || !identifier || !password}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 text-[15px] font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300 dark:bg-indigo-500 dark:hover:bg-indigo-400 dark:disabled:bg-indigo-900 dark:disabled:text-indigo-300"
              >
                {busy && <LoaderCircle className="h-[18px] w-[18px] animate-spin" aria-hidden />}
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>

            <p className="mt-6 rounded-lg border border-dashed border-line-strong px-3.5 py-2.5 text-13 text-slate-500 dark:text-slate-400">
              Trying it out? Use school code{' '}
              <button type="button" onClick={() => setTenantCode('demo')} className="rounded font-semibold text-indigo-700 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-800 dark:text-indigo-300">
                demo
              </button>
              .
            </p>
          </div>
        </div>
        <p className="text-center text-xs text-slate-400 lg:hidden">© {new Date().getFullYear()} SM ERP</p>
      </section>
    </main>
  );
}

function Wordmark({ dark = false }: { dark?: boolean }) {
  return (
    <div className="relative flex items-center gap-3">
      <span className={cx('relative flex h-9 w-9 items-center justify-center rounded-lg text-[13px] font-semibold tracking-tight', dark ? 'bg-ink-950 text-white' : 'bg-ink-800 text-white ring-1 ring-inset ring-white/10')}>
        SM
        <span aria-hidden className="absolute inset-x-2 bottom-1 h-[2px] rounded-full bg-marigold-400" />
      </span>
      <span className={cx('text-lg font-semibold tracking-tight', dark ? 'text-slate-900 dark:text-white' : 'text-white')}>SM ERP</span>
    </div>
  );
}

/**
 * Abstract attendance register: rows of students, columns of school days, with today's
 * column picked out in marigold. Pure SVG, deterministic.
 */
function RegisterIllustration() {
  const rows = 9;
  const cols = 14;
  const today = 10;
  const cell = 22;
  const gap = 6;
  const left = 96;
  const top = 34;
  const absent = (r: number, c: number) => (r * 7 + c * 3) % 23 === 0 || (r === 4 && c === 6);
  const width = left + cols * (cell + gap);
  const height = top + rows * (cell + gap) + 4;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full max-w-[460px]" role="img" aria-label="An attendance register with today's column highlighted">
      {/* today column */}
      <rect x={left + today * (cell + gap) - 4} y={4} width={cell + 8} height={height - 6} rx={8} fill="#F5B544" fillOpacity={0.14} stroke="#F5B544" strokeOpacity={0.55} />
      <text x={left + today * (cell + gap) + cell / 2} y={22} textAnchor="middle" fontSize={9.5} fontWeight={600} fill="#F8CB79">
        Today
      </text>
      {Array.from({ length: cols }, (_, c) =>
        c === today ? null : (
          <text key={c} x={left + c * (cell + gap) + cell / 2} y={22} textAnchor="middle" fontSize={10} fill="#8392B3">
            {c + 1}
          </text>
        ),
      )}
      {Array.from({ length: rows }, (_, r) => {
        const y = top + r * (cell + gap);
        return (
          <g key={r}>
            <rect x={0} y={y + 7} width={52 + ((r * 13) % 30)} height={8} rx={4} fill="#1E3260" />
            {Array.from({ length: cols }, (_, c) => {
              const x = left + c * (cell + gap);
              const isToday = c === today;
              const future = c > today;
              if (future) return <rect key={c} x={x} y={y} width={cell} height={cell} rx={6} fill="none" stroke="#1E3260" />;
              if (isToday && r > 5) return <rect key={c} x={x} y={y} width={cell} height={cell} rx={6} fill="none" stroke="#F5B544" strokeOpacity={0.6} strokeDasharray="3 3" />;
              const a = absent(r, c);
              return (
                <g key={c}>
                  <rect x={x} y={y} width={cell} height={cell} rx={6} fill={a ? '#C8322D' : isToday ? '#F5B544' : '#2A3F72'} fillOpacity={a ? 0.85 : 1} />
                  {!a && <path d={`M${x + 7} ${y + 11.5} l3 3 l6 -6.5`} fill="none" stroke={isToday ? '#0E1A33' : '#8FA2F1'} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />}
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

/** Only same-site relative paths, never "//evil.com". */
function safeNext(next: string | null): string | null {
  return next && next.startsWith('/') && !next.startsWith('//') && next !== '/login' ? next : null;
}
