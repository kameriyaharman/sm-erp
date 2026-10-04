'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Copy, Lock, Plus, Sparkles, Trash2, UsersRound, Wand2 } from 'lucide-react';
import { createHeadInline } from '@/features/fees/heads';
import { Badge, Button, Card, cx, EmptyState, ErrorState, Input, Modal, Notice, Select, Spinner } from '@/components/ui';
import { apiGet, apiSend } from '@/lib/session';
import { formatInr, formatMonth, toPaise } from '@/lib/format';
import { qs, useApi } from '@/lib/useApi';
import { errorText } from '@/features/admin/shared';
import {
  FREQUENCIES, FREQUENCY_LABEL, FREQUENCY_SHORT,
  type ApplyPreview, type FeeHead, type Frequency, type Impact, type Overview, type ScheduleRow, type Structure,
} from './types';

const RUPEES = /^\d+(\.\d{1,2})?$/;
const clean = (s: string) => s.replace(/[,₹\s]/g, '');

interface EditRow {
  installmentNo: number;
  label: string;
  dueDate: string;
  amount: string;
  allocations: number;
  invoiced: number;
}
interface Block {
  feeHeadId: string;
  name: string;
  code: string;
  frequency: Frequency;
  rows: EditRow[];
  fillAmount: string;
  fillDay: string;
}

function toBlocks(s: Structure): Block[] {
  const blocks: Block[] = [];
  for (const r of s.rows) {
    let b = blocks.find((x) => x.feeHeadId === r.feeHead.id);
    if (!b) {
      b = { feeHeadId: r.feeHead.id, name: r.feeHead.name, code: r.feeHead.code, frequency: r.frequency, rows: [], fillAmount: '', fillDay: String(Number(r.dueDate.slice(8, 10))) };
      blocks.push(b);
    }
    b.rows.push({ installmentNo: r.installmentNo, label: r.label ?? '', dueDate: r.dueDate, amount: String(Number(r.amount)), allocations: r.allocations, invoiced: r.invoiced });
  }
  return blocks;
}

const signature = (blocks: Block[]) =>
  JSON.stringify(blocks.map((b) => [b.feeHeadId, b.frequency, b.rows.map((r) => [r.installmentNo, r.label, r.dueDate, RUPEES.test(clean(r.amount)) ? toPaise(clean(r.amount)) : r.amount])]));

function blockTotal(b: Block) {
  return b.rows.reduce((n, r) => n + (RUPEES.test(clean(r.amount)) ? toPaise(clean(r.amount)) : 0), 0);
}

async function schedule(frequency: Frequency, amount: string, dueDay: number, academicYearId: string) {
  const res = await apiGet<{ data: { rows: ScheduleRow[] } }>(`/fees/structure/schedule${qs({ frequency, amount, dueDay, academicYearId })}`);
  return res.data.rows;
}

