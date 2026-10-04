'use client';

import { useEffect, useMemo, useState } from 'react';
import { Users, UserRound } from 'lucide-react';
import { Button, Input, Modal, Notice, Select, Spinner, cx } from '@/components/ui';
import { useClassOptions } from '@/components/filters';
import { apiSend } from '@/lib/session';
import { formatDate, formatInr } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { StudentPicker, errorText, fieldErrors, todayLocal } from '@/features/admin/shared';
import type { StudentRow } from '@/features/admin/types';
import { createHeadInline } from './heads';
import type { FeeHead } from './setup/types';

/**
 * "Add charge": a one-off amount (exam fee, picnic, lost ID card…) billed to one student or to
 * every current student of a class / section, as one invoice each (POST /fees/charges).
 * The preview (dryRun) shows how many students and the total before anything is billed;
 * one batchId per opening makes a double click or retry harmless.
 */

export interface ChargeResult {
  invoicesCreated: number;
  alreadyCharged: number;
  students: number;
  total: string;
  amount: string;
  description: string;
  target: { label: string; classId?: string; sectionId?: string; studentId?: string };
}

interface Preview {
  students: number;
  alreadyCharged: number;
  invoicesToCreate: number;
  total: string;
  target: { label: string };
  preview: Array<{ id: string; name: string; admissionNumber: string; classLabel: string | null }>;
}

const NEW_HEAD = '__new__';
const RUPEES = /^\d+(\.\d{1,2})?$/;

