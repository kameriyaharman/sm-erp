'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button, Input, Modal, Notice, Select } from '@/components/ui';
import { apiSend } from '@/lib/session';
import { errorCode, errorText, fieldErrors, todayLocal, type FlatSection } from '../shared';
import { SOCIAL_CATEGORIES, type StudentDetail, type Wrapped } from '../types';

type Form = {
  firstName: string;
  lastName: string;
  gender: string;
  dateOfBirth: string;
  sectionId: string;
  rollNumber: string;
  fatherName: string;
  motherName: string;
  guardianName: string;
  socialCategory: string;
  penNumber: string;
  apaarId: string;
  parentPhone: string;
};

function fromStudent(s: StudentDetail): Form {
  return {
    firstName: s.firstName ?? '',
    lastName: s.lastName ?? '',
    gender: s.gender,
    dateOfBirth: s.dateOfBirth?.slice(0, 10) ?? '',
    sectionId: s.section?.id ?? '',
    rollNumber: s.rollNumber ?? '',
    fatherName: s.fatherName ?? '',
    motherName: s.motherName ?? '',
    guardianName: s.guardianName ?? '',
    socialCategory: s.socialCategory ?? '',
    penNumber: s.penNumber ?? '',
    apaarId: s.apaarId ?? '',
    parentPhone: s.parent?.phone ?? '',
  };
}

export default function EditStudentModal({
  student,
  sections,
  open,
  onClose,
  onSaved,
}: {
  student: StudentDetail;
  sections: FlatSection[];
  open: boolean;
  onClose: () => void;
  onSaved: (s: StudentDetail) => void;
}) {
  const [form, setForm] = useState<Form>(() => fromStudent(student));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(fromStudent(student));
      setErrors({});
      setError(null);
    }
  }, [open, student]);

  const sameClass = useMemo(() => sections.filter((s) => s.classId === student.class?.id), [sections, student.class?.id]);
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const original = fromStudent(student);
    const local: Record<string, string> = {};
    if (!form.firstName.trim()) local.firstName = 'First name is required';
    if (form.apaarId && !/^\d{12}$/.test(form.apaarId)) local.apaarId = 'APAAR ID is 12 digits';
    if (form.parentPhone !== original.parentPhone && form.parentPhone.replace(/\D/g, '').length < 10) local.parentPhone = 'Enter a 10-digit mobile number';
    setErrors(local);
    if (Object.keys(local).length) return;

    const patch: Record<string, string | null> = {};
    (Object.keys(form) as Array<keyof Form>).forEach((k) => {
      if (form[k].trim() === original[k].trim()) return;
      const v = form[k].trim();
      if (k === 'socialCategory') patch[k] = v || null;
      else if (k === 'parentPhone' || k === 'firstName' || k === 'gender' || k === 'dateOfBirth' || k === 'sectionId' || k === 'rollNumber') {
        if (v) patch[k] = v;
      } else patch[k] = v; // blank clears (server turns '' into null)
    });
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<Wrapped<StudentDetail>>('PATCH', `/students/${student.id}`, patch);
      onSaved(res.data);
    } catch (err) {
      const fe = fieldErrors(err);
      const code = errorCode(err);
      if (code === 'ROLL_NUMBER_TAKEN') fe.rollNumber = errorText(err);
      if (code === 'PARENT_NOT_FOUND') fe.parentPhone = errorText(err);
      setErrors(fe);
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title="Edit student details"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="edit-student-form" loading={busy}>
            Save changes
          </Button>
        </>
      }
    >
      <form id="edit-student-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Input label="First name" value={form.firstName} onChange={set('firstName')} error={errors.firstName} required />
        <Input label="Last name" value={form.lastName} onChange={set('lastName')} error={errors.lastName} />
        <Select label="Gender" value={form.gender} onChange={set('gender')} error={errors.gender}>
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="other">Other</option>
        </Select>
        <Input label="Date of birth" type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} max={todayLocal()} error={errors.dateOfBirth} />
        <Select label={`Section (${student.class?.name ?? 'class'})`} value={form.sectionId} onChange={set('sectionId')} error={errors.sectionId} disabled={sameClass.length < 2}>
          {sameClass.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
          {sameClass.length === 0 && <option value={form.sectionId}>{student.section?.name ?? '-'}</option>}
        </Select>
        <Input label="Roll number" value={form.rollNumber} onChange={set('rollNumber')} error={errors.rollNumber} />
        <Input label="Father's name" value={form.fatherName} onChange={set('fatherName')} error={errors.fatherName} />
        <Input label="Mother's name" value={form.motherName} onChange={set('motherName')} error={errors.motherName} />
        <Input label="Guardian's name" value={form.guardianName} onChange={set('guardianName')} error={errors.guardianName} placeholder="If different from parents" />
        <Select label="Social category" value={form.socialCategory} onChange={set('socialCategory')} error={errors.socialCategory}>
          <option value="">Not recorded</option>
          {SOCIAL_CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </Select>
        <Input label="PEN (UDISE+)" value={form.penNumber} onChange={set('penNumber')} error={errors.penNumber} placeholder="Optional" />
        <Input label="APAAR ID" value={form.apaarId} onChange={set('apaarId')} error={errors.apaarId} inputMode="numeric" placeholder="12 digits" />
        <Input
          label="Parent mobile"
          type="tel"
          value={form.parentPhone}
          onChange={set('parentPhone')}
          error={errors.parentPhone}
          hint="Links to an existing parent with this number, or updates the parent's mobile."
          className="sm:col-span-2"
        />
        {error && (
          <div className="sm:col-span-2">
            <Notice tone="error">{error}</Notice>
          </div>
        )}
      </form>
    </Modal>
  );
}
