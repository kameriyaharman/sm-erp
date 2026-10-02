'use client';

import { Suspense, useEffect, useId, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, GraduationCap, LoaderCircle, LockKeyhole } from 'lucide-react';
import { AuthError, getAccessToken, currentUser, homeFor, login } from '@/lib/session';

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
  const ids = { school: useId(), user: useId(), pass: useId(), error: useId() };
  const [tenantCode, setTenantCode] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
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
        localStorage.setItem('sm_last_school', tenantCode.trim().toLowerCase());
      } catch {
        /* ignore */
      }
      router.replace(safeNext(params.get('next')) ?? homeFor(user.role));
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Sign-in failed. Please try again.');
      setBusy(false);
    }
  }

  const input =
    'block h-11 w-full rounded-lg border border-slate-300 bg-white px-3.5 text-[15px] text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-white';

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <section className="relative hidden overflow-hidden bg-indigo-700 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-indigo-500/40 blur-3xl" />
        <div aria-hidden className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-violet-500/30 blur-3xl" />
        <div className="relative flex items-center gap-3 text-lg font-semibold">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
            <GraduationCap className="h-5 w-5" aria-hidden />
          </span>
          SM ERP
        </div>
        <div className="relative max-w-md">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">Run every campus from one place.</h1>
          <p className="mt-4 text-base leading-relaxed text-indigo-100">
            Fee collection, attendance with instant parent alerts, report cards and certificates, for school offices, teachers and parents.
          </p>
        </div>
        <p className="relative text-sm text-indigo-200">© {new Date().getFullYear()} SM ERP</p>
      </section>

      {/* Form */}
      <section className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 font-semibold lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <GraduationCap className="h-5 w-5" aria-hidden />
            </span>
            SM ERP
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">Use the school code and login your school gave you.</p>

          <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate aria-describedby={error ? ids.error : undefined}>
            <div>
              <label htmlFor={ids.school} className="mb-1.5 block text-sm font-medium">School code</label>
              <input id={ids.school} className={input} value={tenantCode} onChange={(e) => setTenantCode(e.target.value)} autoCapitalize="none"
                autoComplete="organization" placeholder="e.g. demo" required spellCheck={false} />
            </div>
            <div>
              <label htmlFor={ids.user} className="mb-1.5 block text-sm font-medium">Email or username</label>
              <input id={ids.user} className={input} value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoCapitalize="none"
                autoComplete="username" inputMode="email" placeholder="you@school.in" required spellCheck={false} />
            </div>
            <div>
              <label htmlFor={ids.pass} className="mb-1.5 block text-sm font-medium">Password</label>
              <div className="relative">
                <input id={ids.pass} className={`${input} pr-11`} type={showPassword ? 'text' : 'password'} value={password}
                  onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
                <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
                  {showPassword ? <EyeOff className="h-[18px] w-[18px]" aria-hidden /> : <Eye className="h-[18px] w-[18px]" aria-hidden />}
                </button>
              </div>
            </div>

            {error && (
              <p id={ids.error} role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
                {error}
              </p>
            )}

            <button type="submit" disabled={busy || !identifier || !password}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:ring-offset-slate-950">
              {busy ? <LoaderCircle className="h-[18px] w-[18px] animate-spin" aria-hidden /> : <LockKeyhole className="h-4 w-4" aria-hidden />}
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

/** Only same-site relative paths, never "//evil.com". */
function safeNext(next: string | null): string | null {
  return next && next.startsWith('/') && !next.startsWith('//') && next !== '/login' ? next : null;
}
