'use client';

/** Bonafide and transfer-certificate issue dialogs, shared by the student profile and the certificate register. */

import { useEffect, useState, type FormEvent } from 'react';
import { FileDown } from 'lucide-react';
import { Button, Input, Modal, Notice, Select, Textarea } from '@/components/ui';
import { apiSend, openPdf } from '@/lib/session';
import { errorCode, errorText, fieldErrors, todayLocal } from '../shared';
import type { IssuedCertificate, Wrapped } from '../types';

export interface CertStudent {
  id: string;
  name: string;
}

function IssuedView({ cert, onClose }: { cert: IssuedCertificate; onClose: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <Notice tone="success">
        {cert.type === 'bonafide' ? 'Bonafide certificate' : 'Transfer certificate'} <strong>{cert.number}</strong> issued.
      </Notice>
      {err && <Notice tone="error">{err}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button icon={<FileDown className="h-4 w-4" aria-hidden />} onClick={() => openPdf(`/documents/certificates/${cert.id}/pdf`, `${cert.number.replace(/\//g, '-')}.pdf`).catch((e) => setErr(errorText(e)))}>
          Open PDF
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

export function BonafideModal({ student, open, onClose, onIssued }: { student: CertStudent | null; open: boolean; onClose: () => void; onIssued?: (c: IssuedCertificate) => void }) {
  const [purpose, setPurpose] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedCertificate | null>(null);

  useEffect(() => {
    if (open) {
      setPurpose('');
      setError(null);
      setFieldErr(null);
      setIssued(null);
    }
  }, [open, student?.id]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!student) return;
    if (purpose.trim().length < 3) {
      setFieldErr('Say what the certificate is for, e.g. “Passport application”.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<Wrapped<IssuedCertificate>>('POST', `/documents/students/${student.id}/bonafide`, { purpose: purpose.trim() });
      setIssued(res.data);
      onIssued?.(res.data);
    } catch (err) {
      setFieldErr(fieldErrors(err).purpose ?? null);
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={`Bonafide certificate${student ? ` for ${student.name}` : ''}`}
      size="sm"
      footer={
        issued ? undefined : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" form="bonafide-form" loading={busy}>
              Issue certificate
            </Button>
          </>
        )
      }
    >
      {issued ? (
        <IssuedView cert={issued} onClose={onClose} />
      ) : (
        <form id="bonafide-form" onSubmit={submit} className="space-y-4" noValidate>
          <Input label="Purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={150} placeholder="e.g. Passport application" error={fieldErr} hint="Printed on the certificate." required />
          {error && !fieldErr && <Notice tone="error">{error}</Notice>}
        </form>
      )}
    </Modal>
  );
}

interface TcForm {
  applicationDate: string;
  leavingDate: string;
  reasonForLeaving: string;
  generalConduct: string;
  nccScoutGuide: string;
  gamesActivities: string;
  otherRemarks: string;
  lastExamResult: string;
  qualifiedForPromotion: string;
}

const EMPTY_TC = (): TcForm => ({
  applicationDate: todayLocal(),
  leavingDate: todayLocal(),
  reasonForLeaving: '',
  generalConduct: 'Good',
  nccScoutGuide: '',
  gamesActivities: '',
  otherRemarks: '',
  lastExamResult: '',
  qualifiedForPromotion: '',
});

export function TcModal({ student, open, onClose, onIssued }: { student: CertStudent | null; open: boolean; onClose: () => void; onIssued?: (c: IssuedCertificate) => void }) {
  const [form, setForm] = useState<TcForm>(EMPTY_TC);
  const [ack, setAck] = useState(false);
  const [duesBlock, setDuesBlock] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [issued, setIssued] = useState<IssuedCertificate | null>(null);

  useEffect(() => {
    if (open) {
      setForm(EMPTY_TC());
      setAck(false);
      setDuesBlock(null);
      setError(null);
      setErrors({});
      setIssued(null);
    }
  }, [open, student?.id]);

  const set = (k: keyof TcForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!student) return;
    const local: Record<string, string> = {};
    if (!form.applicationDate) local.applicationDate = 'Required';
    if (form.reasonForLeaving.trim().length < 2) local.reasonForLeaving = 'Give the reason for leaving';
    if (form.leavingDate && form.applicationDate && form.leavingDate < form.applicationDate) local.leavingDate = 'Leaving date cannot be before the application';
    setErrors(local);
    if (Object.keys(local).length) return;

    const body: Record<string, string | boolean> = { applicationDate: form.applicationDate, reasonForLeaving: form.reasonForLeaving.trim(), acknowledgeDues: ack };
    for (const k of ['leavingDate', 'generalConduct', 'nccScoutGuide', 'gamesActivities', 'otherRemarks', 'lastExamResult', 'qualifiedForPromotion'] as const) {
      if (form[k].trim()) body[k] = form[k].trim();
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<Wrapped<IssuedCertificate>>('POST', `/documents/students/${student.id}/transfer-certificate`, body);
      setIssued(res.data);
      onIssued?.(res.data);
    } catch (err) {
      setErrors(fieldErrors(err));
      if (errorCode(err) === 'DUES_OUTSTANDING') {
        setDuesBlock(errorText(err));
        setError(null);
      } else {
        setError(errorText(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={`Transfer certificate${student ? ` for ${student.name}` : ''}`}
      size="lg"
      footer={
        issued ? undefined : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" form="tc-form" variant="danger" loading={busy} disabled={!!duesBlock && !ack}>
              Issue TC
            </Button>
          </>
        )
      }
    >
      {issued ? (
        <IssuedView cert={issued} onClose={onClose} />
      ) : (
        <form id="tc-form" onSubmit={submit} className="space-y-4" noValidate>
          <Notice tone="warn">Issuing a TC marks the student as transferred. They leave the class lists, attendance registers and fee runs.</Notice>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Application date" type="date" value={form.applicationDate} onChange={set('applicationDate')} error={errors.applicationDate} required />
            <Input label="Date of leaving" type="date" value={form.leavingDate} onChange={set('leavingDate')} error={errors.leavingDate} />
            <Input label="Reason for leaving" value={form.reasonForLeaving} onChange={set('reasonForLeaving')} maxLength={200} placeholder="e.g. Family relocating to Pune" error={errors.reasonForLeaving} className="sm:col-span-2" required />
            <Select label="General conduct" value={form.generalConduct} onChange={set('generalConduct')} error={errors.generalConduct}>
              {['Excellent', 'Very good', 'Good', 'Satisfactory'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
            <Input label="NCC / Scout / Guide" value={form.nccScoutGuide} onChange={set('nccScoutGuide')} maxLength={120} placeholder="Optional" error={errors.nccScoutGuide} />
            <Input label="Games and activities" value={form.gamesActivities} onChange={set('gamesActivities')} maxLength={250} placeholder="Optional" error={errors.gamesActivities} className="sm:col-span-2" />
            <Input label="Last exam result (override)" value={form.lastExamResult} onChange={set('lastExamResult')} maxLength={200} hint="Leave blank to use the report cards." error={errors.lastExamResult} />
            <Input label="Qualified for promotion (override)" value={form.qualifiedForPromotion} onChange={set('qualifiedForPromotion')} maxLength={120} hint="Leave blank to work it out." error={errors.qualifiedForPromotion} />
            <Textarea label="Other remarks" value={form.otherRemarks} onChange={set('otherRemarks')} maxLength={250} rows={2} error={errors.otherRemarks} className="sm:col-span-2" />
          </div>
          {duesBlock && (
            <Notice tone="warn">
              <p>{duesBlock}</p>
              <label className="mt-2 flex items-center gap-2 font-medium">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                Issue anyway, with the dues recorded on the TC
              </label>
            </Notice>
          )}
          {error && <Notice tone="error">{error}</Notice>}
        </form>
      )}
    </Modal>
  );
}
