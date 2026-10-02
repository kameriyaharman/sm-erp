'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button, Input, Modal, Notice, Select } from '@/components/ui';
import { apiSend } from '@/lib/session';
import { errorCode, errorText, fieldErrors, todayLocal, type FlatSection } from '../shared';
import { SOCIAL_CATEGORIES, type ClassInfo, type Gender, type StudentDetail, type Wrapped } from '../types';

interface Form {
  firstName: string;
  lastName: string;
  gender: Gender | '';
  dateOfBirth: string;
  classId: string;
  sectionId: string;
  rollNumber: string;
  admissionNumber: string;
  admissionDate: string;
  fatherName: string;
  motherName: string;
  socialCategory: string;
  parentName: string;
  parentPhone: string;
  parentEmail: string;
  applyFeeStructure: boolean;
}

const EMPTY = (): Form => ({
  firstName: '',
  lastName: '',
  gender: '',
  dateOfBirth: '',
  classId: '',
  sectionId: '',
  rollNumber: '',
  admissionNumber: '',
  admissionDate: todayLocal(),
  fatherName: '',
  motherName: '',
  socialCategory: '',
  parentName: '',
  parentPhone: '',
  parentEmail: '',
  applyFeeStructure: true,
});

export default function AdmissionModal({
  open,
  onClose,
  classes,
  sections,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  classes: ClassInfo[];
  sections: FlatSection[];
  onCreated: (s: StudentDetail) => void;
}) {
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(EMPTY());
      setErrors({});
      setError(null);
    }
  }, [open]);

  const classSections = useMemo(() => sections.filter((s) => s.classId === form.classId), [sections, form.classId]);
  // Pick the only section automatically.
  useEffect(() => {
    if (classSections.length === 1 && form.sectionId !== classSections[0].id) setForm((f) => ({ ...f, sectionId: classSections[0].id }));
  }, [classSections, form.sectionId]);

  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    if (!form.firstName.trim()) e.firstName = 'Enter the first name';
    if (!form.gender) e.gender = 'Choose a gender';
    if (!form.dateOfBirth) e.dateOfBirth = 'Enter the date of birth';
    else if (form.admissionDate && form.dateOfBirth >= form.admissionDate) e.dateOfBirth = 'Date of birth must be before the admission date';
    if (!form.classId) e.classId = 'Choose a class';
    if (!form.sectionId) e.sectionId = classSections.length === 0 && form.classId ? 'This class has no section this year' : 'Choose a section';
    if (form.parentName.trim().length < 2) e.parentName = "Enter the parent's name";
    if (form.parentPhone.replace(/\D/g, '').length < 10) e.parentPhone = 'Enter a 10-digit mobile number';
    if (form.parentEmail && !/^\S+@\S+\.\S+$/.test(form.parentEmail)) e.parentEmail = 'Enter a valid email or leave it blank';
    return e;
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const local = validate();
    setErrors(local);
    if (Object.keys(local).length) return;
    const opt = (v: string) => (v.trim() ? v.trim() : undefined);
    const body = {
      firstName: form.firstName.trim(),
      lastName: opt(form.lastName),
      gender: form.gender,
      dateOfBirth: form.dateOfBirth,
      classId: form.classId,
      sectionId: form.sectionId,
      rollNumber: opt(form.rollNumber),
      admissionNumber: opt(form.admissionNumber),
      admissionDate: opt(form.admissionDate),
      fatherName: opt(form.fatherName),
      motherName: opt(form.motherName),
      socialCategory: opt(form.socialCategory),
      parent: { name: form.parentName.trim(), phone: form.parentPhone.trim(), email: opt(form.parentEmail) },
      applyFeeStructure: form.applyFeeStructure,
    };
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<Wrapped<StudentDetail>>('POST', '/students', body);
      onCreated(res.data);
    } catch (err) {
      const fe = fieldErrors(err);
      const code = errorCode(err);
      if (code === 'ROLL_NUMBER_TAKEN') fe.rollNumber = errorText(err);
      if (code === 'CONFLICT') fe.admissionNumber = errorText(err);
      if (code === 'SECTION_NOT_IN_CLASS' || code === 'SECTION_NOT_CURRENT') fe.sectionId = errorText(err);
      if (fe.parent) fe.parentPhone = fe.parent;
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
      title="New admission"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="admission-form" loading={busy}>
            Admit student
          </Button>
        </>
      }
    >
      <form id="admission-form" onSubmit={submit} noValidate className="space-y-6">
        <fieldset className="space-y-4">
          <legend className="mb-3 text-13 font-medium text-slate-500 dark:text-slate-400">Student</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="First name" value={form.firstName} onChange={set('firstName')} error={errors.firstName} autoComplete="off" required />
            <Input label="Last name" value={form.lastName} onChange={set('lastName')} error={errors.lastName} autoComplete="off" />
            <Select label="Gender" value={form.gender} onChange={set('gender')} error={errors.gender} required>
              <option value="">Choose…</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </Select>
            <Input label="Date of birth" type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} error={errors.dateOfBirth} max={todayLocal()} required />
            <Input label="Father's name" value={form.fatherName} onChange={set('fatherName')} error={errors.fatherName} />
            <Input label="Mother's name" value={form.motherName} onChange={set('motherName')} error={errors.motherName} />
            <Select label="Social category" value={form.socialCategory} onChange={set('socialCategory')} error={errors.socialCategory}>
              <option value="">Not recorded</option>
              {SOCIAL_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="mb-3 text-13 font-medium text-slate-500 dark:text-slate-400">Admission</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Class" value={form.classId} onChange={(e) => setForm((f) => ({ ...f, classId: e.target.value, sectionId: '' }))} error={errors.classId} required>
              <option value="">Choose…</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select label="Section" value={form.sectionId} onChange={set('sectionId')} error={errors.sectionId} disabled={!form.classId} required>
              <option value="">{form.classId ? 'Choose…' : 'Choose a class first'}</option>
              {classSections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.studentCount}
                  {s.capacity ? `/${s.capacity}` : ''} students)
                </option>
              ))}
            </Select>
            <Input label="Admission number" value={form.admissionNumber} onChange={set('admissionNumber')} error={errors.admissionNumber} hint="Leave blank to use the next number." />
            <Input label="Roll number" value={form.rollNumber} onChange={set('rollNumber')} error={errors.rollNumber} hint="Leave blank for the next roll number." />
            <Input label="Admission date" type="date" value={form.admissionDate} onChange={set('admissionDate')} error={errors.admissionDate} />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={form.applyFeeStructure} onChange={(e) => setForm((f) => ({ ...f, applyFeeStructure: e.target.checked }))} className="mt-0.5 h-4 w-4 rounded border-slate-300" />
            <span>
              Apply the class fee structure
              <span className="block text-xs text-slate-500 dark:text-slate-400">Adds this year&apos;s fee instalments for the class to the student&apos;s account.</span>
            </span>
          </label>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="mb-3 text-13 font-medium text-slate-500 dark:text-slate-400">Parent / guardian</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Parent name" value={form.parentName} onChange={set('parentName')} error={errors.parentName} required />
            <Input label="Mobile number" type="tel" inputMode="tel" value={form.parentPhone} onChange={set('parentPhone')} error={errors.parentPhone} placeholder="98XXXXXXXX" hint="An existing parent with this number is linked." required />
            <Input label="Email" type="email" value={form.parentEmail} onChange={set('parentEmail')} error={errors.parentEmail} placeholder="Optional" />
          </div>
        </fieldset>
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </Modal>
  );
}
