'use client';

/**
 * The admission form (POST /students) and the student edit form (PATCH /students/:id):
 * one page, six short steps. Every step can be opened from the step list; "Next" checks
 * the step, the final save checks everything and jumps to the first problem.
 */

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Bus, Check, CircleAlert, HeartPulse, House, IdCard, School, UsersRound, Wallet } from 'lucide-react';
import { Button, Card, cx, Input, Notice, Page, PageHeader, Select, Textarea } from '@/components/ui';
import { useApi } from '@/lib/useApi';
import { apiSend } from '@/lib/session';
import { errorCode, errorText, fieldErrors, todayLocal, useClasses } from '@/features/admin/shared';
import { SOCIAL_CATEGORIES, type StudentDetail, type TransportRoute, type Wrapped } from '@/features/admin/types';
import { BLOOD_GROUPS, BOARDS, GUARDIAN_RELATIONS, INDIAN_STATES, MOTHER_TONGUES, RELIGIONS, UNION_TERRITORIES, formatAadhaar } from '../india';
import { uploadPicture } from '../upload';
import PhotoPicker from './PhotoPicker';
import {
  FIELD_STEP, STEPS, createBody, emptyForm, fromStudent, mapServerErrors, patchBody, validateAll, validateStep,
  type Errors, type FormState, type Mode, type Primary, type StepId,
} from './model';

const STEP_ICON: Record<StepId, ReactNode> = {
  student: <IdCard aria-hidden />,
  address: <House aria-hidden />,
  family: <UsersRound aria-hidden />,
  previous: <School aria-hidden />,
  health: <HeartPulse aria-hidden />,
  fees: <Wallet aria-hidden />,
};

