'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ImageUp, Trash2 } from 'lucide-react';
import { Button, Card, ErrorState, Input, Notice, Page, PageHeader, Select, Spinner } from '@/components/ui';
import { useApi } from '@/lib/useApi';
import { apiSend } from '@/lib/session';
import { errorText, fieldErrors, useFlash } from '@/features/admin/shared';
import { INDIAN_STATES, UNION_TERRITORIES, emailError, pincodeError } from './india';
import { LOGO_TYPES, pictureError, uploadPicture } from './upload';
import { useAuthImage } from './useAuthImage';

interface SchoolProfile {
  branchId: string;
  schoolName: string;
  branchName: string;
  branchCode: string;
  address: { line1: string | null; line2: string | null; city: string | null; state: string | null; pincode: string | null };
  phone: string | null;
  email: string | null;
  website: string | null;
  affiliationNo: string | null;
  schoolCode: string | null;
  udiseCode: string | null;
  principalName: string | null;
  board: string | null;
  establishedYear: number | null;
  mediumOfInstruction: string | null;
  logo: { url: string; updatedAt: string } | null;
  canEditSchoolName: boolean;
}

type Form = Record<
  'schoolName' | 'branchName' | 'line1' | 'line2' | 'city' | 'state' | 'pincode' | 'phone' | 'email' | 'website' | 'affiliationNo' | 'schoolCode' | 'udiseCode' | 'principalName' | 'board' | 'establishedYear' | 'mediumOfInstruction',
  string
>;

const BOARD_CHOICES = ['CBSE, New Delhi', 'CISCE (ICSE / ISC)', 'NIOS', 'IB', 'Cambridge (CAIE)', 'State board'];
const MEDIUMS = ['English', 'Hindi', 'English and Hindi', 'Marathi', 'Tamil', 'Telugu', 'Kannada', 'Bengali', 'Gujarati', 'Punjabi', 'Urdu'];

function toForm(p: SchoolProfile): Form {
  return {
    schoolName: p.schoolName ?? '', branchName: p.branchName ?? '', line1: p.address.line1 ?? '', line2: p.address.line2 ?? '',
    city: p.address.city ?? '', state: p.address.state ?? '', pincode: p.address.pincode ?? '', phone: p.phone ?? '', email: p.email ?? '',
    website: p.website ?? '', affiliationNo: p.affiliationNo ?? '', schoolCode: p.schoolCode ?? '', udiseCode: p.udiseCode ?? '',
    principalName: p.principalName ?? '', board: p.board ?? '', establishedYear: p.establishedYear ? String(p.establishedYear) : '',
    mediumOfInstruction: p.mediumOfInstruction ?? '',
  };
}

