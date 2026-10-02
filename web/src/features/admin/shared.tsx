'use client';

/**
 * Small pieces shared by the admin screens: error helpers, flash notices, confirm dialog,
 * progress bar, class/section pickers, student search, status badges.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Phone, Search } from 'lucide-react';
import { Badge, Button, cx, Modal, Notice, Select, Spinner, type BadgeTone } from '@/components/ui';
import { qs, useApi } from '@/lib/useApi';
import { ApiError, currentUser, type Role } from '@/lib/session';
import { titleCase } from '@/lib/format';
import type { ClassInfo, Paged, ReportCardStatus, SectionInfo, StudentRow, StudentStatus, Wrapped } from './types';

// ------------------------------------------------------------------ errors

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Please try again.';
}

/** Field errors from a VALIDATION_ERROR: `{ body: { field: [msg] } }` (or flat) -> `{ field: msg }`. */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || !err.details || typeof err.details !== 'object') return {};
  const out: Record<string, string> = {};
  const walk = (obj: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(obj)) {
      if (Array.isArray(value)) {
        const first = value.find((v) => typeof v === 'string');
        if (typeof first === 'string' && !out[key]) out[key] = first;
      } else if (value && typeof value === 'object' && ['body', 'query', 'params'].includes(key)) {
        walk(value as Record<string, unknown>);
      }
    }
  };
  walk(err.details as Record<string, unknown>);
  return out;
}

export function errorCode(err: unknown): string | null {
  return err instanceof ApiError ? err.code : null;
}

// ------------------------------------------------------------------ roles

export function isAdminRole(role: Role | undefined | null): boolean {
  return role === 'super_admin' || role === 'branch_admin';
}
export function useRole(): Role | null {
  const [role, setRole] = useState<Role | null>(null);
  useEffect(() => setRole(currentUser()?.role ?? null), []);
  return role;
}

// ------------------------------------------------------------------ flash notice

export type Flash = { tone: 'success' | 'error' | 'info' | 'warn'; text: ReactNode } | null;

export function useFlash(timeout = 7000) {
  const [flash, setFlash] = useState<Flash>(null);
  useEffect(() => {
    if (!flash || flash.tone === 'error') return;
    const t = setTimeout(() => setFlash(null), timeout);
    return () => clearTimeout(t);
  }, [flash, timeout]);
  const show = useCallback((tone: NonNullable<Flash>['tone'], text: ReactNode) => setFlash({ tone, text }), []);
  const node = flash ? (
    <div className="mb-4">
      <Notice tone={flash.tone}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">{flash.text}</div>
          <button type="button" onClick={() => setFlash(null)} className="shrink-0 text-xs font-medium underline-offset-2 hover:underline">
            Dismiss
          </button>
        </div>
      </Notice>
    </div>
  ) : null;
  return { flash, show, clear: () => setFlash(null), node };
}

// ------------------------------------------------------------------ confirm dialog

