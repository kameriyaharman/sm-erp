'use client';

import Link from 'next/link';
import { type ReactNode } from 'react';
import { ArrowLeft, Mail, MessageCircle, MessageSquareText } from 'lucide-react';
import { Badge, Button, PageHeader, cx, type BadgeTone } from '@/components/ui';
import type { Branch, Channel } from './types';

/** Settings sub-page header with the "Settings" breadcrumb. */
export function SettingsHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <PageHeader
      title={title}
      breadcrumb={
        <Link href="/settings" className="inline-flex items-center gap-1 hover:text-slate-800 dark:hover:text-slate-200">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Settings
        </Link>
      }
      description={description}
      actions={actions}
    />
  );
}

/** Accessible on/off switch (same look as Settings -> Online payments). */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  size = 'md',
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
}) {
  const sm = size === 'sm';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-slate-900',
        sm ? 'h-5 w-9' : 'h-7 w-12',
        checked ? 'bg-indigo-600 dark:bg-indigo-500' : 'bg-slate-300 dark:bg-white/15',
      )}
    >
      <span
        className={cx(
          'inline-block rounded-full bg-white shadow transition-transform',
          sm ? 'h-3.5 w-3.5' : 'h-5 w-5',
          checked ? (sm ? 'translate-x-[18px]' : 'translate-x-6') : sm ? 'translate-x-[3px]' : 'translate-x-1',
        )}
      />
    </button>
  );
}

/** A labelled row with a switch on the right. */
export function SwitchRow({ title, text, checked, onChange, disabled, children }: { title: ReactNode; text?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; children?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-line bg-surface-muted/50 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-900 dark:text-white">{title}</p>
        {text && <p className="mt-0.5 text-13 text-slate-500 dark:text-slate-400">{text}</p>}
        {children}
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={typeof title === 'string' ? title : 'Toggle'} />
    </div>
  );
}

export const CHANNEL_LABEL: Record<Channel, string> = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email' };

export function ChannelIcon({ channel, className = 'h-4 w-4' }: { channel: Channel; className?: string }) {
  const Icon = channel === 'whatsapp' ? MessageCircle : channel === 'sms' ? MessageSquareText : Mail;
  return <Icon className={className} aria-hidden />;
}

const CHANNEL_TONE: Record<Channel, string> = {
  whatsapp: 'bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-400/10 dark:text-emerald-200 dark:ring-emerald-400/25',
  sms: 'bg-indigo-50 text-indigo-800 ring-indigo-200 dark:bg-indigo-400/10 dark:text-indigo-200 dark:ring-indigo-400/25',
  email: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-400/10 dark:text-amber-200 dark:ring-amber-400/25',
};

export function ChannelChip({ channel, muted = false, children }: { channel: Channel; muted?: boolean; children?: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ring-1 ring-inset',
        muted ? 'bg-slate-100 text-slate-400 line-through ring-slate-200 dark:bg-white/5 dark:text-slate-500 dark:ring-white/10' : CHANNEL_TONE[channel],
      )}
    >
      <ChannelIcon channel={channel} className="h-3.5 w-3.5" />
      {CHANNEL_LABEL[channel]}
      {children}
    </span>
  );
}

/** "Whole school" + one tab per branch (only when there is more than one branch). */
export function BranchPicker({
  branches,
  value,
  onChange,
  allowSchool,
  labelFor,
}: {
  branches: Branch[];
  value: string | null;
  onChange: (branchId: string | null) => void;
  allowSchool: boolean;
  labelFor?: (b: Branch) => string;
}) {
  if (branches.length <= 1 && allowSchool) return null;
  const items = [...(allowSchool ? [{ id: null as string | null, label: 'Whole school' }] : []), ...branches.map((b) => ({ id: b.id as string | null, label: labelFor?.(b) ?? b.name }))];
  return (
    <div className="-mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div role="tablist" aria-label="Branch" className="inline-flex min-w-max gap-0.5 rounded-[10px] border border-line bg-slate-100/80 p-[3px] dark:bg-white/[0.04]">
        {items.map((it) => {
          const selected = value === it.id;
          return (
            <button
              key={it.id ?? 'school'}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(it.id)}
              className={cx(
                'h-8 shrink-0 rounded-[7px] px-3 text-13 font-medium transition-colors',
                selected ? 'bg-surface text-slate-900 shadow-[0_1px_2px_rgb(14_26_51/0.08)] dark:bg-white/10 dark:text-white' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100',
              )}
            >
              {it.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Sticky save bar shown when a form has unsaved changes. */
export function SaveBar({ dirty, busy, onSave, onReset, note }: { dirty: boolean; busy: boolean; onSave: () => void; onReset: () => void; note?: ReactNode }) {
  if (!dirty && !busy) return null;
  return (
    <div className="sticky bottom-3 z-20 mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface/95 px-4 py-3 shadow-pop backdrop-blur">
      <p className="text-sm text-slate-600 dark:text-slate-300">{note ?? 'You have unsaved changes.'}</p>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onReset} disabled={busy}>
          Discard
        </Button>
        <Button onClick={onSave} loading={busy}>
          Save changes
        </Button>
      </div>
    </div>
  );
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

const APPROVAL: Record<string, { tone: BadgeTone; label: string }> = {
  not_required: { tone: 'gray', label: 'No approval needed' },
  draft: { tone: 'gray', label: 'Draft: not submitted' },
  pending: { tone: 'amber', label: 'Waiting for Meta' },
  approved: { tone: 'green', label: 'Approved' },
  rejected: { tone: 'red', label: 'Rejected' },
  paused: { tone: 'red', label: 'Paused by Meta' },
};
export function ApprovalBadge({ status }: { status: string }) {
  const a = APPROVAL[status] ?? { tone: 'gray' as BadgeTone, label: status };
  return (
    <Badge tone={a.tone} dot>
      {a.label}
    </Badge>
  );
}

/** "14:30" input, 24-hour, with the 12-hour reading as a hint. */
export function to12h(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'am' : 'pm'}`;
}

export function numberOrNull(v: string): number | null {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