export default function StructureEditor({
  overview,
  classId,
  heads,
  onSaved,
  onHeadsChanged,
  flash,
}: {
  overview: Overview;
  classId: string;
  heads: FeeHead[];
  onSaved: () => void;
  /** A fee head was created inline (Add fee → New fee head). */
  onHeadsChanged?: () => void;
  flash: (tone: 'success' | 'error' | 'info' | 'warn', text: ReactNode) => void;
}) {
  const yearId = overview.academicYear.id;
  const res = useApi<{ data: Structure }>(`/fees/structure${qs({ classId, academicYearId: yearId })}`);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [baseline, setBaseline] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ impact: Impact; rows: unknown[]; annual: string } | null>(null);
  const [applyOpen, setApplyOpen] = useState<false | 'button' | 'after-save'>(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    if (res.data) {
      const b = toBlocks(res.data.data);
      setBlocks(b);
      setBaseline(signature(b));
      setErrors({});
    }
  }, [res.data]);

  const dirty = signature(blocks) !== baseline;
  const structure = res.data?.data;
  const annual = blocks.reduce((n, b) => n + blockTotal(b), 0);
  const usedHeads = new Set(blocks.map((b) => b.feeHeadId));
  const addable = heads.filter((h) => h.isActive && !usedHeads.has(h.id));
  const byMonth = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of blocks) for (const r of b.rows) if (r.dueDate && RUPEES.test(clean(r.amount))) m.set(r.dueDate.slice(0, 7), (m.get(r.dueDate.slice(0, 7)) ?? 0) + toPaise(clean(r.amount)));
    return [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  }, [blocks]);

  const update = (i: number, patch: Partial<Block>) => setBlocks((bs) => bs.map((b, k) => (k === i ? { ...b, ...patch } : b)));
  const updateRow = (i: number, j: number, patch: Partial<EditRow>) =>
    setBlocks((bs) => bs.map((b, k) => (k === i ? { ...b, rows: b.rows.map((r, n) => (n === j ? { ...r, ...patch } : r)) } : b)));

  async function regenerate(i: number, frequency: Frequency, amountText?: string) {
    const b = blocks[i];
    const amount = amountText ?? (b.rows[0] && RUPEES.test(clean(b.rows[0].amount)) ? clean(b.rows[0].amount) : '0');
    const day = Math.min(31, Math.max(1, Number(b.fillDay) || 10));
    try {
      const rows = await schedule(frequency, amount, day, yearId);
      update(i, {
        frequency,
        rows: rows.map((r) => {
          const old = b.rows.find((x) => x.installmentNo === r.installmentNo);
          return { installmentNo: r.installmentNo, label: r.label, dueDate: r.dueDate, amount: amount === '0' && !amountText ? '' : String(Number(r.amount)), allocations: old?.allocations ?? 0, invoiced: old?.invoiced ?? 0 };
        }),
      });
    } catch (err) {
      flash('error', errorText(err));
    }
  }

  function buildRows() {
    const e: Record<string, string> = {};
    const rows = blocks.flatMap((b, i) =>
      b.rows.map((r, j) => {
        const amt = clean(r.amount);
        if (!RUPEES.test(amt)) e[`${i}.${j}.amount`] = 'Enter an amount';
        if (!r.dueDate) e[`${i}.${j}.dueDate`] = 'Required';
        return { feeHeadId: b.feeHeadId, frequency: b.frequency, installmentNo: r.installmentNo, label: r.label.trim() || undefined, amount: amt, dueDate: r.dueDate };
      }),
    );
    setErrors(e);
    return Object.keys(e).length ? null : rows;
  }

  async function save(rows: unknown[], dryRun: boolean) {
    return apiSend<{ data: Structure; impact: Impact; dryRun: boolean }>('PUT', '/fees/structure', { classId, academicYearId: yearId, rows, dryRun });
  }

  async function onSave() {
    const rows = buildRows();
    if (!rows) {
      flash('error', 'Some instalments need an amount or a due date.');
      return;
    }
    setBusy(true);
    try {
      // Always show what the save will do first (dry run), then save on confirm.
      const dry = await save(rows, true);
      setConfirm({ impact: dry.impact, rows, annual: dry.data.totals.annual });
    } catch (err) {
      const details = (err as { details?: { issues?: Array<{ message: string }> } }).details;
      flash('error', details?.issues?.[0]?.message ?? errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function commit(rows: unknown[]) {
    setBusy(true);
    try {
      const r = await save(rows, false);
      const i = r.impact;
      const parts = [
        i.allocationsUpdated ? `${i.allocationsUpdated} un-invoiced instalment${i.allocationsUpdated === 1 ? '' : 's'} of ${i.studentsUpdated} student${i.studentsUpdated === 1 ? '' : 's'} updated` : null,
        i.allocationsRemoved ? `${i.allocationsRemoved} removed` : null,
        i.invoicedUnchanged ? `${i.invoicedUnchanged} already invoiced kept as billed` : null,
      ].filter(Boolean);
      flash('success', `Saved the ${r.data.class.name} fee structure: ${formatInr(r.data.totals.annual)} a year.${parts.length ? ` ${parts.join('; ')}.` : ''}`);
      setConfirm(null);
      res.reload();
      onSaved();
      // Students of this class who do not have these fees yet: offer to apply them now.
      try {
        const p = await apiGet<{ data: ApplyPreview }>(`/fees/structure/apply-preview${qs({ classId, academicYearId: yearId })}`);
        if (p.data.willChange > 0) setApplyOpen('after-save');
      } catch {
        /* the Apply to students button is still there */
      }
    } catch (err) {
      flash('error', errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (res.loading && !structure) return <Spinner label="Loading the fee structure…" />;
  if (res.error) return <ErrorState message={res.error} onRetry={res.reload} />;
  if (!structure) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">
            {structure.class.name} <span className="font-normal text-slate-500">· {structure.academicYear.name}</span>
          </h2>
          <p className="text-13 text-slate-500 dark:text-slate-400">
            {structure.students} student{structure.students === 1 ? '' : 's'} enrolled · {formatInr(annual / 100)} a year per student
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button icon={<Plus aria-hidden />} onClick={() => setAddOpen(true)} data-add-fee>
            Add fee
          </Button>
          <Button variant="secondary" icon={<Copy aria-hidden />} onClick={() => setCopyOpen(true)}>
            Copy from…
          </Button>
          <Button variant="secondary" icon={<UsersRound aria-hidden />} onClick={() => setApplyOpen('button')} disabled={dirty || structure.rows.length === 0} title={dirty ? 'Save your changes first' : undefined}>
            Apply to students
          </Button>
        </div>
      </div>

      {blocks.length === 0 && (
        <Card>
          <EmptyState
            icon={<Sparkles aria-hidden />}
            title={`No fees set for ${structure.class.name} yet`}
            description="Add each fee this class pays (tuition, annual charges, transport…) with its amount and due dates, or copy the structure of another class."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button icon={<Plus aria-hidden />} onClick={() => setAddOpen(true)}>
                  Add fee
                </Button>
                <Button variant="secondary" icon={<Copy aria-hidden />} onClick={() => setCopyOpen(true)}>
                  Copy from another class
                </Button>
              </div>
            }
          />
        </Card>
      )}

      {blocks.map((b, i) => {
        const total = blockTotal(b);
        const invoiced = b.rows.reduce((n, r) => n + r.invoiced, 0);
        return (
          <Card key={b.feeHeadId} padded={false}>
            <div className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3 sm:px-5">
              <div className="mr-auto min-w-0">
                <p className="text-[15px] font-semibold">
                  {b.name} <span className="font-mono text-xs font-normal text-slate-500">{b.code}</span>
                </p>
                <p className="text-13 text-slate-500 dark:text-slate-400">
                  {FREQUENCY_SHORT[b.frequency]} · <span className="font-medium tabular-nums text-slate-700 dark:text-slate-200">{formatInr(total / 100)}</span> a year
                </p>
              </div>
              <Select label="Frequency" value={b.frequency} onChange={(e) => regenerate(i, e.target.value as Frequency)} className="w-40">
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {FREQUENCY_LABEL[f]}
                  </option>
                ))}
              </Select>
              <Button
                variant="ghost"
                icon={<Trash2 aria-hidden />}
                aria-label={`Remove ${b.name}`}
                onClick={() => setBlocks((bs) => bs.filter((_, k) => k !== i))}
                className="text-slate-500 hover:text-red-600"
              />
            </div>
            <div className="flex flex-wrap items-end gap-2 border-b border-line bg-surface-muted/40 px-4 py-2.5 sm:px-5">
              <Input label="₹ per instalment" inputMode="decimal" value={b.fillAmount} onChange={(e) => update(i, { fillAmount: e.target.value })} placeholder="18000" className="w-36" />
              <Input label="Due on day" inputMode="numeric" value={b.fillDay} onChange={(e) => update(i, { fillDay: e.target.value.replace(/\D/g, '').slice(0, 2) })} className="w-24" />
              <Button
                variant="secondary"
                icon={<Wand2 aria-hidden />}
                disabled={!RUPEES.test(clean(b.fillAmount))}
                onClick={() => regenerate(i, b.frequency, clean(b.fillAmount))}
              >
                Fill instalments
              </Button>
              <p className="w-full text-xs text-slate-500 dark:text-slate-400 sm:ml-2 sm:w-auto">Sets every instalment&apos;s amount and due date from the year start.</p>
            </div>
            <ul className="divide-y divide-line">
              {b.rows.map((r, j) => (
                <li key={r.installmentNo} className="grid grid-cols-2 items-start gap-x-3 gap-y-2 px-4 py-2.5 sm:grid-cols-[2.5rem_minmax(0,1fr)_10.5rem_9rem_minmax(0,12rem)] sm:items-center sm:px-5">
                  <span className="col-span-2 text-xs font-medium text-slate-500 sm:col-span-1 sm:text-sm">#{r.installmentNo}</span>
                  <Input aria-label={`Instalment ${r.installmentNo} label`} value={r.label} onChange={(e) => updateRow(i, j, { label: e.target.value })} maxLength={50} className="col-span-2 sm:col-span-1" />
                  <Input aria-label={`Instalment ${r.installmentNo} due date`} type="date" value={r.dueDate} onChange={(e) => updateRow(i, j, { dueDate: e.target.value })} className={cx(errors[`${i}.${j}.dueDate`] && 'border-red-500')} />
                  <Input
                    aria-label={`Instalment ${r.installmentNo} amount`}
                    inputMode="decimal"
                    value={r.amount}
                    placeholder="₹"
                    onChange={(e) => updateRow(i, j, { amount: e.target.value })}
                    className={cx('text-right tabular-nums', errors[`${i}.${j}.amount`] && 'border-red-500')}
                  />
                  <span className="col-span-2 text-xs text-slate-500 dark:text-slate-400 sm:col-span-1">
                    {r.allocations > 0 ? (
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        {r.allocations} student{r.allocations === 1 ? '' : 's'}
                        {r.invoiced > 0 && (
                          <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300" title="Invoiced instalments keep the amount they were billed at">
                            <Lock className="h-3 w-3" aria-hidden />
                            {r.invoiced} invoiced
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-slate-400">Not applied yet</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {invoiced > 0 && (
              <p className="border-t border-line px-4 py-2 text-xs text-amber-800 dark:text-amber-200 sm:px-5">
                <Lock className="mr-1 inline h-3 w-3" aria-hidden />
                Changing amounts updates only instalments not yet invoiced. {invoiced} invoiced instalment{invoiced === 1 ? '' : 's'} keep{invoiced === 1 ? 's' : ''} the billed amount.
              </p>
            )}
          </Card>
        );
      })}

      {blocks.length > 0 && (
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong px-4 py-3.5 text-sm font-medium text-slate-600 transition-colors hover:border-indigo-400 hover:bg-indigo-50/50 hover:text-indigo-800 dark:text-slate-300 dark:hover:bg-indigo-400/10 dark:hover:text-indigo-100"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add another fee
          {addable.length > 0 && <span className="font-normal text-slate-400">({addable.map((h) => h.name).slice(0, 3).join(', ')}{addable.length > 3 ? '…' : ''})</span>}
        </button>
      )}

      {byMonth.length > 0 && (
        <Card title="When parents pay" description="Total due per student, by the month it falls due">
          <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3 lg:grid-cols-4">
            {byMonth.map(([m, p]) => (
              <li key={m} className="flex justify-between gap-3 border-b border-dashed border-line py-1">
                <span className="text-slate-600 dark:text-slate-300">{formatMonth(m)}</span>
                <span className="font-medium tabular-nums">{formatInr(p / 100)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 flex justify-between border-t border-line pt-3 text-sm font-semibold">
            <span>Total for the year</span>
            <span className="tabular-nums">{formatInr(annual / 100)}</span>
          </p>
        </Card>
      )}

      {/* sticky save bar */}
      <div className={cx('sticky bottom-0 z-20 -mx-4 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border', !dirty && 'hidden')}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            Unsaved changes · <span className="font-semibold tabular-nums">{formatInr(annual / 100)}</span> a year
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                if (res.data) setBlocks(toBlocks(res.data.data));
                setErrors({});
              }}
            >
              Discard
            </Button>
            <Button loading={busy} onClick={onSave}>
              Save structure
            </Button>
          </div>
        </div>
      </div>

      <Modal
        open={!!confirm}
        size="sm"
        title={confirm && (confirm.impact.allocationsUpdated > 0 || confirm.impact.allocationsRemoved > 0) ? "Update students' dues?" : `Save ${structure.class.name} fees?`}
        onClose={busy ? () => undefined : () => setConfirm(null)}
        footer={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirm(null)}>
              Back to editing
            </Button>
            <Button loading={busy} onClick={() => confirm && commit(confirm.rows)} data-confirm-save>
              {confirm && (confirm.impact.allocationsUpdated > 0 || confirm.impact.allocationsRemoved > 0) ? 'Save and update' : 'Save fees'}
            </Button>
          </>
        }
      >
        {confirm && <ImpactSummary impact={confirm.impact} annual={confirm.annual} className={structure.class.name} />}
      </Modal>

      <ApplyModal
        open={applyOpen !== false}
        afterSave={applyOpen === 'after-save'}
        classId={classId}
        academicYearId={yearId}
        onClose={() => setApplyOpen(false)}
        onApplied={(text) => {
          setApplyOpen(false);
          flash('success', text);
          res.reload();
          onSaved();
        }}
      />
      <AddFeeModal
        open={addOpen}
        className={structure.class.name}
        yearId={yearId}
        heads={heads}
        used={usedHeads}
        onClose={() => setAddOpen(false)}
        onHeadCreated={() => onHeadsChanged?.()}
        onAdd={(block) => {
          setAddOpen(false);
          setBlocks((bs) => [...bs, block]);
          flash('info', `${block.name} added. Check the instalments, then press Save structure.`);
        }}
      />
      <CopyModal
        open={copyOpen}
        overview={overview}
        targetClassId={classId}
        targetHasRows={structure.rows.length > 0}
        onClose={() => setCopyOpen(false)}
        onCopied={(text) => {
          setCopyOpen(false);
          flash('success', text);
          res.reload();
          onSaved();
        }}
      />
    </div>
  );
}

// ------------------------------------------------------------------ apply to students

function ApplyModal({
  open,
  afterSave = false,
  classId,
  academicYearId,
  onClose,
  onApplied,
}: {
  open: boolean;
  /** Opened right after saving: say why. */
  afterSave?: boolean;
  classId: string;
  academicYearId: string;
  onClose: () => void;
  onApplied: (text: string) => void;
}) {
  const preview = useApi<{ data: ApplyPreview }>(open ? `/fees/structure/apply-preview${qs({ classId, academicYearId })}` : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [open]);
  const p = preview.data?.data;

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const r = await apiSend<{ data: { created: number; students: number; net: string } }>('POST', '/fees/structure/apply', { classId, academicYearId });
      onApplied(
        r.data.created
          ? `Created ${r.data.created} instalment dues for ${r.data.students} student${r.data.students === 1 ? '' : 's'} (${formatInr(r.data.net)} after concessions). They now show in Fee collection.`
          : 'Everyone already had these fees. Nothing to add.',
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const STATUS = { new: ['New', 'indigo'], partial: ['Some missing', 'amber'], up_to_date: ['Up to date', 'green'], no_structure: ['—', 'gray'] } as const;
  return (
    <Modal
      open={open}
      size="lg"
      title={p ? (afterSave ? `Apply to ${p.willChange} student${p.willChange === 1 ? '' : 's'} without these fees?` : `Apply ${p.class.name} fees to students`) : 'Apply fees to students'}
      description={
        afterSave
          ? `Saved. ${p ? `${p.willChange} student${p.willChange === 1 ? '' : 's'} of ${p.class.name} do${p.willChange === 1 ? 'es' : ''} not have these fees yet.` : ''} Create their instalment dues now so they show in Fee collection. Nothing already set up or invoiced is changed.`
          : "Creates each student's instalment dues from this structure. Nothing already set up or invoiced is changed."
      }
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {afterSave ? 'Not now' : 'Cancel'}
          </Button>
          <Button loading={busy} onClick={apply} disabled={!p || p.newAllocations === 0}>
            {p && p.newAllocations > 0 ? `Create dues for ${p.willChange} student${p.willChange === 1 ? '' : 's'}` : 'Nothing to apply'}
          </Button>
        </>
      }
    >
      {preview.loading && !p ? (
        <Spinner label="Working out who needs what…" />
      ) : preview.error ? (
        <ErrorState message={preview.error} onRetry={preview.reload} />
      ) : p ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Students', String(p.students)],
              ['Up to date', String(p.upToDate)],
              ['New dues', String(p.newAllocations)],
              ['Amount', formatInr(p.net)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-line px-3 py-2">
                <p className="text-xs text-slate-500 dark:text-slate-400">{k}</p>
                <p className="text-base font-semibold tabular-nums">{v}</p>
              </div>
            ))}
          </div>
          {p.students === 0 && <Notice tone="info">No students are enrolled in {p.class.name} this year yet. Admit students first, then apply.</Notice>}
          {p.withInvoices > 0 && <Notice tone="info">{p.withInvoices} student{p.withInvoices === 1 ? ' has' : 's have'} invoices already; their invoices are not touched, only missing instalments are added.</Notice>}
          {p.concession !== '0.00' && <p className="text-13 text-slate-500">Includes {formatInr(p.concession)} of recorded concessions.</p>}
          {p.rows.length > 0 && (
            <ul className="max-h-[45vh] divide-y divide-line overflow-y-auto rounded-lg border border-line">
              {p.rows.map((s) => {
                const [label, tone] = STATUS[s.status];
                return (
                  <li key={s.studentId} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{s.name}</span>
                      <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                        {s.admissionNumber}
                        {s.section ? ` · Section ${s.section}` : ''}
                        {s.hasInvoices ? ' · has invoices' : ''}
                      </span>
                    </span>
                    {s.newAllocations > 0 && (
                      <span className="text-right text-xs tabular-nums text-slate-600 dark:text-slate-300">
                        +{s.newAllocations} · {formatInr(s.net)}
                        {s.concession !== '0.00' && <span className="block text-emerald-700 dark:text-emerald-400">−{formatInr(s.concession)} concession</span>}
                      </span>
                    )}
                    <Badge tone={tone}>{label}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      ) : null}
    </Modal>
  );
}

// ------------------------------------------------------------------ copy

function CopyModal({
  open,
  overview,
  targetClassId,
  targetHasRows,
  onClose,
  onCopied,
}: {
  open: boolean;
  overview: Overview;
  targetClassId: string;
  targetHasRows: boolean;
  onClose: () => void;
  onCopied: (text: string) => void;
}) {
  const [fromClassId, setFromClassId] = useState('');
  const [fromYearId, setFromYearId] = useState(overview.academicYear.id);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const other = overview.classes.find((c) => c.id !== targetClassId && c.installments > 0);
    setFromClassId(other?.id ?? '');
    setFromYearId(overview.academicYear.id);
    setOverwrite(false);
    setError(null);
  }, [open, overview, targetClassId]);
  const source = useApi<{ data: Structure }>(open && fromClassId ? `/fees/structure${qs({ classId: fromClassId, academicYearId: fromYearId })}` : null);
  const same = fromClassId === targetClassId && fromYearId === overview.academicYear.id;
  const target = overview.classes.find((c) => c.id === targetClassId);

  async function copy() {
    setBusy(true);
    setError(null);
    try {
      const r = await apiSend<{ data: Structure }>('POST', '/fees/structure/copy', {
        fromClassId, fromAcademicYearId: fromYearId, toClassId: targetClassId, toAcademicYearId: overview.academicYear.id, overwrite,
      });
      onCopied(`Copied ${r.data.rows.length} instalments into ${r.data.class.name} (${formatInr(r.data.totals.annual)} a year). Due dates moved to ${r.data.academicYear.name}.`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const s = source.data?.data;
  return (
    <Modal
      open={open}
      title={`Copy a fee structure into ${target?.name ?? 'this class'}`}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button loading={busy} onClick={copy} disabled={!fromClassId || same || !s?.rows.length || (targetHasRows && !overwrite)}>
            Copy structure
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="From class" value={fromClassId} onChange={(e) => setFromClassId(e.target.value)}>
            <option value="">Choose…</option>
            {overview.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select label="Of year" value={fromYearId} onChange={(e) => setFromYearId(e.target.value)}>
            {overview.years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
                {y.isCurrent ? ' (current)' : ''}
              </option>
            ))}
          </Select>
        </div>
        {same && <Notice tone="warn">Pick another class or year.</Notice>}
        {source.loading && <Spinner label="Loading…" />}
        {s && !same && (
          s.rows.length === 0 ? (
            <Notice tone="info">{s.class.name} has no fee structure for {s.academicYear.name}.</Notice>
          ) : (
            <div className="rounded-lg border border-line p-3 text-sm">
              <p className="font-medium">
                {s.heads.length} fee head{s.heads.length === 1 ? '' : 's'}, {s.rows.length} instalments, {formatInr(s.totals.annual)} a year
              </p>
              <p className="mt-1 text-13 text-slate-500 dark:text-slate-400">{s.heads.map((h) => `${h.name} (${FREQUENCY_SHORT[h.frequency].toLowerCase()})`).join(', ')}</p>
              {fromYearId !== overview.academicYear.id && <p className="mt-1 text-13 text-slate-500">Due dates move forward to {overview.academicYear.name}.</p>}
            </div>
          )
        )}
        {targetHasRows && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
            <span>
              Replace {target?.name}&apos;s current structure
              <span className="block text-xs text-slate-500 dark:text-slate-400">Un-invoiced dues of its students follow the new amounts; invoiced ones stay as billed.</span>
            </span>
          </label>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}


// ------------------------------------------------------------------ save preview

function ImpactSummary({ impact: i, annual, className }: { impact: Impact; annual: string; className: string }) {
  const lines: ReactNode[] = [];
  if (i.rowsAdded) lines.push(<>{i.rowsAdded} new instalment{i.rowsAdded === 1 ? '' : 's'}</>);
  if (i.rowsChanged) lines.push(<>{i.rowsChanged} instalment{i.rowsChanged === 1 ? '' : 's'} changed</>);
  if (i.rowsRemoved) lines.push(<>{i.rowsRemoved} instalment{i.rowsRemoved === 1 ? '' : 's'} removed</>);
  return (
    <div className="space-y-3 text-sm" data-impact>
      <p>
        {className} will pay <strong className="tabular-nums">{formatInr(annual)}</strong> a year per student.
        {lines.length > 0 && <span className="block text-slate-500 dark:text-slate-400">{lines.map((l, k) => <span key={k}>{k > 0 ? ' · ' : ''}{l}</span>)}</span>}
      </p>
      <ul className="space-y-1.5">
        {i.allocationsUpdated > 0 && (
          <li>
            <strong className="tabular-nums">{i.allocationsUpdated}</strong> instalment{i.allocationsUpdated === 1 ? '' : 's'} not yet invoiced, for <strong>{i.studentsUpdated}</strong> student
            {i.studentsUpdated === 1 ? '' : 's'}, change to the new amount or due date.
          </li>
        )}
        {i.allocationsRemoved > 0 && (
          <li>
            <strong className="tabular-nums">{i.allocationsRemoved}</strong> un-invoiced instalment{i.allocationsRemoved === 1 ? '' : 's'} of removed rows will no longer be due.
          </li>
        )}
        {i.allocationsUpdated === 0 && i.allocationsRemoved === 0 && (
          <li className="text-slate-600 dark:text-slate-300">No student&apos;s dues change. Students who do not have these fees yet can get them with Apply to students.</li>
        )}
      </ul>
      {i.invoicedUnchanged > 0 && (
        <Notice tone="warn">
          {i.invoicedUnchanged} instalment{i.invoicedUnchanged === 1 ? ' is' : 's are'} already on an invoice and stay{i.invoicedUnchanged === 1 ? 's' : ''} exactly as billed.
        </Notice>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ add a fee

const NEW_HEAD = '__new__';

interface DraftRow {
  installmentNo: number;
  label: string;
  dueDate: string;
  amount: string;
}

/**
 * Add one fee to the class: pick a fee head (or name a new one), how often it is charged, the
 * amount per instalment and the due day; the instalments are generated from the academic year
 * and every due date / amount can be edited before adding. Nothing is saved until Save structure.
 */
function AddFeeModal({
  open,
  className,
  yearId,
  heads,
  used,
  onClose,
  onAdd,
  onHeadCreated,
}: {
  open: boolean;
  className: string;
  yearId: string;
  heads: FeeHead[];
  used: Set<string>;
  onClose: () => void;
  onAdd: (block: Block) => void;
  onHeadCreated: () => void;
}) {
  const addable = heads.filter((h) => h.isActive && !used.has(h.id));
  const [headId, setHeadId] = useState('');
  const [newName, setNewName] = useState('');
  const [frequency, setFrequency] = useState<Frequency>('quarterly');
  const [amount, setAmount] = useState('');
  const [dueDay, setDueDay] = useState('10');
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const first = addable[0];
    setHeadId(first ? first.id : NEW_HEAD);
    setNewName('');
    setFrequency(first ? first.defaultFrequency : 'quarterly');
    setAmount('');
    setDueDay('10');
    setErrors({});
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Instalments for the chosen frequency / amount / day (the server knows the academic year).
  const amountClean = clean(amount);
  const day = Math.min(31, Math.max(1, Number(dueDay) || 10));
  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoadingRows(true);
    const t = setTimeout(() => {
      schedule(frequency, RUPEES.test(amountClean) ? amountClean : '0', day, yearId)
        .then((r) => live && setRows(r.map((x) => ({ installmentNo: x.installmentNo, label: x.label, dueDate: x.dueDate, amount: RUPEES.test(amountClean) ? String(Number(x.amount)) : '' }))))
        .catch((err) => live && setError(errorText(err)))
        .finally(() => live && setLoadingRows(false));
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [open, frequency, amountClean, day, yearId]);

  const total = rows.reduce((n, r) => n + (RUPEES.test(clean(r.amount)) ? toPaise(clean(r.amount)) : 0), 0);
  const head = heads.find((h) => h.id === headId);

  async function add() {
    const e: Record<string, string> = {};
    if (headId === NEW_HEAD && newName.trim().length < 2) e.name = 'Name the fee (e.g. Smart class fee)';
    rows.forEach((r, j) => {
      if (!RUPEES.test(clean(r.amount))) e[`${j}.amount`] = 'Amount';
      if (!r.dueDate) e[`${j}.dueDate`] = 'Date';
    });
    if (rows.length === 0) e.amount = 'Enter an amount';
    else if (!RUPEES.test(amountClean) && rows.some((r) => !RUPEES.test(clean(r.amount)))) e.amount = 'Enter the amount per instalment';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setError(null);
    try {
      let h = head;
      if (headId === NEW_HEAD) {
        h = await createHeadInline(newName, frequency);
        onHeadCreated();
      }
      if (!h) return;
      onAdd({
        feeHeadId: h.id,
        name: h.name,
        code: h.code,
        frequency,
        fillAmount: '',
        fillDay: String(day),
        rows: rows.map((r) => ({ installmentNo: r.installmentNo, label: r.label, dueDate: r.dueDate, amount: clean(r.amount), allocations: 0, invoiced: 0 })),
      });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      size="lg"
      title={`Add a fee to ${className}`}
      description="Choose the fee, how often it is charged and how much; the instalments and due dates fill in for the whole academic year. You can change any date or amount."
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button loading={busy} onClick={add} disabled={loadingRows && rows.length === 0} data-add-fee-submit>
            Add to {className}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Fee head"
            value={headId}
            onChange={(e) => {
              setHeadId(e.target.value);
              const h = heads.find((x) => x.id === e.target.value);
              if (h) setFrequency(h.defaultFrequency);
            }}
          >
            {addable.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} ({FREQUENCY_SHORT[h.defaultFrequency]})
              </option>
            ))}
            <option value={NEW_HEAD}>+ New fee head…</option>
          </Select>
          {headId === NEW_HEAD ? (
            <Input label="Name of the new fee" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Smart class fee" maxLength={100} error={errors.name} />
          ) : (
            <Select label="Charged" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {FREQUENCY_LABEL[f]}
                </option>
              ))}
            </Select>
          )}
          {headId === NEW_HEAD && (
            <Select label="Charged" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {FREQUENCY_LABEL[f]}
                </option>
              ))}
            </Select>
          )}
          <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-3 sm:col-span-1">
            <Input label="₹ per instalment" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 4500" error={errors.amount} autoFocus />
            <Input label="Due on day" inputMode="numeric" value={dueDay} onChange={(e) => setDueDay(e.target.value.replace(/\D/g, '').slice(0, 2))} />
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-line">
          <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-muted px-3 py-2 text-13">
            <span className="font-medium">
              {rows.length} instalment{rows.length === 1 ? '' : 's'} · {FREQUENCY_SHORT[frequency].toLowerCase()}
            </span>
            <span className="tabular-nums text-slate-600 dark:text-slate-300">
              Total a year <strong className="text-slate-900 dark:text-white">{formatInr(total / 100)}</strong>
            </span>
          </div>
          {loadingRows && rows.length === 0 ? (
            <Spinner label="Working out the due dates…" />
          ) : (
            <ul className={cx('max-h-[40vh] divide-y divide-line overflow-y-auto', loadingRows && 'opacity-60')}>
              {rows.map((r, j) => (
                <li key={r.installmentNo} className="grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 px-3 py-2 sm:grid-cols-[2rem_minmax(0,1fr)_10rem_8rem]">
                  <span className="text-xs font-medium text-slate-500">#{r.installmentNo}</span>
                  <span className="col-span-2 truncate text-sm sm:col-span-1">{r.label}</span>
                  <Input
                    aria-label={`Instalment ${r.installmentNo} due date`}
                    type="date"
                    value={r.dueDate}
                    onChange={(e) => setRows((rs) => rs.map((x, k) => (k === j ? { ...x, dueDate: e.target.value } : x)))}
                    className={cx('col-start-2 sm:col-start-auto', errors[`${j}.dueDate`] && 'border-red-500')}
                  />
                  <Input
                    aria-label={`Instalment ${r.installmentNo} amount`}
                    inputMode="decimal"
                    value={r.amount}
                    placeholder="₹"
                    onChange={(e) => setRows((rs) => rs.map((x, k) => (k === j ? { ...x, amount: e.target.value } : x)))}
                    className={cx('text-right tabular-nums', errors[`${j}.amount`] && 'border-red-500')}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}