export function ConfirmModal({
  open,
  title,
  children,
  confirmLabel = 'Confirm',
  tone = 'danger',
  busy = false,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={busy ? () => undefined : onClose}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-slate-700 dark:text-slate-300">
        {children}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ progress

export function ProgressBar({ value, max, label, tone }: { value: number; max: number; label?: string; tone?: 'indigo' | 'green' | 'amber' | 'red' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const auto = tone ?? (pct >= 100 ? 'green' : pct >= 50 ? 'indigo' : 'amber');
  const fill = { indigo: 'bg-indigo-500', green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500' }[auto];
  return (
    <div className="flex min-w-[8rem] items-center gap-2" title={label}>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className={cx('h-full rounded-full transition-all', fill)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-9 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">{pct}%</span>
    </div>
  );
}

// ------------------------------------------------------------------ badges

export function StudentStatusBadge({ status }: { status: StudentStatus }) {
  const tone: BadgeTone = status === 'enrolled' ? 'green' : status === 'suspended' ? 'amber' : 'gray';
  return <Badge tone={tone}>{titleCase(status)}</Badge>;
}

export function ReportCardBadge({ status }: { status: ReportCardStatus }) {
  const tone: BadgeTone = status === 'published' ? 'green' : status === 'generated' ? 'indigo' : status === 'revoked' ? 'red' : 'gray';
  return <Badge tone={tone}>{titleCase(status)}</Badge>;
}

export function PhoneLink({ phone, className }: { phone: string | null | undefined; className?: string }) {
  if (!phone) return <span className="text-slate-400">-</span>;
  return (
    <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className={cx('inline-flex items-center gap-1 text-indigo-700 hover:underline dark:text-indigo-300', className)}>
      <Phone className="h-3.5 w-3.5" aria-hidden />
      {phone}
    </a>
  );
}

// ------------------------------------------------------------------ classes / sections

export interface FlatSection extends SectionInfo {
  classId: string;
  className: string;
}

/** Current-year classes of the caller's branch, plus a flat section list. */
export function useClasses() {
  const res = useApi<Wrapped<ClassInfo[]>>('/school/classes');
  const classes = useMemo(() => res.data?.data ?? [], [res.data]);
  const sections = useMemo<FlatSection[]>(() => classes.flatMap((c) => c.sections.map((s) => ({ ...s, classId: c.id, className: c.name }))), [classes]);
  return { classes, sections, loading: res.loading, error: res.error, reload: res.reload };
}

export function SectionSelect({
  sections,
  value,
  onChange,
  label = 'Section',
  placeholder = 'Choose a section',
  className,
  id,
}: {
  sections: FlatSection[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
  placeholder?: string;
  className?: string;
  id?: string;
}) {
  return (
    <Select label={label} value={value} onChange={(e) => onChange(e.target.value)} className={className} id={id}>
      <option value="">{placeholder}</option>
      {sections.map((s) => (
        <option key={s.id} value={s.id}>
          {s.label}
        </option>
      ))}
    </Select>
  );
}

// ------------------------------------------------------------------ debounce

export function useDebounced<T>(value: T, delay = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

// ------------------------------------------------------------------ student search

/** Search box + result list for choosing a student (certificates, transport). */
export function StudentPicker({ onPick, status = 'active', autoFocus = true }: { onPick: (s: StudentRow) => void; status?: 'active' | 'all'; autoFocus?: boolean }) {
  const [term, setTerm] = useState('');
  const q = useDebounced(term.trim());
  const res = useApi<Paged<StudentRow>>(q.length >= 2 ? `/students${qs({ search: q, limit: 8, status })}` : null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  return (
    <div>
      <label className="relative block">
        <span className="sr-only">Search students</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <input
          ref={ref}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Name, admission no. or parent phone"
          className="block h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-950"
        />
      </label>
      <div className="mt-2 min-h-[8rem]">
        {q.length < 2 ? (
          <p className="px-1 py-6 text-center text-sm text-slate-500 dark:text-slate-400">Type at least 2 letters to search.</p>
        ) : res.loading ? (
          <Spinner label="Searching…" />
        ) : res.error ? (
          <Notice tone="error">{res.error}</Notice>
        ) : !res.data?.data.length ? (
          <p className="px-1 py-6 text-center text-sm text-slate-500 dark:text-slate-400">No students match “{q}”.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {res.data.data.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => onPick(s)} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-slate-50 focus:bg-slate-50 focus:outline-none dark:hover:bg-slate-800 dark:focus:bg-slate-800">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{s.name}</span>
                    <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                      {[s.class?.name, s.section?.name].filter(Boolean).join(' ') || 'No class'} · {s.admissionNumber}
                    </span>
                  </span>
                  <StudentStatusBadge status={s.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ misc

export function DefinitionList({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 lg:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{k}</dt>
          <dd className="mt-0.5 break-words text-sm">{v === null || v === undefined || v === '' ? <span className="text-slate-400">-</span> : v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Today's date (local) as YYYY-MM-DD. */
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "2026-09" -> first and last day. */
export function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  return (
    <span
      aria-hidden
      className={cx(
        'flex shrink-0 items-center justify-center rounded-full bg-indigo-100 font-semibold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200',
        size === 'lg' ? 'h-14 w-14 text-lg' : 'h-9 w-9 text-xs',
      )}
    >
      {initials(name)}
    </span>
  );
}

/** Small toolbar row for filters above a table. */
export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4 dark:border-slate-800 [&>*]:min-w-[10rem] [&>*]:flex-1 sm:[&>*]:flex-none">{children}</div>;
}
