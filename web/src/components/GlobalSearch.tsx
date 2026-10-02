'use client';

import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { LoaderCircle, Phone, Search, X } from 'lucide-react';
import { apiGet, type Role } from '@/lib/session';
import { cx } from './ui';

interface Hit {
  id: string;
  name: string;
  admissionNumber: string;
  rollNumber: string | null;
  class: { name: string } | null;
  section: { name: string } | null;
  parent: { name: string; phone: string | null } | null;
}

const SEARCH_ROLES: Role[] = ['super_admin', 'branch_admin', 'teacher'];

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

/**
 * Student search in the top bar: Ctrl/⌘+K focuses it. Admins open the student's profile;
 * teachers see class, admission number and the parent's phone.
 */
export default function GlobalSearch({ role }: { role: Role }) {
  const router = useRouter();
  const listId = useId();
  const desktopRef = useRef<HTMLInputElement>(null);
  const mobileRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [focused, setFocused] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [mac, setMac] = useState(false);
  const canOpen = role === 'super_admin' || role === 'branch_admin';
  const q = term.trim();

  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)), []);

  // Debounced fetch
  useEffect(() => {
    if (q.length < 2) {
      setHits(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      apiGet<{ data: Hit[] }>(`/students?search=${encodeURIComponent(q)}&limit=6`)
        .then((res) => {
          if (cancelled) return;
          setHits(res.data);
          setError(false);
          setActive(0);
        })
        .catch(() => !cancelled && setError(true))
        .finally(() => !cancelled && setLoading(false));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  // Ctrl/⌘ + K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (window.matchMedia('(min-width: 1024px)').matches) {
          desktopRef.current?.focus();
          desktopRef.current?.select();
        } else {
          setMobileOpen(true);
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (mobileOpen) mobileRef.current?.focus();
  }, [mobileOpen]);

  // Close the desktop dropdown on outside click.
  useEffect(() => {
    if (!focused) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setFocused(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [focused]);

  const reset = useCallback(() => {
    setTerm('');
    setHits(null);
    setFocused(false);
    setMobileOpen(false);
  }, []);

  const go = useCallback(
    (hit: Hit) => {
      if (!canOpen) return;
      reset();
      desktopRef.current?.blur();
      router.push(`/students/${hit.id}`);
    },
    [canOpen, reset, router],
  );

  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (term) setTerm('');
      else {
        setFocused(false);
        setMobileOpen(false);
        e.currentTarget.blur();
      }
    } else if (e.key === 'ArrowDown' && hits?.length) {
      e.preventDefault();
      setActive((a) => (a + 1) % hits.length);
    } else if (e.key === 'ArrowUp' && hits?.length) {
      e.preventDefault();
      setActive((a) => (a - 1 + hits.length) % hits.length);
    } else if (e.key === 'Enter' && hits?.[active]) {
      e.preventDefault();
      go(hits[active]);
    }
  }

  if (!SEARCH_ROLES.includes(role)) return null;

  const showResults = q.length >= 2;
  const results = showResults && (
    <>
    <div id={listId} role="listbox" aria-label="Matching students" className="max-h-[min(420px,70vh)] overflow-y-auto p-1.5">
      {loading && !hits ? (
        <p className="flex items-center gap-2 px-3 py-6 text-sm text-slate-500 dark:text-slate-400">
          <LoaderCircle className="h-4 w-4 animate-spin text-indigo-500" aria-hidden /> Searching
        </p>
      ) : error ? (
        <p className="px-3 py-6 text-sm text-slate-500 dark:text-slate-400">Search is unavailable right now.</p>
      ) : hits && hits.length === 0 ? (
        <p className="px-3 py-6 text-sm text-slate-500 dark:text-slate-400">No student matches “{q}”.</p>
      ) : (
        hits?.map((h, i) => {
          const cls = [h.class?.name, h.section?.name].filter(Boolean).join(' ') || 'No class';
          return (
            <div
              key={h.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => canOpen && e.preventDefault()}
              onClick={() => go(h)}
              className={cx(
                'flex items-center gap-3 rounded-lg px-2.5 py-2',
                canOpen && 'cursor-pointer',
                i === active ? 'bg-slate-100 dark:bg-white/[0.06]' : '',
              )}
            >
              <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-200">
                {initials(h.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-900 dark:text-white">{h.name}</span>
                <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                  {cls}, adm. no. <span className="tabular-nums">{h.admissionNumber}</span>
                </span>
              </span>
              {!canOpen && h.parent?.phone && (
                <a
                  href={`tel:${h.parent.phone.replace(/[^\d+]/g, '')}`}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-400/10"
                  aria-label={`Call ${h.parent.name}`}
                >
                  <Phone className="h-3.5 w-3.5" aria-hidden />
                  <span className="tabular-nums">{h.parent.phone}</span>
                </a>
              )}
            </div>
          );
        })
      )}
    </div>
    {/* Teachers only find students of their own classes (the API limits the search); profiles are for the office. */}
    {!canOpen && <p className="border-t border-line px-4 py-2 text-xs text-slate-500 dark:text-slate-400">Only students of your classes are shown.</p>}
    </>
  );

  const inputProps = {
    type: 'text',
    role: 'combobox',
    'aria-label': 'Search students',
    'aria-expanded': showResults,
    'aria-controls': listId,
    'aria-autocomplete': 'list' as const,
    'aria-activedescendant': hits?.length ? `${listId}-${active}` : undefined,
    autoComplete: 'off',
    spellCheck: false,
    value: term,
    onChange: (e: ChangeEvent<HTMLInputElement>) => setTerm(e.target.value),
    onKeyDown,
  };

  return (
    <>
      {/* desktop: inline field */}
      <div ref={boxRef} className="relative hidden w-full max-w-[440px] lg:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <input
          ref={desktopRef}
          {...inputProps}
          onFocus={() => setFocused(true)}
          placeholder="Search by name or admission no."
          className="h-9 w-full rounded-lg border border-transparent bg-slate-100/80 pl-9 pr-14 text-sm text-slate-900 placeholder:text-slate-500 transition-colors hover:bg-slate-100 focus:border-indigo-500 focus:bg-surface focus:outline-none focus:ring-[3px] focus:ring-indigo-500/20 dark:bg-white/[0.05] dark:text-white dark:placeholder:text-slate-500 dark:focus:border-indigo-400"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-line bg-surface px-1.5 py-px font-sans text-[11px] font-medium text-slate-500 dark:text-slate-400">
          {mac ? '⌘K' : 'Ctrl K'}
        </kbd>
        {focused && showResults && (
          <div className="absolute inset-x-0 top-[calc(100%+6px)] z-40 animate-fade-in overflow-hidden rounded-xl border border-line bg-surface shadow-float">{results}</div>
        )}
      </div>

      {/* phones / tablets: icon that opens a full-width panel */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Search students"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white lg:hidden"
      >
        <Search className="h-[18px] w-[18px]" aria-hidden />
      </button>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-ink-950/45" onClick={reset} />
          <div className="relative animate-sheet-up border-b border-line bg-surface shadow-float">
            <div className="flex h-14 items-center gap-2 px-3">
              <Search className="ml-1 h-[18px] w-[18px] shrink-0 text-slate-400" aria-hidden />
              <input
                ref={mobileRef}
                {...inputProps}
                placeholder="Name or admission no."
                className="h-10 min-w-0 flex-1 bg-transparent text-base text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-white"
              />
              <button type="button" onClick={reset} aria-label="Close search" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            {showResults && <div className="border-t border-line">{results}</div>}
          </div>
        </div>
      )}
    </>
  );
}