export default function StudentForm({ mode, student }: { mode: Mode; student?: StudentDetail }) {
  const router = useRouter();
  const today = todayLocal();
  const original = useMemo(() => (student ? fromStudent(student) : emptyForm(today)), [student, today]);
  const [form, setForm] = useState<FormState>(original);
  const [errors, setErrors] = useState<Errors>({});
  const [step, setStep] = useState<StepId>('student');
  const [visited, setVisited] = useState<Set<StepId>>(new Set(['student']));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);

  const { classes, sections, loading: classesLoading } = useClasses();
  const steps = STEPS.filter((s) => s.modes.includes(mode));
  const index = steps.findIndex((s) => s.id === step);
  const classSections = useMemo(() => sections.filter((s) => s.classId === form.classId), [sections, form.classId]);
  const ctx = { today, sectionCount: classSections.length };

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(original) || Boolean(photo) || removePhoto, [form, original, photo, removePhoto]);
  useEffect(() => {
    if (!dirty || busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, busy]);

  // /students/:id/edit?step=address opens that section (links from the profile cards).
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('step') as StepId | null;
    if (wanted && STEPS.some((s) => s.id === wanted && s.modes.includes(mode))) {
      setStep(wanted);
      setVisited((v) => new Set(v).add(wanted));
    }
  }, [mode]);

  // Pick the only section of a class automatically.
  useEffect(() => {
    if (form.classId && classSections.length === 1 && form.sectionId !== classSections[0].id && form.classId !== original.classId) {
      setForm((f) => ({ ...f, sectionId: classSections[0].id }));
    }
  }, [classSections, form.classId, form.sectionId, original.classId]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const bind = (k: keyof FormState) => ({
    value: String(form[k]),
    onChange: (e: { target: { value: string } }) => set(k, e.target.value as never),
    error: errors[k],
  });

  const stepErrors = (id: StepId) => Object.entries(errors).some(([k, v]) => v && FIELD_STEP[k as keyof FormState] === id);

  function go(id: StepId) {
    setStep(id);
    setVisited((v) => new Set(v).add(id));
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Phones: keep the current step's chip visible in the scrolling strip.
  useEffect(() => {
    const el = document.querySelector<HTMLElement>(`[data-step="${step}"]`);
    const strip = el?.closest('nav');
    if (el && strip && strip.scrollWidth > strip.clientWidth) strip.scrollTo({ left: el.offsetLeft - 16, behavior: 'smooth' });
  }, [step]);

  function next() {
    const e = validateStep(step, form, mode, ctx);
    setErrors((prev) => ({ ...prev, ...e }));
    if (Object.keys(e).length) return;
    if (index < steps.length - 1) go(steps[index + 1].id);
  }

  async function save() {
    const e = validateAll(form, mode, ctx);
    setErrors(e);
    const first = steps.find((s) => Object.keys(e).some((k) => FIELD_STEP[k as keyof FormState] === s.id));
    if (first) {
      go(first.id);
      setError('Some details need your attention. They are marked in red.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === 'create') await admit();
      else await update();
    } catch (err) {
      const mapped = mapServerErrors(fieldErrors(err), errorCode(err), errorText(err), form.primary);
      setErrors(mapped);
      const firstBad = steps.find((s) => Object.keys(mapped).some((k) => FIELD_STEP[k as keyof FormState] === s.id));
      if (firstBad) go(firstBad.id);
      setError(errorText(err));
      setBusy(false);
    }
  }

  async function admit() {
    const res = await apiSend<Wrapped<StudentDetail>>('POST', '/students', createBody(form));
    const id = res.data.id;
    const issues: string[] = [];
    if (photo) {
      try {
        await uploadPicture(`/students/${id}/photo`, photo);
      } catch (err) {
        issues.push(`photo: ${errorText(err)}`);
      }
    }
    if (form.routeId) {
      try {
        await apiSend('PUT', '/transport/assignments', { studentId: id, routeId: form.routeId, stopId: form.stopId || undefined });
      } catch (err) {
        issues.push(`school bus: ${errorText(err)}`);
      }
    }
    const qs = new URLSearchParams({ admitted: '1' });
    if (issues.length) qs.set('warn', issues.join(' · '));
    router.push(`/students/${id}?${qs}`);
  }

  async function update() {
    const id = student!.id;
    const patch = patchBody(form, original);
    let warnings: Array<{ message: string }> = [];
    if (Object.keys(patch).length) {
      const res = await apiSend<Wrapped<StudentDetail> & { warnings?: Array<{ message: string }> }>('PATCH', `/students/${id}`, patch);
      warnings = res.warnings ?? [];
    }
    const issues: string[] = [];
    if (photo) {
      try {
        await uploadPicture(`/students/${id}/photo`, photo);
      } catch (err) {
        issues.push(`photo: ${errorText(err)}`);
      }
    } else if (removePhoto && student?.photo) {
      try {
        await apiSend('DELETE', `/students/${id}/photo`);
      } catch (err) {
        issues.push(`photo: ${errorText(err)}`);
      }
    }
    const qs = new URLSearchParams({ saved: '1' });
    const notes = [...warnings.map((w) => w.message), ...issues.map((i) => `Could not save the ${i}`)];
    if (notes.length) qs.set('warn', notes.join(' · '));
    router.push(`/students/${id}?${qs}`);
  }

  const backHref = mode === 'edit' ? `/students/${student!.id}` : '/students';
  const isLast = index === steps.length - 1;
  const errorCount = Object.values(errors).filter(Boolean).length;

  return (
    <Page wide>
      <div ref={topRef} className="scroll-mt-20" />
      <PageHeader
        back={
          <Link href={backHref} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
            <ArrowLeft className="h-4 w-4" aria-hidden /> {mode === 'edit' ? student!.name : 'Students'}
          </Link>
        }
        title={mode === 'edit' ? 'Edit student details' : 'New admission'}
        description={
          mode === 'edit'
            ? `Admission no. ${student!.admissionNumber}. Change any section and save; untouched details stay as they are.`
            : 'Fill in what the parents have given you. Fields marked * are needed to admit; the rest can be completed later.'
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[16.5rem_minmax(0,1fr)]">
        {/* Step list: a rail on desktop, a scrolling strip on phones. */}
        <nav aria-label="Form sections" className="relative -mx-4 min-w-0 overflow-x-auto px-4 pb-1 lg:mx-0 lg:overflow-visible lg:px-0 lg:pb-0">
          <ol className="flex gap-2 lg:sticky lg:top-20 lg:flex-col lg:gap-1">
            {steps.map((s, i) => {
              const current = s.id === step;
              const bad = stepErrors(s.id);
              const done = !bad && visited.has(s.id) && !current && i < index;
              return (
                <li key={s.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => go(s.id)}
                    data-step={s.id}
                    aria-current={current ? 'step' : undefined}
                    className={cx(
                      'flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors lg:border-transparent lg:py-2.5',
                      current
                        ? 'border-indigo-200 bg-indigo-50 text-indigo-900 dark:border-indigo-400/30 dark:bg-indigo-400/10 dark:text-indigo-100'
                        : 'border-line bg-surface text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-white/5 lg:bg-transparent',
                    )}
                  >
                    <span
                      className={cx(
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold [&>svg]:h-3.5 [&>svg]:w-3.5',
                        bad ? 'bg-red-100 text-red-700 dark:bg-red-400/15 dark:text-red-300'
                          : current ? 'bg-indigo-600 text-white'
                            : done ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300'
                              : 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-400',
                      )}
                    >
                      {bad ? <CircleAlert aria-hidden /> : done ? <Check aria-hidden /> : STEP_ICON[s.id]}
                    </span>
                    <span className="min-w-0">
                      <span className="block whitespace-nowrap text-13 font-semibold">
                        <span className="sr-only">Step {i + 1}: </span>
                        {s.title}
                        {bad && <span className="sr-only"> (has errors)</span>}
                      </span>
                      <span className="hidden text-xs text-slate-500 dark:text-slate-400 lg:block">{s.hint}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (mode === 'edit' || isLast) save();
            else next();
          }}
          className="min-w-0 space-y-5"
        >
          {error && <Notice tone="error">{error}{errorCount > 1 && ` (${errorCount} fields)`}</Notice>}

          {step === 'student' && (
            <>
              <Card title="Student" description="As written in the birth certificate.">
                <div className="flex flex-col gap-5 sm:flex-row">
                  <PhotoPicker
                    name={`${form.firstName} ${form.lastName}`.trim()}
                    existing={student?.photo && !removePhoto ? { path: student.photo.url, version: student.photo.updatedAt } : null}
                    file={photo}
                    onFile={(f) => {
                      setPhoto(f);
                      if (f) setRemovePhoto(false);
                    }}
                    onRemoveExisting={() => setRemovePhoto(true)}
                  />
                  <div className="grid min-w-0 flex-1 gap-4 sm:grid-cols-2">
                    <Input label="First name *" autoComplete="off" {...bind('firstName')} />
                    <Input label="Last name" autoComplete="off" {...bind('lastName')} />
                    <Select label="Gender *" {...bind('gender')}>
                      <option value="">Choose…</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="other">Other</option>
                    </Select>
                    <Input label="Date of birth *" type="date" max={today} {...bind('dateOfBirth')} />
                  </div>
                </div>
              </Card>

              <Card title="Class and admission" description={mode === 'edit' ? 'Moving to another class keeps the fees already set; adjust them in Fees if needed.' : undefined}>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  <Select
                    label="Class *"
                    value={form.classId}
                    error={errors.classId}
                    disabled={classesLoading}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, classId: e.target.value, sectionId: e.target.value === original.classId ? original.sectionId : '' }));
                      setErrors((x) => ({ ...x, classId: undefined, sectionId: undefined }));
                    }}
                  >
                    <option value="">{classesLoading ? 'Loading…' : 'Choose…'}</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                  <Select label="Section *" {...bind('sectionId')} disabled={!form.classId}>
                    <option value="">{form.classId ? 'Choose…' : 'Choose a class first'}</option>
                    {classSections.map((s) => {
                      const full = s.capacity !== null && s.studentCount >= s.capacity && s.id !== original.sectionId;
                      return (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.studentCount}
                          {s.capacity ? ` of ${s.capacity}` : ''} students{full ? ', full' : ''})
                        </option>
                      );
                    })}
                  </Select>
                  <Input label="Roll number" {...bind('rollNumber')} hint={mode === 'create' ? 'Blank: next roll number' : 'Kept when moving if it is free'} />
                  {mode === 'create' ? (
                    <Input label="Admission number" {...bind('admissionNumber')} hint="Blank: next number in your series" />
                  ) : (
                    <Input label="Admission number" value={form.admissionNumber} disabled hint="Cannot be changed" />
                  )}
                  <Input label="Admission date" type="date" max={today} {...bind('admissionDate')} />
                </div>
              </Card>

              <Card title="Identity and background" description="Needed for the admission register, UDISE+ and the transfer certificate.">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  <Input
                    label="Aadhaar number"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder={student?.aadhaarMasked && !form.clearAadhaar ? `${student.aadhaarMasked} on file` : '1234 5678 9012'}
                    value={form.aadhaar}
                    onChange={(e) => set('aadhaar', formatAadhaar(e.target.value))}
                    error={errors.aadhaar}
                    hint={
                      student?.aadhaarMasked ? (
                        form.clearAadhaar ? (
                          <button type="button" className="font-medium text-indigo-700 hover:underline dark:text-indigo-300" onClick={() => set('clearAadhaar', false)}>
                            Will be removed. Undo
                          </button>
                        ) : (
                          <span>
                            Type a new number to replace it, or{' '}
                            <button type="button" className="font-medium text-indigo-700 hover:underline dark:text-indigo-300" onClick={() => setForm((f) => ({ ...f, aadhaar: '', clearAadhaar: true }))}>
                              remove it
                            </button>
                          </span>
                        )
                      ) : (
                        'Shown masked everywhere except to the office'
                      )
                    }
                  />
                  <Select label="Social category" {...bind('socialCategory')}>
                    <option value="">Not recorded</option>
                    {SOCIAL_CATEGORIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                  <Select label="Religion" {...bind('religion')}>
                    <option value="">Not recorded</option>
                    {RELIGIONS.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </Select>
                  <Input label="Mother tongue" list="mother-tongues" {...bind('motherTongue')} />
                  <datalist id="mother-tongues">
                    {MOTHER_TONGUES.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                  <Input label="Nationality" {...bind('nationality')} />
                  <Input label="House" placeholder="e.g. Tagore" {...bind('house')} />
                  <Input label="PEN (UDISE+)" placeholder="Optional" {...bind('penNumber')} />
                  <Input label="APAAR ID" inputMode="numeric" placeholder="12 digits" {...bind('apaarId')} />
                  <Input label="Identification marks" placeholder="e.g. mole on the left cheek" {...bind('identificationMarks')} />
                </div>
              </Card>
            </>
          )}

          {step === 'address' && (
            <Card title="Residential address" description={mode === 'create' ? 'Used on the admission register, TC and for transport.' : 'Leave every field blank to remove the address.'}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input label="House / flat, building, street *" autoComplete="address-line1" className="sm:col-span-2" placeholder="e.g. Flat 204, Kailash Apartments" {...bind('line1')} />
                <Input label="Area / locality / landmark" autoComplete="address-line2" className="sm:col-span-2" placeholder="e.g. Sector 6, Dwarka" {...bind('line2')} />
                <Input label="City / town *" autoComplete="address-level2" {...bind('city')} />
                <Select label="State / UT *" autoComplete="address-level1" {...bind('state')}>
                  <option value="">Choose…</option>
                  <optgroup label="States">
                    {INDIAN_STATES.map((st) => (
                      <option key={st}>{st}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Union territories">
                    {UNION_TERRITORIES.map((st) => (
                      <option key={st}>{st}</option>
                    ))}
                  </optgroup>
                </Select>
                <Input
                  label="PIN code *"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  maxLength={6}
                  value={form.pincode}
                  onChange={(e) => set('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))}
                  error={errors.pincode}
                />
              </div>
            </Card>
          )}

          {step === 'family' && (
            <>
              {(['father', 'mother'] as const).map((who) => (
                <Card key={who} title={who === 'father' ? 'Father' : 'Mother'}>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input label={`${who === 'father' ? "Father's" : "Mother's"} name${mode === 'create' && form.primary === who ? ' *' : ''}`} {...bind(`${who}Name`)} />
                    <Input label={`Mobile${mode === 'create' && form.primary === who ? ' *' : ''}`} type="tel" inputMode="tel" placeholder="98XXXXXXXX" {...bind(`${who}Phone`)} />
                    <Input label="Email" type="email" placeholder="Optional" {...bind(`${who}Email`)} />
                    <Input label="Occupation" placeholder="e.g. Engineer, Homemaker" {...bind(`${who}Occupation`)} />
                  </div>
                </Card>
              ))}
              <Card title="Guardian" description="Only if someone other than the parents looks after the child.">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Input label={`Guardian's name${mode === 'create' && form.primary === 'guardian' ? ' *' : ''}`} {...bind('guardianName')} />
                  <Select label="Relation" {...bind('guardianRelation')}>
                    <option value="">Choose…</option>
                    {GUARDIAN_RELATIONS.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </Select>
                  <Input label={`Mobile${mode === 'create' && form.primary === 'guardian' ? ' *' : ''}`} type="tel" inputMode="tel" {...bind('guardianPhone')} />
                </div>
              </Card>
              {mode === 'create' ? (
                <Card title="Primary contact" description="Receives the school's SMS and gets the parent app login. A brother or sister already in the school with this mobile is linked to the same family account.">
                  <div role="radiogroup" aria-label="Primary contact" className="grid gap-2 sm:grid-cols-3">
                    {(['father', 'mother', 'guardian'] as Primary[]).map((p) => {
                      const name = form[`${p}Name`].trim();
                      const phone = form[`${p}Phone`].trim();
                      return (
                        <label
                          key={p}
                          className={cx(
                            'flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors',
                            form.primary === p ? 'border-indigo-400 bg-indigo-50/60 dark:border-indigo-400/50 dark:bg-indigo-400/10' : 'border-line hover:bg-slate-50 dark:hover:bg-white/5',
                          )}
                        >
                          <input type="radio" name="primary" className="mt-0.5 h-4 w-4 accent-indigo-600" checked={form.primary === p} onChange={() => set('primary', p)} />
                          <span className="min-w-0">
                            <span className="block font-medium capitalize">{p}</span>
                            <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{name || phone ? [name, phone].filter(Boolean).join(', ') : 'Not filled in yet'}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </Card>
              ) : (
                <Card title="Parent app login" description="The family account that gets SMS and signs in to the parent app.">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input label="Account holder" value={student?.parent?.name ?? 'No parent account linked'} disabled />
                    <Input
                      label="Login & SMS mobile"
                      type="tel"
                      inputMode="tel"
                      {...bind('parentPhone')}
                      hint="Another family's account with this number is linked instead; otherwise this account's number changes."
                    />
                  </div>
                </Card>
              )}
            </>
          )}

          {step === 'previous' && (
            <Card title="Previous school" description="Leave blank for a first admission (nursery / class 1).">
              <div className="grid gap-4 sm:grid-cols-2">
                <Input label="School name" className="sm:col-span-2" placeholder="e.g. Kendriya Vidyalaya, Janakpuri" {...bind('prevName')} />
                <Select label="Board" {...bind('prevBoard')}>
                  <option value="">Choose…</option>
                  {BOARDS.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                  {form.prevBoard && !BOARDS.includes(form.prevBoard) && <option>{form.prevBoard}</option>}
                </Select>
                <Input label="Last class passed" placeholder="e.g. Class 4" {...bind('prevClass')} />
                <Input label="Transfer certificate no." {...bind('tcNumber')} />
                <Input label="TC date" type="date" max={today} {...bind('tcDate')} />
              </div>
            </Card>
          )}

          {step === 'health' && (
            <>
              <Card title="Health" description="Visible to the class teacher, so they know what to watch for.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Select label="Blood group" {...bind('bloodGroup')}>
                    <option value="">Not known</option>
                    {BLOOD_GROUPS.map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </Select>
                  <Input label="Allergies" placeholder="e.g. peanuts, penicillin" {...bind('allergies')} />
                  <Textarea label="Medical notes" className="sm:col-span-2" rows={3} maxLength={1000} placeholder="Conditions, regular medicines, what to do in an emergency" {...bind('medicalNotes')} />
                </div>
              </Card>
              <Card title="Emergency contact" description="Someone other than the parents the school can call if they are unreachable.">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Input label="Name" {...bind('emergencyName')} />
                  <Input label="Relation" placeholder="e.g. Uncle, Neighbour" {...bind('emergencyRelation')} />
                  <Input label="Mobile" type="tel" inputMode="tel" {...bind('emergencyPhone')} />
                </div>
              </Card>
            </>
          )}

          {step === 'fees' && mode === 'create' && <FeesTransport form={form} set={set} className={classes.find((c) => c.id === form.classId)?.name} />}

          {/* Actions: sticky at the bottom on phones. */}
          <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-between gap-2 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none">
            <Button variant="secondary" onClick={() => (index > 0 ? go(steps[index - 1].id) : router.push(backHref))} disabled={busy} icon={<ArrowLeft aria-hidden />}>
              {index > 0 ? 'Back' : 'Cancel'}
            </Button>
            <div className="flex items-center gap-2">
              {mode === 'edit' && !isLast && (
                <Button variant="secondary" onClick={next} disabled={busy}>
                  Next
                  <ArrowRight aria-hidden />
                </Button>
              )}
              {mode === 'edit' ? (
                <Button type="submit" loading={busy} disabled={!dirty}>
                  Save changes
                </Button>
              ) : isLast ? (
                <Button type="submit" loading={busy} icon={<Check aria-hidden />}>
                  Admit student
                </Button>
              ) : (
                <Button type="submit">
                  Next: {steps[index + 1].title}
                  <ArrowRight aria-hidden />
                </Button>
              )}
            </div>
          </div>
        </form>
      </div>
    </Page>
  );
}

function FeesTransport({ form, set, className }: { form: FormState; set: <K extends keyof FormState>(k: K, v: FormState[K]) => void; className?: string }) {
  const routes = useApi<Wrapped<TransportRoute[]>>('/transport/routes');
  const list = (routes.data?.data ?? []).filter((r) => r.status === 'active');
  const route = list.find((r) => r.id === form.routeId);
  return (
    <>
      <Card title="Fees">
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={form.applyFeeStructure} onChange={(e) => set('applyFeeStructure', e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-indigo-600" />
          <span>
            <span className="font-medium">Apply the {className ? `${className} ` : 'class '}fee structure</span>
            <span className="block text-13 text-slate-500 dark:text-slate-400">
              Adds this year&apos;s instalments for the class to the student&apos;s account. Untick for a free seat or to set the fees by hand later.
            </span>
          </span>
        </label>
      </Card>
      <Card title="School transport" description="Optional. You can also assign a route later from the student's profile.">
        {routes.error ? (
          <Notice tone="warn">Bus routes could not be loaded ({routes.error}). Assign the route from the profile after admission.</Notice>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Route"
              value={form.routeId}
              disabled={routes.loading}
              onChange={(e) => {
                const r = list.find((x) => x.id === e.target.value);
                set('routeId', e.target.value);
                set('stopId', r?.stops[0]?.id ?? '');
              }}
            >
              <option value="">{routes.loading ? 'Loading…' : 'Does not use the school bus'}</option>
              {list.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.vehicleNumber}){r.capacity && r.studentCount >= r.capacity ? ', full' : ''}
                </option>
              ))}
            </Select>
            <Select label="Stop" value={form.stopId} onChange={(e) => set('stopId', e.target.value)} disabled={!route}>
              {!route && <option value="">Choose a route first</option>}
              {route?.stops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.pickupTime ? `, pickup ${s.pickupTime.slice(0, 5)}` : ''}
                </option>
              ))}
            </Select>
            {route && (
              <p className="flex items-center gap-2 text-13 text-slate-500 dark:text-slate-400 sm:col-span-2">
                <Bus className="h-4 w-4" aria-hidden />
                {route.driverName}, {route.driverPhone}. {route.studentCount} students on this route{route.capacity ? ` of ${route.capacity} seats` : ''}.
              </p>
            )}
          </div>
        )}
      </Card>
    </>
  );
}
