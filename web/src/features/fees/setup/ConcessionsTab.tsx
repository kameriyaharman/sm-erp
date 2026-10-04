'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Lock, Plus, Trash2, UserRoundSearch, X } from 'lucide-react';
import { Badge, Button, Card, cx, EmptyState, ErrorState, Input, Notice, Select, Spinner } from '@/components/ui';
import { apiSend } from '@/lib/session';
import { formatDate, formatInr, toPaise } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { StudentPicker, errorText } from '@/features/admin/shared';
import { CONCESSION_LABEL, type ConcessionType, type ConcessionView, type FeeHead } from './types';

interface RuleForm {
  feeHeadId: string; // '' = all heads
  type: ConcessionType;
  value: string;
  reason: string;
}

/** Same maths as the server (schedule.helpers.js concessionPaise): % half up to the paisa, flat capped. */
function concessionPaise(rule: RuleForm | undefined, base: number): number {
  if (!rule) return 0;
  if (rule.type === 'full_waiver') return base;
  const v = Number(rule.value);
  if (!Number.isFinite(v) || v <= 0) return 0;
  if (rule.type === 'percentage') return Math.floor((base * Math.round(Math.min(v, 100) * 100) + 5000) / 10000);
  return Math.min(toPaise(rule.value), base);
}

export default function ConcessionsTab({ heads, flash }: { heads: FeeHead[]; flash: (tone: 'success' | 'error', text: ReactNode) => void }) {
  const [studentId, setStudentId] = useState<string | null>(null);
  return (
    <div className="grid gap-5 lg:grid-cols-12">
      <Card className="lg:col-span-4" title="Find a student" description="Concessions are per student, per fee head, for this academic year.">
        <StudentPicker onPick={(s) => setStudentId(s.id)} autoFocus={false} />
      </Card>
      <div className="min-w-0 lg:col-span-8">
        {studentId ? (
          <ConcessionPanel key={studentId} studentId={studentId} heads={heads} flash={flash} onClose={() => setStudentId(null)} />
        ) : (
          <Card>
            <EmptyState
              icon={<UserRoundSearch aria-hidden />}
              title="Choose a student"
              description="Give a sibling, staff-ward, merit or RTE concession: a percentage, a flat amount per instalment, or a full waiver. Only instalments not yet invoiced change."
            />
          </Card>
        )}
      </div>
    </div>
  );
}

