'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Badge, Button, cx } from '@/components/ui';
import type { GatewayMode, LoginStatus, OnlineStatus } from './types';

/** Copies text; falls back to a hidden textarea where the Clipboard API is blocked (http, old WebViews). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function CopyButton({ text, label = 'Copy', size = 'sm', variant = 'secondary' }: { text: string; label?: string; size?: 'sm' | 'md'; variant?: 'secondary' | 'ghost' }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant={variant}
      size={size}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        }
      }}
      icon={done ? <Check aria-hidden /> : <Copy aria-hidden />}
      aria-live="polite"
    >
      {done ? 'Copied' : label}
    </Button>
  );
}

/** A value shown in monospace with a copy button (webhook URL, temporary password). */
export function CopyField({ value, label, large = false }: { value: string; label: string; large?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-line bg-surface-muted py-1.5 pl-3 pr-1.5">
      <code className={cx('min-w-0 flex-1 select-all break-all font-mono text-slate-800 dark:text-slate-100', large ? 'text-lg font-semibold tracking-wide' : 'text-13')} aria-label={label}>
        {value}
      </code>
      <CopyButton text={value} label="Copy" />
    </div>
  );
}

export function ModeBadge({ mode }: { mode: GatewayMode | null | undefined }) {
  if (!mode) return null;
  return mode === 'live' ? (
    <Badge tone="green" dot>
      Live mode
    </Badge>
  ) : (
    <Badge tone="amber" dot>
      Test mode
    </Badge>
  );
}

const ORDER_STATUS: Record<OnlineStatus, { label: string; tone: 'gray' | 'green' | 'amber' | 'red' | 'indigo' }> = {
  paid: { label: 'Paid', tone: 'green' },
  created: { label: 'In progress', tone: 'indigo' },
  failed: { label: 'Failed', tone: 'red' },
  expired: { label: 'Not completed', tone: 'gray' },
  needs_review: { label: 'Needs review', tone: 'amber' },
};

export function OrderStatusBadge({ status }: { status: OnlineStatus }) {
  const s = ORDER_STATUS[status];
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  );
}

export const ORDER_STATUS_LABEL = Object.fromEntries(Object.entries(ORDER_STATUS).map(([k, v]) => [k, v.label])) as Record<OnlineStatus, string>;

const LOGIN_STATUS: Record<LoginStatus, { label: string; tone: 'gray' | 'green' | 'amber' | 'red' | 'indigo' }> = {
  none: { label: 'No login', tone: 'gray' },
  temporary: { label: 'Temporary password', tone: 'amber' },
  active: { label: 'Active', tone: 'green' },
  locked: { label: 'Locked', tone: 'red' },
  inactive: { label: 'Deactivated', tone: 'gray' },
};

export function LoginStatusBadge({ status }: { status: LoginStatus }) {
  const s = LOGIN_STATUS[status];
  return (
    <Badge tone={s.tone} dot={status !== 'none'}>
      {s.label}
    </Badge>
  );
}

export const LOGIN_STATUS_LABEL = Object.fromEntries(Object.entries(LOGIN_STATUS).map(([k, v]) => [k, v.label])) as Record<LoginStatus, string>;

/** "3 min ago" / "2 h ago" / date, for "last login" style columns. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}