function newBatchId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // Fallback for very old browsers: RFC 4122 v4 from Math.random.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function addDaysIso(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function AddChargeModal({
  open,
  onClose,
  onDone,
  student,
  defaultClassId = '',
  defaultSectionId = '',
}: {
  open: boolean;
  onClose: () => void;
  onDone: (r: ChargeResult) => void;
  /** Charge this student only (student profile). */
  student?: { id: string; name: string; classLabel?: string | null };
  /** Start with this class / section (the Fee collection filters). */
  defaultClassId?: string;
  defaultSectionId?: string;
}) {
  const fixed = Boolean(student);
  const [mode, setMode] = useState<'class' | 'student'>('class');
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [picked, setPicked] = useState<StudentRow | null>(null);
  const [headId, setHeadId] = useState('');
  const [newHead, setNewHead] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [batchId, setBatchId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const cls = useClassOptions(open && !fixed);
  const headsRes = useApi<{ data: FeeHead[] }>(open ? '/fees/heads' : null);
  const heads = (headsRes.data?.data ?? []).filter((h) => h.isActive);

  useEffect(() => {
    if (!open) return;
    setMode(fixed ? 'student' : defaultClassId ? 'class' : 'class');
    setClassId(defaultClassId);
    setSectionId(defaultSectionId);
    setPicked(null);
    setHeadId('');
    setNewHead('');
    setDescription('');
    setAmount('');
    setDueDate(addDaysIso(todayLocal(), 14));
    setBatchId(newBatchId());
    setErrors({});
    setError(null);
    setPreview(null);
  }, [open, fixed, defaultClassId, defaultSectionId]);

  const scope = useMemo(() => {
    if (fixed) return { studentId: student!.id };
    if (mode === 'student') return picked ? { studentId: picked.id } : null;
    return classId ? { classId, ...(sectionId ? { sectionId } : {}) } : null;
  }, [fixed, student, mode, picked, classId, sectionId]);

  const amountClean = amount.replace(/[,₹\s]/g, '');
  const amountOk = RUPEES.test(amountClean) && Number(amountClean) > 0;
  const headOk = headId === NEW_HEAD ? newHead.trim().length >= 2 : Boolean(headId);
  const realHeadId = headId === NEW_HEAD ? '' : headId;

  // Live preview (dry run) once who + head + amount are known. A new head is previewed with any head.
  const previewKey = scope && amountOk && dueDate && (realHeadId || heads[0]) ? JSON.stringify([scope, realHeadId || heads[0]?.id, amountClean, dueDate]) : '';
  useEffect(() => {
    if (!open || !previewKey) {
      setPreview(null);
      return;
    }
    const [sc, hid, amt, due] = JSON.parse(previewKey) as [Record<string, string>, string, string, string];
    let live = true;
    setPreviewing(true);
    const t = setTimeout(() => {
      apiSend<{ data: Preview }>('POST', '/fees/charges', { scope: sc, feeHeadId: hid, description: description.trim().length >= 2 ? description.trim() : 'Preview', amount: amt, dueDate: due, batchId: batchId || undefined, dryRun: true })
        .then((r) => live && (setPreview(r.data), setError(null)))
        .catch((err) => live && (setPreview(null), setError(errorText(err))))
        .finally(() => live && setPreviewing(false));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // description only changes the label of the preview request
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, previewKey, batchId]);

  async function submit() {
    const e: Record<string, string> = {};
    if (!scope) e.scope = mode === 'student' ? 'Choose a student' : 'Choose a class';
    if (!headOk) e.feeHead = headId === NEW_HEAD ? 'Name the new fee head' : 'Choose a fee head';
    if (description.trim().length < 2) e.description = 'What is this charge for?';
    if (!amountOk) e.amount = 'Enter an amount in rupees, e.g. 450';
    if (!dueDate) e.dueDate = 'Required';
    setErrors(e);
    if (Object.keys(e).length || !scope) return;
    setBusy(true);
    setError(null);
    try {
      let feeHeadId = realHeadId;
      if (headId === NEW_HEAD) {
        const h = await createHeadInline(newHead, 'one_time');
        feeHeadId = h.id;
        setHeadId(h.id);
        headsRes.reload();
      }
      const r = await apiSend<{ data: ChargeResult }>('POST', '/fees/charges', {
        scope, feeHeadId, description: description.trim(), amount: amountClean, dueDate, batchId,
      });
      onDone(r.data);
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const who = fixed ? student!.name : preview?.target.label;
  const count = preview?.invoicesToCreate ?? 0;
  const confirmLabel = !preview ? 'Add charge' : count === 0 ? 'Already charged' : count === 1 ? `Charge ${formatInr(amountClean)}` : `Charge ${count} students`;

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={fixed ? `Add a charge for ${student!.name}` : 'Add a one-off charge'}
      description="An extra amount on top of the class fees: exam fee, picnic, lost ID card, lab breakage… Each student gets an invoice that shows in Fee collection and in the parent app."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={Boolean(preview && count === 0)} data-charge-submit>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!fixed && (
          <div role="radiogroup" aria-label="Charge to" className="grid grid-cols-2 gap-2">
            {(
              [
                ['class', 'A class or section', Users],
                ['student', 'One student', UserRound],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                onClick={() => setMode(value)}
                className={cx(
                  'flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition-colors',
                  mode === value ? 'border-indigo-500 bg-indigo-50 text-indigo-900 ring-1 ring-indigo-500 dark:bg-indigo-400/10 dark:text-indigo-100' : 'border-line hover:border-slate-300',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {label}
              </button>
            ))}
          </div>
        )}

        {!fixed && mode === 'class' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Class" value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId(''); }} error={errors.scope}>
              <option value="">{cls.loading ? 'Loading…' : 'Choose a class'}</option>
              {cls.classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} disabled={!classId}>
              <option value="">Whole class</option>
              {(cls.classes.find((c) => c.id === classId)?.sections ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
        )}

        {!fixed && mode === 'student' && (
          picked ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-medium">{picked.name}</span>
                <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                  {[picked.class?.name, picked.section?.name].filter(Boolean).join(' ') || 'No class'}, {picked.admissionNumber}
                </span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => setPicked(null)}>
                Change
              </Button>
            </div>
          ) : (
            <div>
              <StudentPicker onPick={setPicked} autoFocus={false} />
              {errors.scope && <p className="mt-1 text-xs text-red-600">{errors.scope}</p>}
            </div>
          )
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Fee head" value={headId} onChange={(e) => setHeadId(e.target.value)} error={errors.feeHead ?? errors.feeHeadId}>
            <option value="">{headsRes.loading ? 'Loading…' : heads.length ? 'Choose a fee head…' : 'No fee heads yet'}</option>
            {heads.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
            <option value={NEW_HEAD}>+ New fee head…</option>
          </Select>
          {headId === NEW_HEAD ? (
            <Input label="New fee head name" value={newHead} onChange={(e) => setNewHead(e.target.value)} placeholder="e.g. Picnic and trips" maxLength={100} error={errors.feeHead} />
          ) : (
            <div className="hidden sm:block" />
          )}
          <Input
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Annual picnic to Sariska"
            maxLength={255}
            error={errors.description}
            hint="Printed on the invoice and shown to parents."
            className="sm:col-span-2"
          />
          <Input label="Amount per student (₹)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="450" error={errors.amount} />
          <Input label="Due date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} error={errors.dueDate} />
        </div>

        <div aria-live="polite" className="min-h-[3rem]" data-charge-preview>
          {previewing && !preview ? (
            <Spinner label="Working out who gets billed…" />
          ) : preview ? (
            <div className="rounded-lg border border-line bg-surface-muted/50 px-3 py-2.5 text-sm">
              {preview.students === 0 ? (
                <p>No current students in {preview.target.label}.</p>
              ) : (
                <>
                  <p>
                    <strong className="tabular-nums">{preview.invoicesToCreate}</strong> {preview.invoicesToCreate === 1 ? 'invoice' : 'invoices'} of{' '}
                    <strong className="tabular-nums">{formatInr(amountClean)}</strong>
                    {who ? <> for {who}</> : null}, due {formatDate(dueDate)} · total <strong className="tabular-nums">{formatInr(preview.total)}</strong>
                  </p>
                  {preview.alreadyCharged > 0 && (
                    <p className="mt-1 text-13 text-slate-500 dark:text-slate-400">
                      {preview.alreadyCharged} already charged in this batch and skipped.
                    </p>
                  )}
                  {!fixed && preview.preview.length > 1 && (
                    <p className="mt-1 truncate text-13 text-slate-500 dark:text-slate-400">
                      {preview.preview.slice(0, 4).map((s) => s.name).join(', ')}
                      {preview.students > 4 ? ` and ${preview.students - 4} more` : ''}
                    </p>
                  )}
                </>
              )}
            </div>
          ) : null}
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}
