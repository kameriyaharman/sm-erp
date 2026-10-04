'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Printer, X } from 'lucide-react';
import { Button } from '@/components/ui';
import type { LoginSlip } from './types';

/**
 * Printable login slips (A4, cut along the dashed lines). Kept in memory only: temporary passwords
 * are never written to browser storage, and closing this view forgets them.
 */
export default function LoginSlips({
  slips,
  schoolCode,
  schoolName,
  portalUrl,
  title,
  onClose,
}: {
  slips: LoginSlip[];
  schoolCode: string;
  schoolName: string;
  portalUrl: string;
  title: string;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  function downloadCsv() {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [
      ['Name', 'Class / children', 'School code', 'Login', 'Temporary password', 'Sign-in page'].map(esc).join(','),
      ...slips.map((s) =>
        [s.name, s.classLabel ?? (s.children ?? []).map((c) => `${c.name} (${c.classLabel})`).join('; '), schoolCode, s.loginId, s.password ?? '', portalUrl].map(esc).join(','),
      ),
    ];
    // BOM so Excel opens UTF-8 names correctly.
    const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `login-slips-${title.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  if (!mounted) return null;
  return createPortal(
    <div id="login-slips" className="fixed inset-0 z-[70] overflow-y-auto bg-canvas print:static print:overflow-visible print:bg-white">
      <style>{`@media print { body > *:not(#login-slips) { display: none !important; } @page { size: A4; margin: 10mm; } }`}</style>
      <div className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-900 dark:text-white">Login slips: {title}</h2>
            <p className="text-13 text-slate-500 dark:text-slate-400">
              {slips.length} slip{slips.length === 1 ? '' : 's'}. Print or download now: passwords are not shown again after you close this.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<Download aria-hidden />} onClick={downloadCsv}>
              CSV
            </Button>
            <Button icon={<Printer aria-hidden />} onClick={() => window.print()}>
              Print
            </Button>
            <Button variant="ghost" icon={<X aria-hidden />} onClick={onClose} aria-label="Close slips">
              Close
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-5xl gap-4 px-4 py-6 sm:grid-cols-2 sm:px-6 print:grid-cols-2 print:gap-0 print:p-0">
        {slips.map((s) => (
          <article key={s.userId} className="break-inside-avoid rounded-xl border-2 border-dashed border-slate-300 bg-white p-5 text-slate-900 dark:border-slate-600 print:rounded-none print:border print:p-4">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{schoolName}</p>
                <p className="text-xs text-slate-500">{s.type === 'student' ? 'Student portal login' : 'Parent portal login'}</p>
              </div>
              <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#0E1A33] text-[11px] font-semibold text-white">
                SM
                <span aria-hidden className="absolute inset-x-1.5 bottom-1 h-[2px] rounded-full bg-[#F5B544]" />
              </span>
            </div>
            <p className="mt-3 text-base font-semibold">{s.name}</p>
            <p className="text-xs text-slate-600">
              {s.type === 'student' ? s.classLabel : (s.children ?? []).map((c) => `${c.name} (${c.classLabel})`).join(', ')}
            </p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-slate-500">Open</dt>
              <dd className="break-all font-medium">{portalUrl.replace(/^https?:\/\//, '')}</dd>
              <dt className="text-slate-500">School code</dt>
              <dd className="font-mono font-semibold">{schoolCode}</dd>
              <dt className="text-slate-500">{s.type === 'student' ? 'Admission no.' : 'Mobile / login'}</dt>
              <dd className="break-all font-mono font-semibold">{s.loginId}</dd>
              <dt className="text-slate-500">Password</dt>
              <dd className="font-mono text-base font-bold tracking-wider">{s.password ?? '(set by the office)'}</dd>
            </dl>
            <p className="mt-3 rounded-md bg-slate-100 px-2.5 py-1.5 text-[11px] leading-snug text-slate-600">
              This is a temporary password. After signing in you will choose your own. Keep this slip private.
            </p>
          </article>
        ))}
      </div>
    </div>,
    document.body,
  );
}
