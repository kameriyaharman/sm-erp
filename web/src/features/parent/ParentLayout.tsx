'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, type ComponentType, type ReactNode, type SVGProps } from 'react';
import { ArrowLeft, Bell, Bus, CircleAlert, GraduationCap, House, Inbox, User, Wallet } from 'lucide-react';
import { apiGet } from '@/lib/session';
import type { ChildHome, ChildSummary, ParentHomeData, SchoolNotice } from './types';

/* ============================================================================
 * Shared frame for every parent-app screen: sticky app bar, child switcher,
 * bottom tab bar (safe-area aware), and the data every screen needs (children
 * list + school name, from /parent/home, cached for the session of the tab).
 * ========================================================================== */

type Icon = ComponentType<SVGProps<SVGSVGElement>>;
export type ParentTab = 'home' | 'fees' | 'academics' | 'bus' | 'profile';

export const ACCENT = '#0b6b78';

/* ------------------------------------------------------------- data caching */

let homeCache: Promise<ParentHomeData> | null = null;
let noticesCache: Promise<SchoolNotice[]> | null = null;

export function loadParentHome(force = false): Promise<ParentHomeData> {
  if (force || !homeCache) {
    homeCache = apiGet<{ data: ParentHomeData }>('/parent/home').then((r) => r.data);
    homeCache.catch(() => {
      homeCache = null;
    });
  }
  return homeCache;
}

export function loadNotices(force = false): Promise<SchoolNotice[]> {
  if (force || !noticesCache) {
    noticesCache = apiGet<{ data: SchoolNotice[] }>('/notices?limit=50').then((r) => r.data);
    noticesCache.catch(() => {
      noticesCache = null;
    });
  }
  return noticesCache;
}

export function useParentHome() {
  const [data, setData] = useState<ParentHomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback((force = false) => {
    setError(null);
    loadParentHome(force).then(setData, (e: Error) => setError(e.message));
  }, []);
  useEffect(() => load(), [load]);
  return { data, error, reload: () => load(true) };
}

/* ------------------------------------------------------- notices: unread */

const SEEN_KEY = 'sm_parent_notices_seen';

