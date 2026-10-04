'use client';

import { useEffect, useState } from 'react';
import DateField from '@/components/DateField';
import { Button, Modal, Notice, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { useClassOptions } from '@/components/filters';
import { apiSend } from '@/lib/session';
import { formatDate, formatInr } from '@/lib/format';
import { errorText, todayLocal } from '@/features/admin/shared';
import type { BulkBillResult } from './api';

/**
 * "Generate bills": bills every un-invoiced instalment due on or before a date for a class /
 * section (POST /fees/invoices/bulk), so parents can pay in advance online. The preview
 * (dryRun) lists who gets which bill; applying twice never bills an instalment twice.
 */

function addDaysIso(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function BulkBillModal({
  open,
  onClose,
  onDone,
  defaultClassId = '',
  defaultSectionId = '',
}: {
  open: boolean;
  onClose: () => void;
  onDone: (r: BulkBillResult) => void;
  defaultClassId?: string;
  defaultSectionId?: string;
}) {
  const cls = useClassOptions(open);
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [billUpTo, setBillUpTo] = useState('');
  const [preview, setPreview] = useState<BulkBillResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setClassId(defaultClassId);
    setSectionId(defaultSectionId);
    setBillUpTo(addDaysIso(todayLocal(), 30));
    setPreview(null);
    setError(null);
  }, [open, defaultClassId, defaultSectionId]);

  const key = open && classId && billUpTo ? JSON.stringify([classId, sectionId, billUpTo]) : '';
  useEffect(() => {
    if (!key) {
      setPreview(null);
      return;
    }
    const [c, s, d] = JSON.parse(key) as [string, string, string];
    let live = true;
    setPreviewing(true);
    const t = setTimeout(() => {
      apiSend<{ data: BulkBillResult }>('POST', '/fees/invoices/bulk', { classId: c, ...(s ? { sectionId: s } : {}), billUpTo: d, dryRun: true })
        .then((r) => live && (setPreview(r.data), setError(null)))
        .catch((err) => live && (setPreview(null), setError(errorText(err))))
        .finally(() => live && setPreviewing(false));
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [key]);

  async function apply() {
    if (!classId || !billUpTo) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiSend<{ data: BulkBillResult }>('POST', '/fees/invoices/bulk', { classId, ...(sectionId ? { sectionId } : {}), billUpTo });
      onDone(r.data);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const count = preview?.invoicesToCreate ?? 0;
  const sections = cls.classes.find((c) => c.id === classId)?.sections ?? [];

  return (
    <Modal
      open={open}
      size="lg"
      onClose={busy ? () => undefined : onClose}
      title="Generate bills for upcoming instalments"
      description="Bills every instalment of the class fees that is due on or before the date and not billed yet, one bill per student. Parents can then pay them online in advance."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={apply} loading={busy} disabled={!preview || count === 0 || previewing} data-bulk-apply>
            {!preview ? 'Generate bills' : count === 0 ? 'Nothing to bill' : `Generate ${count} ${count === 1 ? 'bill' : 'bills'} · ${formatInr(preview.total)}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Select label="Class" value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId(''); }} data-bulk-class>
            <option value="">{cls.loading ? 'Loading…' : 'Choose a class'}</option>
            {cls.classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} disabled={!classId} data-bulk-section>
            <option value="">Whole class</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <DateField label="Bill instalments due up to" value={billUpTo} onChange={setBillUpTo} />
        </div>

        <div aria-live="polite" data-bulk-preview>
          {!classId ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Choose a class to see who would be billed.</p>
          ) : previewing && !preview ? (
            <Spinner label="Working out the bills…" />
          ) : preview ? (
            <div className="space-y-3">
              <p className="text-sm">
                {preview.students === 0 ? (
                  <>No current students in {preview.target.label}.</>
                ) : (
                  <>
                    <strong className="tabular-nums">{count}</strong> of {preview.students} students in {preview.target.label} get a bill, due up to {formatDate(preview.billUpTo)}: total{' '}
                    <strong className="tabular-nums">{formatInr(preview.total)}</strong>.
                    {preview.alreadyBilled > 0 && <span className="text-slate-500 dark:text-slate-400"> {preview.alreadyBilled} already billed.</span>}
                    {preview.nothingDue > 0 && <span className="text-slate-500 dark:text-slate-400"> {preview.nothingDue} with nothing due by then.</span>}
                  </>
                )}
              </p>
              {count > 0 && (
                <div className="max-h-[42vh] overflow-y-auto rounded-lg border border-line">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Student</Th>
                        <Th>Bill</Th>
                        <Th>Due</Th>
                        <Th align="right">Amount</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.preview!.map((p) => (
                        <tr key={p.studentId}>
                          <Td>
                            <span className="block font-medium">{p.name}</span>
                            <span className="block text-xs tabular-nums text-slate-500 dark:text-slate-400">{p.admissionNumber}</span>
                          </Td>
                          <Td>
                            <span className="block">{p.periodLabel}</span>
                            <span className="block text-xs text-slate-500 dark:text-slate-400">{p.lines.map((l) => l.feeHead).join(' + ')}</span>
                          </Td>
                          <Td className="whitespace-nowrap">{formatDate(p.dueDate)}</Td>
                          <Td align="right">{formatInr(p.amount)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
              {count > 0 && (preview.invoicesToCreate ?? 0) > (preview.preview?.length ?? 0) && (
                <p className="text-13 text-slate-500 dark:text-slate-400">Showing the first {preview.preview?.length}.</p>
              )}
            </div>
          ) : null}
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}
