'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { currentUser, getAccessToken, homeFor, type Role, type SessionUser } from '@/lib/session';
import AppShell from './AppShell';

/**
 * Gate for signed-in pages. Restores the session from the refresh cookie (new tab /
 * reload), sends anonymous users to /login, and users of other roles to their own home.
 */
export default function RequireAuth({ roles, children, shell = true }: { roles: Role[]; children: ReactNode; shell?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getAccessToken();
      const me = token ? currentUser() : null;
      if (cancelled) return;
      if (!me) {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        return;
      }
      // Temporary password from the school office: set their own before anything else.
      if (me.mustChangePassword) {
        router.replace(`/set-password?next=${encodeURIComponent(pathname)}`);
        return;
      }
      if (!roles.includes(me.role)) {
        router.replace(homeFor(me.role, me.tenantId));
        return;
      }
      setUser(me);
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname, roles, router]);

  if (!user) {
    return (
      <div className="flex min-h-dvh items-center justify-center" role="status" aria-live="polite">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-100 border-t-indigo-600 dark:border-white/10 dark:border-t-indigo-300" />
        <span className="sr-only">Loading…</span>
      </div>
    );
  }
  return shell ? <AppShell user={user}>{children}</AppShell> : <>{children}</>;
}