function ConcessionPanel({ studentId, heads, flash, onClose }: { studentId: string; heads: FeeHead[]; flash: (tone: 'success' | 'error', text: ReactNode) => void; onClose: () => void }) {
  const res = useApi<{ data: ConcessionView }>(`/students/${studentId}/fee-concession`);
  const [rules, setRules] = useState<RuleForm[]>([]);
  const [approvedBy, setApprovedBy] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const view = res.data?.data;

  useEffect(() => {
    if (!view) return;
    setRules(view.concessions.map((c) => ({ feeHeadId: c.feeHead?.id ?? '', type: c.type, value: c.type === 'full_waiver' ? '' : String(Number(c.value)), reason: c.reason })));
    setApprovedBy(view.concessions.find((c) => c.approvedBy)?.approvedBy ?? '');
    setErrors({});
    setError(null);
  }, [view]);

  const headsInUse = useMemo(() => {
    const ids = new Set(view?.allocations.map((a) => a.feeHead.id));
    return heads.filter((h) => ids.has(h.id) || rules.some((r) => r.feeHeadId === h.id));
  }, [heads, view, rules]);

  const preview = useMemo(() => {
    if (!view) return null;
    const ruleFor = (headId: string) => rules.find((r) => r.feeHeadId === headId) ?? rules.find((r) => r.feeHeadId === '');
    let before = 0;
    let after = 0;
    const rows = view.allocations.map((a) => {
      const base = toPaise(a.baseAmount);
      const now = toPaise(a.netAmount);
      const next = a.invoiced ? now : base - concessionPaise(ruleFor(a.feeHead.id), base);
      if (!a.invoiced) {
        before += now;
        after += next;
      }
      return { ...a, nextNet: next };
    });
    return { rows, before, after };
  }, [view, rules]);

  const set = (i: number, patch: Partial<RuleForm>) => setRules((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  async function save() {
    const e: Record<string, string> = {};
    const seen = new Set<string>();
    rules.forEach((r, i) => {
      if (seen.has(r.feeHeadId)) e[`${i}.feeHeadId`] = 'Only one concession per fee head';
      seen.add(r.feeHeadId);
      if (r.type !== 'full_waiver') {
        if (!/^\d+(\.\d{1,2})?$/.test(r.value.trim()) || Number(r.value) <= 0) e[`${i}.value`] = 'Enter a number';
        else if (r.type === 'percentage' && Number(r.value) > 100) e[`${i}.value`] = 'At most 100';
      }
      if (r.reason.trim().length < 2) e[`${i}.reason`] = 'Why? e.g. Sibling, Staff ward, RTE';
    });
    if (rules.length && approvedBy.trim().length < 2) e.approvedBy = 'Who approved it?';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiSend<{ data: ConcessionView; impact: { allocationsUpdated: number; invoicedUnchanged: number; unInvoicedBefore: string; unInvoicedAfter: string } }>(
        'PUT',
        `/students/${studentId}/fee-concession`,
        {
          approvedBy: approvedBy.trim() || undefined,
          concessions: rules.map((x) => ({
            feeHeadId: x.feeHeadId || null,
            type: x.type,
            ...(x.type !== 'full_waiver' && { value: x.value.trim() }),
            reason: x.reason.trim(),
          })),
        },
      );
      res.setData({ data: r.data });
      flash(
        'success',
        `Saved concessions for ${r.data.student.name}. Dues not yet invoiced: ${formatInr(r.impact.unInvoicedBefore)} → ${formatInr(r.impact.unInvoicedAfter)}${r.impact.invoicedUnchanged ? ` (${r.impact.invoicedUnchanged} invoiced instalments unchanged)` : ''}.`,
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (res.loading && !view) return <Spinner />;
  if (res.error) return <ErrorState message={res.error} onRetry={res.reload} />;
  if (!view || !preview) return null;
  const changed = preview.after !== preview.before;

  return (
    <div className="space-y-4">
      <Card
        title={view.student.name}
        description={`${view.student.admissionNumber} · ${[view.student.className, view.student.sectionName].filter(Boolean).join(' ') || 'No class'} · ${view.academicYear.name}`}
        actions={<Button variant="ghost" size="sm" icon={<X aria-hidden />} aria-label="Close" onClick={onClose} />}
      >
        <div className="space-y-3">
          {rules.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">No concession. The student pays the full class fee.</p>}
          {rules.map((r, i) => (
            <div key={i} className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem_auto] sm:items-end">
              <Select label="Fee head" value={r.feeHeadId} onChange={(e) => set(i, { feeHeadId: e.target.value })} error={errors[`${i}.feeHeadId`]}>
                <option value="">All fee heads</option>
                {headsInUse.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </Select>
              <Select label="Concession" value={r.type} onChange={(e) => set(i, { type: e.target.value as ConcessionType })}>
                {(['percentage', 'flat', 'full_waiver'] as const).map((t) => (
                  <option key={t} value={t}>
                    {CONCESSION_LABEL[t]}
                  </option>
                ))}
              </Select>
              {r.type === 'full_waiver' ? (
                <div className="hidden sm:block" />
              ) : (
                <Input label={r.type === 'percentage' ? '%' : '₹ off each'} inputMode="decimal" value={r.value} onChange={(e) => set(i, { value: e.target.value })} error={errors[`${i}.value`]} />
              )}
              <Button variant="ghost" icon={<Trash2 aria-hidden />} aria-label="Remove concession" className="justify-self-end text-slate-500 hover:text-red-600" onClick={() => setRules((rs) => rs.filter((_, k) => k !== i))} />
              <Input label="Reason" value={r.reason} onChange={(e) => set(i, { reason: e.target.value })} error={errors[`${i}.reason`]} maxLength={255} placeholder="Sibling, Staff ward, Merit, RTE…" className="sm:col-span-4" />
            </div>
          ))}
          <div className="flex flex-wrap items-end gap-3">
            <Button variant="secondary" icon={<Plus aria-hidden />} onClick={() => setRules((rs) => [...rs, { feeHeadId: rs.some((x) => x.feeHeadId === '') ? (headsInUse[0]?.id ?? '') : '', type: 'percentage', value: '', reason: '' }])}>
              Add concession
            </Button>
            {rules.length > 0 && <Input label="Approved by" value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} error={errors.approvedBy} maxLength={150} placeholder="e.g. Principal" className="min-w-[12rem] flex-1 sm:flex-none" />}
          </div>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
            <p className="text-sm">
              Not yet invoiced: <span className="tabular-nums">{formatInr(preview.before / 100)}</span>
              {changed && (
                <>
                  {' '}
                  → <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{formatInr(preview.after / 100)}</span>
                </>
              )}
            </p>
            <Button loading={busy} onClick={save}>
              Save concessions
            </Button>
          </div>
        </div>
      </Card>

      <Card padded={false} title="Instalments this year" description="Invoiced instalments keep the amount they were billed at.">
        {preview.rows.length === 0 ? (
          <EmptyState title="No fees set up for this student" description="Apply the class fee structure from the Class fees tab first; the concession will be used then." />
        ) : (
          <ul className="divide-y divide-line">
            {preview.rows.map((a) => {
              const moved = !a.invoiced && a.nextNet !== toPaise(a.netAmount);
              return (
                <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {a.feeHead.name} <span className="font-normal text-slate-500">· {a.label ?? `#${a.installmentNo}`}</span>
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Due {formatDate(a.dueDate)}
                      {a.concessionType !== 'none' && ` · ${a.concessionReason ?? 'Concession'} −${formatInr(a.concessionAmount)}`}
                    </p>
                  </div>
                  {a.invoiced ? (
                    <Badge tone="gray">
                      <Lock className="h-3 w-3" aria-hidden />
                      {a.invoiceNumber}
                    </Badge>
                  ) : null}
                  <div className="w-28 shrink-0 text-right tabular-nums">
                    {moved ? (
                      <>
                        <span className="block text-xs text-slate-400 line-through">{formatInr(a.netAmount)}</span>
                        <span className="font-semibold text-emerald-700 dark:text-emerald-400">{formatInr(a.nextNet / 100)}</span>
                      </>
                    ) : (
                      <span className={cx(a.invoiced && 'text-slate-500')}>{formatInr(a.netAmount)}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
