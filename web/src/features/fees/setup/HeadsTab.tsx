'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, Notice, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { apiSend } from '@/lib/session';
import { ConfirmModal, errorText, fieldErrors } from '@/features/admin/shared';
import { FREQUENCY_SHORT, RECURRING, type FeeHead, type Frequency } from './types';

export default function HeadsTab({
  heads,
  loading,
  error,
  reload,
  flash,
}: {
  heads: FeeHead[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  flash: (tone: 'success' | 'error', text: ReactNode) => void;
}) {
  const [editing, setEditing] = useState<{ open: boolean; head: FeeHead | null }>({ open: false, head: null });
  const [deleting, setDeleting] = useState<FeeHead | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function toggle(h: FeeHead) {
    try {
      await apiSend('PATCH', `/fees/heads/${h.id}`, { isActive: !h.isActive });
      flash('success', `${h.name} is now ${h.isActive ? 'inactive' : 'active'}.`);
      reload();
    } catch (err) {
      flash('error', errorText(err));
    }
  }

  async function doDelete() {
    if (!deleting) return;
    setBusy(true);
    setDeleteError(null);
    try {
      await apiSend('DELETE', `/fees/heads/${deleting.id}`);
      flash('success', `Deleted ${deleting.name}.`);
      setDeleting(null);
      reload();
    } catch (err) {
      setDeleteError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      padded={false}
      title="Fee heads"
      description="The kinds of fee the school charges. Each class then sets how much of each it pays."
      actions={
        <Button icon={<Plus aria-hidden />} onClick={() => setEditing({ open: true, head: null })}>
          Add fee head
        </Button>
      }
    >
      {loading && heads.length === 0 ? (
        <Spinner />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : heads.length === 0 ? (
        <EmptyState title="No fee heads yet" description="Start with Tuition, then add Admission fee, Annual charges, Transport…" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Fee head</Th>
              <Th>Type</Th>
              <Th>Used in</Th>
              <Th>Status</Th>
              <Th align="right">
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {heads.map((h) => (
              <tr key={h.id}>
                <Td>
                  <p className="min-w-[10rem] font-medium">
                    {h.name} <span className="font-mono text-xs font-normal text-slate-500">{h.code}</span>
                  </p>
                  <p className="flex flex-wrap gap-1.5 pt-1">
                    {h.refundable && <Badge tone="amber">Refundable</Badge>}
                    {h.optional && <Badge>Optional</Badge>}
                  </p>
                </Td>
                <Td className="whitespace-nowrap">{h.type === 'one_time' ? 'One-time' : `Recurring · ${FREQUENCY_SHORT[h.defaultFrequency].toLowerCase()}`}</Td>
                <Td className="whitespace-nowrap text-slate-600 dark:text-slate-300">
                  {h.usage?.classes ? `${h.usage.classes} class${h.usage.classes === 1 ? '' : 'es'}` : '—'}
                  {h.usage?.allocations ? <span className="block text-xs text-slate-500">{h.usage.allocations} student dues</span> : null}
                </Td>
                <Td>
                  <button type="button" onClick={() => toggle(h)} title={h.isActive ? 'Deactivate' : 'Activate'}>
                    <Badge tone={h.isActive ? 'green' : 'gray'} dot>
                      {h.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </button>
                </Td>
                <Td align="right" className="whitespace-nowrap">
                  <Button variant="ghost" size="sm" icon={<Pencil aria-hidden />} aria-label={`Edit ${h.name}`} onClick={() => setEditing({ open: true, head: h })} />
                  {!h.usage?.classes && !h.usage?.allocations && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Trash2 aria-hidden />}
                      aria-label={`Delete ${h.name}`}
                      className="text-slate-500 hover:text-red-600"
                      onClick={() => {
                        setDeleteError(null);
                        setDeleting(h);
                      }}
                    />
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <HeadModal
        open={editing.open}
        head={editing.head}
        onClose={() => setEditing({ open: false, head: null })}
        onSaved={(h) => {
          setEditing({ open: false, head: null });
          flash('success', `Saved ${h.name}.`);
          reload();
        }}
      />
      <ConfirmModal open={!!deleting} title="Delete this fee head?" confirmLabel="Delete" busy={busy} error={deleteError} onConfirm={doDelete} onClose={() => setDeleting(null)}>
        <p>
          <strong>{deleting?.name}</strong> has never been used, so it can be deleted. A head that was used can only be deactivated.
        </p>
      </ConfirmModal>
    </Card>
  );
}

function HeadModal({ open, head, onClose, onSaved }: { open: boolean; head: FeeHead | null; onClose: () => void; onSaved: (h: FeeHead) => void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [type, setType] = useState<'recurring' | 'one_time'>('recurring');
  const [frequency, setFrequency] = useState<Frequency>('quarterly');
  const [refundable, setRefundable] = useState(false);
  const [optional, setOptional] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(head?.name ?? '');
    setCode(head?.code ?? '');
    setType(head?.type ?? 'recurring');
    setFrequency(head && head.defaultFrequency !== 'one_time' ? head.defaultFrequency : 'quarterly');
    setRefundable(head?.refundable ?? false);
    setOptional(head?.optional ?? false);
    setErrors({});
    setError(null);
  }, [open, head]);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (name.trim().length < 2) e.name = 'At least 2 characters';
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,29}$/.test(code.trim())) e.code = 'Letters, digits, - or _ (e.g. TUI)';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setError(null);
    const body = { name: name.trim(), code: code.trim(), type, ...(type === 'recurring' && { defaultFrequency: frequency }), refundable, optional };
    try {
      const res = head ? await apiSend<{ data: FeeHead }>('PATCH', `/fees/heads/${head.id}`, body) : await apiSend<{ data: FeeHead }>('POST', '/fees/heads', body);
      onSaved(res.data);
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title={head ? `Edit ${head.name}` : 'Add fee head'}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="head-form" loading={busy}>
            {head ? 'Save changes' : 'Add fee head'}
          </Button>
        </>
      }
    >
      <form id="head-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} maxLength={100} placeholder="e.g. Annual charges" />
        <Input label="Code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} error={errors.code} maxLength={30} placeholder="e.g. ANN" hint="Short code printed on receipts" />
        <Select label="Type" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          <option value="recurring">Recurring</option>
          <option value="one_time">One-time (admission, caution deposit)</option>
        </Select>
        {type === 'recurring' && (
          <Select label="Usually charged" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)} hint="Default when you add it to a class">
            {RECURRING.map((f) => (
              <option key={f} value={f}>
                {FREQUENCY_SHORT[f]}
              </option>
            ))}
          </Select>
        )}
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="mt-0.5" checked={refundable} onChange={(e) => setRefundable(e.target.checked)} />
          <span>
            Refundable
            <span className="block text-xs text-slate-500 dark:text-slate-400">Returned when the student leaves (e.g. caution deposit).</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="mt-0.5" checked={optional} onChange={(e) => setOptional(e.target.checked)} />
          <span>
            Optional
            <span className="block text-xs text-slate-500 dark:text-slate-400">Not every student pays it (e.g. transport, hostel).</span>
          </span>
        </label>
        {error && (
          <div className="sm:col-span-2">
            <Notice tone="error">{error}</Notice>
          </div>
        )}
      </form>
    </Modal>
  );
}