export default function SchoolProfilePage() {
  const { data, error, loading, reload, setData } = useApi<{ data: SchoolProfile }>('/settings/school');
  const p = data?.data;
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const flash = useFlash();

  useEffect(() => {
    if (p) setForm(toForm(p));
  }, [p]);

  if (loading && !p) return <Spinner label="Loading school profile…" />;
  if (error || !p) return <ErrorState message={error ?? 'Could not load the school profile'} onRetry={reload} />;
  if (!form) return null;

  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(p));
  const bind = (k: keyof Form) => ({
    value: form[k],
    error: errors[k],
    onChange: (e: { target: { value: string } }) => {
      setForm((f) => (f ? { ...f, [k]: e.target.value } : f));
      if (errors[k]) setErrors((x) => ({ ...x, [k]: undefined }));
    },
  });

  function validate(f: Form) {
    const e: Partial<Record<keyof Form, string>> = {};
    if (f.branchName.trim().length < 2) e.branchName = 'Enter the campus / branch name';
    if (p!.canEditSchoolName && f.schoolName.trim().length < 2) e.schoolName = 'Enter the school name';
    if (!f.line1.trim()) e.line1 = 'Enter the street address';
    if (!f.city.trim()) e.city = 'Enter the city';
    if (!f.state) e.state = 'Choose the state';
    const pin = pincodeError(f.pincode, true);
    if (pin) e.pincode = pin;
    const em = emailError(f.email);
    if (em) e.email = em;
    if (f.phone && !/^[+\d][\d\s-]{6,18}$/.test(f.phone.trim())) e.phone = 'Enter a valid phone number';
    if (f.udiseCode && !/^\d{11}$/.test(f.udiseCode.trim())) e.udiseCode = 'UDISE+ code is 11 digits';
    if (f.website && !/^(https?:\/\/)?[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(\/\S*)?$/.test(f.website.trim())) e.website = 'Enter a website like www.school.edu.in';
    const y = Number(f.establishedYear);
    if (f.establishedYear && (!Number.isInteger(y) || y < 1800 || y > new Date().getFullYear())) e.establishedYear = 'Enter a year like 1998';
    return e;
  }

  async function save(ev: FormEvent) {
    ev.preventDefault();
    const e = validate(form!);
    setErrors(e);
    if (Object.keys(e).length) {
      setFormError('Some details need your attention.');
      return;
    }
    const f = form!;
    const n = (v: string) => (v.trim() ? v.trim() : null);
    setBusy(true);
    setFormError(null);
    try {
      const res = await apiSend<{ data: SchoolProfile }>('PUT', `/settings/school?branchId=${p!.branchId}`, {
        ...(p!.canEditSchoolName && { schoolName: f.schoolName.trim() }),
        branchName: f.branchName.trim(),
        address: { line1: f.line1.trim(), line2: n(f.line2), city: f.city.trim(), state: f.state, pincode: f.pincode.trim() },
        phone: n(f.phone), email: n(f.email), website: n(f.website), affiliationNo: n(f.affiliationNo), schoolCode: n(f.schoolCode),
        udiseCode: n(f.udiseCode), principalName: n(f.principalName), board: n(f.board),
        establishedYear: f.establishedYear ? Number(f.establishedYear) : null, mediumOfInstruction: n(f.mediumOfInstruction),
      });
      setData(res);
      flash.show('success', 'School profile saved. New receipts, certificates and report cards will use these details.');
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors({ ...fe, ...(fe.address && { pincode: fe.address }) } as typeof errors);
      setFormError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <PageHeader
        back={
          <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Settings
          </Link>
        }
        title="School profile"
        description="Printed on fee receipts, transfer and bonafide certificates and report cards."
      />
      {flash.node}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <form onSubmit={save} noValidate className="min-w-0 space-y-5">
          {formError && <Notice tone="error">{formError}</Notice>}
          <Card title="School">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="School name"
                className="sm:col-span-2"
                {...bind('schoolName')}
                disabled={!p.canEditSchoolName}
                hint={p.canEditSchoolName ? 'Shared by all branches of the school' : 'Only the school owner can change the name'}
              />
              <Input label="Branch / campus name *" {...bind('branchName')} />
              <Input label="Principal" placeholder="e.g. Dr. Meenakshi Rao" {...bind('principalName')} hint="Signs certificates and report cards" />
              <Input label="Board" list="boards" placeholder="e.g. CBSE, New Delhi" {...bind('board')} />
              <datalist id="boards">
                {BOARD_CHOICES.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
              <Input label="Affiliation no." {...bind('affiliationNo')} />
              <Input label="School code" {...bind('schoolCode')} hint="Board's school number" />
              <Input label="UDISE+ code" inputMode="numeric" maxLength={11} {...bind('udiseCode')} hint="11 digits" />
              <Input label="Established in" inputMode="numeric" maxLength={4} placeholder="e.g. 1998" {...bind('establishedYear')} />
              <Select label="Medium of instruction" {...bind('mediumOfInstruction')}>
                <option value="">Not set</option>
                {MEDIUMS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
                {form.mediumOfInstruction && !MEDIUMS.includes(form.mediumOfInstruction) && <option>{form.mediumOfInstruction}</option>}
              </Select>
            </div>
          </Card>
          <Card title="Address and contact">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Street address *" className="sm:col-span-2" {...bind('line1')} />
              <Input label="Area / landmark" className="sm:col-span-2" {...bind('line2')} />
              <Input label="City *" {...bind('city')} />
              <Select label="State / UT *" {...bind('state')}>
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
              <Input label="PIN code *" inputMode="numeric" maxLength={6} {...bind('pincode')} />
              <Input label="Phone" type="tel" placeholder="e.g. 011-4000 0000" {...bind('phone')} />
              <Input label="Email" type="email" {...bind('email')} />
              <Input label="Website" placeholder="www.yourschool.edu.in" {...bind('website')} />
            </div>
          </Card>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={!dirty || busy} onClick={() => setForm(toForm(p))}>
              Discard changes
            </Button>
            <Button type="submit" loading={busy} disabled={!dirty}>
              Save profile
            </Button>
          </div>
        </form>

        <aside className="min-w-0 space-y-5">
          <LogoCard profile={p} onChanged={reload} onMessage={flash.show} />
          <Card title="On documents" description="How the letterhead will read.">
            <Letterhead p={p} form={form} />
          </Card>
        </aside>
      </div>
    </Page>
  );
}

function LogoCard({ profile, onChanged, onMessage }: { profile: SchoolProfile; onChanged: () => void; onMessage: (tone: 'success' | 'error', text: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const { url } = useAuthImage(profile.logo?.url, profile.logo?.updatedAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    const problem = pictureError(file, { types: LOGO_TYPES, maxMb: 1, label: 'The logo' });
    setError(problem);
    if (problem) return;
    setBusy(true);
    try {
      await uploadPicture(`/settings/school/logo?branchId=${profile.branchId}`, file);
      onMessage('success', 'Logo uploaded. It now prints on certificates and report cards.');
      onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await apiSend('DELETE', `/settings/school/logo?branchId=${profile.branchId}`);
      onMessage('success', 'Logo removed.');
      onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Logo" description="Square PNG or JPG, up to 1 MB.">
      <div className="flex items-center gap-4">
        <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-line-strong bg-surface-muted">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="School logo" className="h-full w-full object-contain p-1.5" />
          ) : (
            <ImageUp className="h-7 w-7 text-slate-300 dark:text-slate-600" aria-hidden />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <input
            ref={input}
            type="file"
            accept={LOGO_TYPES.join(',')}
            className="sr-only"
            aria-label="Choose a logo"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) upload(f);
            }}
          />
          <Button size="sm" variant="secondary" loading={busy} icon={<ImageUp aria-hidden />} onClick={() => input.current?.click()}>
            {profile.logo ? 'Replace logo' : 'Upload logo'}
          </Button>
          {profile.logo && (
            <Button size="sm" variant="ghost" disabled={busy} icon={<Trash2 aria-hidden />} onClick={remove}>
              Remove
            </Button>
          )}
        </div>
      </div>
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </Card>
  );
}

function Letterhead({ p, form }: { p: SchoolProfile; form: Form }) {
  const { url } = useAuthImage(p.logo?.url, p.logo?.updatedAt);
  const ids = [form.board && `Affiliated to ${form.board}`, form.affiliationNo && `Affiliation No. ${form.affiliationNo}`, form.udiseCode && `UDISE ${form.udiseCode}`].filter(Boolean);
  const address = [form.line1, form.line2, [form.city, form.state].filter(Boolean).join(', '), form.pincode].filter(Boolean).join(', ');
  return (
    <div className="rounded-lg border border-line bg-white p-3 text-center text-slate-800 shadow-sm dark:bg-white">
      <div className="flex items-start gap-2">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="h-10 w-10 shrink-0 object-contain" />
        ) : (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-800 text-xs font-bold text-white">{(form.schoolName || '?').slice(0, 2).toUpperCase()}</span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold uppercase leading-tight tracking-wide text-indigo-900">{form.schoolName || 'School name'}</p>
          {form.branchName && form.branchName !== form.schoolName && <p className="text-[10px] font-semibold">{form.branchName}</p>}
          {ids.length > 0 && <p className="text-[9px] leading-tight text-slate-600">{ids.join(' | ')}</p>}
          {address && <p className="text-[9px] leading-tight text-slate-600">{address}</p>}
          <p className="text-[9px] leading-tight text-indigo-700">{[form.phone && `Ph: ${form.phone}`, form.email, form.website].filter(Boolean).join(' | ')}</p>
        </div>
      </div>
      <div className="mt-2 border-t-2 border-indigo-900" />
    </div>
  );
}