function readSeen(): string {
  try {
    return localStorage.getItem(SEEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function markNoticesSeen(latest: string | undefined) {
  if (!latest) return;
  try {
    if (latest > readSeen()) localStorage.setItem(SEEN_KEY, latest);
  } catch {
    /* private mode: the badge just stays */
  }
}

/** Notices newer than the last time the parent opened Notifications. */
export function useUnreadCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    loadNotices().then(
      (list) => {
        const seen = readSeen();
        if (alive) setCount(list.filter((n) => n.createdAt > seen).length);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);
  return count;
}

/* ------------------------------------------------------- child selection */

const CHILD_KEY = 'sm_parent_child';

function storedChild(): string | null {
  try {
    return sessionStorage.getItem(CHILD_KEY);
  } catch {
    return null;
  }
}

/**
 * The selected child lives in the URL (?child=) so links and reloads keep it, with
 * sessionStorage as the fallback when a link has no ?child= (e.g. the bottom tabs
 * before a child is known). Returns the id and a setter that updates both.
 */
export function useSelectedChild(children: ChildSummary[] | null, preferredId?: string) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const fromUrl = params.get('child');
  const valid = (id: string | null | undefined): id is string => !!id && !!children?.some((c) => c.id === id);
  const stored = storedChild();
  const childId = valid(fromUrl) ? fromUrl : valid(stored) ? stored : valid(preferredId) ? preferredId : children?.[0]?.id ?? null;

  const writeUrl = useCallback(
    (id: string) => {
      const next = new URLSearchParams(params.toString());
      next.set('child', id);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  useEffect(() => {
    if (!childId) return;
    try {
      sessionStorage.setItem(CHILD_KEY, childId);
    } catch {
      /* ignore */
    }
    if (fromUrl !== childId) writeUrl(childId);
  }, [childId, fromUrl, writeUrl]);

  const select = useCallback(
    (id: string) => {
      try {
        sessionStorage.setItem(CHILD_KEY, id);
      } catch {
        /* ignore */
      }
      writeUrl(id);
    },
    [writeUrl],
  );

  return { childId, select };
}

/** "/parent/fees" + child -> "/parent/fees?child=..." */
export function withChild(path: string, childId: string | null | undefined, extra?: Record<string, string>): string {
  const sp = new URLSearchParams(extra);
  if (childId) sp.set('child', childId);
  const q = sp.toString();
  return q ? `${path}?${q}` : path;
}

/* ============================================================================
 * Shell
 * ========================================================================== */

const TABS: { key: ParentTab; label: string; icon: Icon; path: string }[] = [
  { key: 'home', label: 'Home', icon: House, path: '/parent' },
  { key: 'fees', label: 'Fees', icon: Wallet, path: '/parent/fees' },
  { key: 'academics', label: 'Academics', icon: GraduationCap, path: '/parent/academics' },
  { key: 'bus', label: 'Bus', icon: Bus, path: '/parent/bus' },
  { key: 'profile', label: 'Profile', icon: User, path: '/parent/profile' },
];

export function ParentShell({
  children,
  active,
  childId,
  title,
  subtitle,
  back,
  unread,
  hideBell = false,
}: {
  children: ReactNode;
  active: ParentTab | null;
  childId: string | null;
  /** Large line in the app bar. */
  title: string;
  /** Small accent line above the title (school name). */
  subtitle?: string;
  /** Shows a back arrow to this href (screens outside the tab bar). */
  back?: string;
  unread?: number;
  hideBell?: boolean;
}) {
  const fallbackUnread = useUnreadCount();
  const count = unread ?? fallbackUnread;
  return (
    <div className="flex min-h-dvh flex-col bg-stone-50 text-stone-900 antialiased [-webkit-tap-highlight-color:transparent] dark:bg-stone-950 dark:text-stone-100">
      <header
        className="sticky top-0 z-30 border-b border-stone-200/70 bg-stone-50/90 backdrop-blur-md dark:border-stone-800 dark:bg-stone-950/85"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center justify-between gap-2 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-1.5">
            {back && (
              <Link
                href={back}
                aria-label="Back"
                className="-ml-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-stone-600 hover:bg-stone-200/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b78] dark:text-stone-300 dark:hover:bg-stone-800"
              >
                <ArrowLeft className="h-5 w-5" aria-hidden />
              </Link>
            )}
            <div className="min-w-0">
              {subtitle && <p className="truncate text-xs font-medium text-[#0b6b78] dark:text-[#5cc0cc]">{subtitle}</p>}
              <h1 className="truncate text-base font-semibold leading-tight">{title}</h1>
            </div>
          </div>
          {!hideBell && (
            <Link
              href={withChild('/parent/notifications', childId)}
              aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
              className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-stone-600 transition-colors hover:bg-stone-200/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b78] dark:text-stone-300 dark:hover:bg-stone-800"
            >
              <Bell className="h-5 w-5" aria-hidden />
              {count > 0 && (
                <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#d03b3b] px-1 text-[10px] font-bold text-white ring-2 ring-stone-50 dark:ring-stone-950">
                  {count > 9 ? '9+' : count}
                </span>
              )}
            </Link>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1" style={{ paddingBottom: 'calc(4.5rem + env(safe-area-inset-bottom, 0px))' }}>
        {children}
      </main>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 backdrop-blur-md dark:border-stone-800 dark:bg-stone-900/95"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <ul className="mx-auto grid h-16 max-w-2xl grid-cols-5">
          {TABS.map(({ key, label, icon: TabIcon, path }) => {
            const isActive = key === active;
            return (
              <li key={key}>
                <Link
                  href={withChild(path, childId)}
                  aria-current={isActive ? 'page' : undefined}
                  className={[
                    'flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0b6b78]',
                    isActive ? 'text-[#0b6b78] dark:text-[#5cc0cc]' : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200',
                  ].join(' ')}
                >
                  <span className={`flex h-7 w-12 items-center justify-center rounded-full ${isActive ? 'bg-[#e3f1f2] dark:bg-[#0b6b78]/30' : ''}`}>
                    <TabIcon className="h-5 w-5" aria-hidden />
                  </span>
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

/* ============================================================================
 * Child switcher (siblings)
 * ========================================================================== */

export function ChildSwitcher({ items, selectedId, onSelect }: { items: ChildHome[]; selectedId: string; onSelect: (id: string) => void }) {
  return (
    <div className="border-b border-stone-200/70 px-4 py-3 sm:px-6 dark:border-stone-800">
      <div role="radiogroup" aria-label="Choose child" className="flex gap-2 overflow-x-auto [scrollbar-width:none]">
        {items.map(({ child, attendance, fee }) => {
          const selected = child.id === selectedId;
          const needsAttention = attendance.status === 'absent' || Number(fee.overdue) > 0;
          return (
            <button
              key={child.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onSelect(child.id)}
              className={[
                'flex shrink-0 items-center gap-2.5 rounded-full border py-1.5 pl-1.5 pr-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b78]',
                selected
                  ? 'border-[#0b6b78] bg-[#e3f1f2] dark:border-[#5cc0cc] dark:bg-[#0b6b78]/25'
                  : 'border-stone-200 bg-white hover:border-stone-300 dark:border-stone-700 dark:bg-stone-900',
              ].join(' ')}
            >
              <span className="relative">
                <Avatar name={child.name} selected={selected} />
                {needsAttention && (
                  <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-[#d03b3b] ring-2 ring-white dark:ring-stone-900" aria-hidden />
                )}
              </span>
              <span>
                <span className="block text-sm font-semibold leading-tight">{child.firstName}</span>
                <span className="block text-xs text-stone-500 dark:text-stone-400">
                  {child.className} {child.sectionName}
                  {needsAttention && <span className="sr-only">, needs attention</span>}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Avatar({ name, selected }: { name: string; selected?: boolean }) {
  // Siblings share a surname, so use the first two letters of the first name: "Aa", "Ro".
  const initials = (name.split(/\s+/)[0] ?? '').slice(0, 2);
  return (
    <span
      aria-hidden
      className={[
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold',
        selected ? 'bg-[#0b6b78] text-white dark:bg-[#5cc0cc] dark:text-stone-950' : 'bg-stone-200 text-stone-700 dark:bg-stone-700 dark:text-stone-200',
      ].join(' ')}
    >
      {initials}
    </span>
  );
}

/* ============================================================================
 * ParentScreen: shell + children list + selected child, for the per-child pages
 * ========================================================================== */

export function ParentScreen({
  active,
  title,
  back,
  unread,
  hideSwitcher = false,
  children,
}: {
  active: ParentTab | null;
  title: string;
  back?: string;
  unread?: number;
  /** For screens that are not about one child (notices, profile). */
  hideSwitcher?: boolean;
  children: (ctx: { home: ChildHome; data: ParentHomeData; childId: string }) => ReactNode;
}) {
  const { data, error, reload } = useParentHome();
  const { childId, select } = useSelectedChild(data ? data.children.map((c) => c.child) : null);
  const home = data?.children.find((c) => c.child.id === childId) ?? null;

  return (
    <ParentShell active={active} childId={childId} title={title} subtitle={data?.schoolName} back={back} unread={unread}>
      {error ? (
        <div className="px-4 pt-6 sm:px-6">
          <ErrorBlock message={error} onRetry={reload} />
        </div>
      ) : !data ? (
        <div className="flex flex-col gap-4 px-4 pt-4 sm:px-6">
          <Skeleton className="h-12" />
          <Skeleton className="h-32" />
          <Skeleton className="h-48" />
        </div>
      ) : !home ? (
        <div className="px-4 pt-6 sm:px-6">
          <EmptyBlock title="No children linked yet" description="Contact the school office to link your children to this account." />
        </div>
      ) : (
        <>
          {data.children.length > 1 && !hideSwitcher && <ChildSwitcher items={data.children} selectedId={home.child.id} onSelect={select} />}
          <div key={hideSwitcher ? 'all' : home.child.id} className="flex flex-col gap-6 px-4 pb-6 pt-4 sm:px-6">
            {children({ home, data, childId: home.child.id })}
          </div>
        </>
      )}
    </ParentShell>
  );
}

/* ============================================================================
 * Small building blocks in the parent-app style (stone + teal)
 * ========================================================================== */

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-2xl bg-stone-200/70 motion-reduce:animate-none dark:bg-stone-800 ${className}`} />;
}

export function Loading({ label = 'Loading…', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={i === 0 ? 'h-24' : 'h-16'} />
      ))}
    </div>
  );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-8 text-center text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100">
      <CircleAlert className="h-6 w-6" aria-hidden />
      <p className="max-w-xs text-sm">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="h-10 rounded-xl border border-red-300 bg-white px-4 text-sm font-semibold text-red-800 hover:bg-red-50 dark:border-red-400/40 dark:bg-transparent dark:text-red-100 dark:hover:bg-red-500/20"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyBlock({ title, description, icon: EmptyIcon = Inbox }: { title: string; description?: ReactNode; icon?: Icon }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-stone-300 px-5 py-10 text-center dark:border-stone-700">
      <EmptyIcon className="h-7 w-7 text-stone-400" aria-hidden />
      <p className="text-[15px] font-semibold">{title}</p>
      {description && <p className="max-w-xs text-sm text-stone-500 dark:text-stone-400">{description}</p>}
    </div>
  );
}

export function PCard({ children, className = '', as: Tag = 'section', ...rest }: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'li'; 'aria-labelledby'?: string; 'aria-label'?: string }) {
  return (
    <Tag className={`rounded-2xl border border-stone-200 bg-white shadow-[0_1px_2px_rgba(28,25,23,0.04)] dark:border-stone-800 dark:bg-stone-900 ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

export function SectionTitle({ id, icon: TitleIcon, children, action }: { id?: string; icon?: Icon; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 id={id} className="flex items-center gap-2 text-base font-semibold">
        {TitleIcon && <TitleIcon className="h-[18px] w-[18px] text-stone-400" aria-hidden />}
        {children}
      </h2>
      {action}
    </div>
  );
}

/** iOS-style segmented control (role=tablist). */
export function Segmented<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: { value: T; label: string }[]; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="grid gap-1 rounded-xl bg-stone-200/70 p-1 dark:bg-stone-800" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(item.value)}
            className={[
              'h-9 truncate rounded-lg px-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b78]',
              selected ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-950 dark:text-stone-50' : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100',
            ].join(' ')}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export const primaryBtn =
  'inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#0b6b78] px-4 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-[#095a65] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b78] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-stone-300 disabled:text-stone-500 disabled:shadow-none dark:bg-[#5cc0cc] dark:text-stone-950 dark:hover:bg-[#7dd0da] dark:focus-visible:ring-offset-stone-950 dark:disabled:bg-stone-800 dark:disabled:text-stone-500';

export const secondaryBtn =
  'inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-3.5 text-sm font-semibold text-stone-800 transition-colors hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b78] disabled:opacity-60 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800';
