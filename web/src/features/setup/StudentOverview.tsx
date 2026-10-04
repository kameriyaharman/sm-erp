'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Eye, EyeOff, HeartPulse, House, IdCard, Mail, Pencil, Phone, School, ShieldAlert, UsersRound } from 'lucide-react';
import { Badge, buttonClass, Card, cx } from '@/components/ui';
import { apiGet } from '@/lib/session';
import { formatDate, titleCase } from '@/lib/format';
import { DefinitionList, errorText, initials } from '@/features/admin/shared';
import type { StudentDetail } from '@/features/admin/types';
import { displayPhone } from './india';
import { useAuthImage } from './useAuthImage';

/** Student photo, or initials when there is none (or it can't be loaded). */
export function StudentPhoto({ student, size = 'lg' }: { student: Pick<StudentDetail, 'name' | 'photo'>; size?: 'md' | 'lg' | 'xl' }) {
  const { url } = useAuthImage(student.photo?.url, student.photo?.updatedAt);
  const box = { md: 'h-9 w-9 text-xs rounded-full', lg: 'h-16 w-16 text-lg rounded-xl', xl: 'h-24 w-20 text-xl rounded-xl sm:h-28 sm:w-24' }[size];
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={`Photo of ${student.name}`} className={cx('shrink-0 border border-line object-cover', box)} />;
  }
  return (
    <span aria-hidden className={cx('flex shrink-0 items-center justify-center bg-indigo-100 font-semibold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200', box)}>
      {initials(student.name)}
    </span>
  );
}

export function Tel({ phone }: { phone: string | null | undefined }) {
  if (!phone) return null;
  return (
    <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-indigo-700 hover:underline dark:text-indigo-300">
      <Phone className="h-3.5 w-3.5" aria-hidden />
      {displayPhone(phone)}
    </a>
  );
}

function Mailto({ email }: { email: string | null | undefined }) {
  if (!email) return null;
  return (
    <a href={`mailto:${email}`} className="inline-flex min-w-0 items-center gap-1 text-indigo-700 hover:underline dark:text-indigo-300">
      <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="truncate">{email}</span>
    </a>
  );
}

function Person({ role, name, phone, email, extra, primary }: { role: string; name: string | null; phone?: string | null; email?: string | null; extra?: ReactNode; primary?: boolean }) {
  const empty = !name && !phone && !email;
  return (
    <div className="min-w-0 rounded-lg border border-line p-3.5">
      <p className="flex items-center gap-2 text-13 font-medium text-slate-500 dark:text-slate-400">
        {role}
        {primary && <Badge tone="indigo">Parent login</Badge>}
      </p>
      {empty ? (
        <p className="mt-1 text-sm text-slate-400">Not recorded</p>
      ) : (
        <div className="mt-1 space-y-1 text-sm">
          <p className="font-medium text-slate-900 dark:text-white">{name ?? <span className="text-slate-400">Name not recorded</span>}</p>
          {extra && <p className="text-13 text-slate-500 dark:text-slate-400">{extra}</p>}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Tel phone={phone} />
            <Mailto email={email} />
          </div>
        </div>
      )}
    </div>
  );
}

function AadhaarValue({ studentId, masked, canReveal }: { studentId: string; masked: string | null; canReveal: boolean }) {
  const [full, setFull] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!masked) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="font-mono tabular-nums tracking-wide">{full ?? masked}</span>
      {canReveal && (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            if (full) return setFull(null);
            setBusy(true);
            setError(null);
            try {
              const res = await apiGet<{ data: { aadhaarNumber: string | null } }>(`/students/${studentId}/aadhaar`);
              setFull(res.data.aadhaarNumber);
            } catch (err) {
              setError(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
          className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:underline disabled:opacity-60 dark:text-indigo-300"
          aria-label={full ? 'Hide Aadhaar number' : 'Show full Aadhaar number'}
        >
          {full ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
          {full ? 'Hide' : 'Show'}
        </button>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

/** The "Overview" tab of the student profile: everything from the admission form. */
export default function StudentOverview({ s, canEdit }: { s: StudentDetail; canEdit: boolean }) {
  const classLabel = [s.class?.name, s.section?.name].filter(Boolean).join(' ') || 'No class';
  const a = s.address;
  const primaryPhone = s.parent?.phone ?? null;
  const editLink = (step?: string) =>
    canEdit ? (
      <Link href={`/students/${s.id}/edit${step ? `?step=${step}` : ''}`} className={buttonClass({ variant: 'secondary', size: 'sm' })}>
        <Pencil aria-hidden />
        Edit
      </Link>
    ) : undefined;
  const missing = [!a && 'address', !s.father?.phone && !s.mother?.phone && 'parents\' phones', !s.emergencyContact && 'emergency contact'].filter(Boolean) as string[];

  return (
    <div className="space-y-5">
      {canEdit && missing.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-100">
          <span className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
            Missing from the admission record: {missing.join(', ')}.
          </span>
          <Link href={`/students/${s.id}/edit`} className="font-medium underline-offset-2 hover:underline">
            Complete the record
          </Link>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title={<span className="flex items-center gap-2"><IdCard className="h-4 w-4 text-slate-400" aria-hidden />Personal details</span>} actions={editLink()}>
          <DefinitionList
            items={[
              ['Gender', titleCase(s.gender)],
              ['Date of birth', s.dateOfBirth ? formatDate(s.dateOfBirth) : null],
              ['Class', classLabel],
              ['Roll number', s.rollNumber],
              ['Admission no.', s.admissionNumber],
              ['Admission date', s.admissionDate ? formatDate(s.admissionDate) : null],
              ['Academic year', s.academicYear?.name],
              ['Aadhaar', <AadhaarValue key="a" studentId={s.id} masked={s.aadhaarMasked} canReveal={canEdit} />],
              ['Social category', s.socialCategory],
              ['Religion', s.religion],
              ['Mother tongue', s.motherTongue],
              ['Nationality', s.nationality],
              ['House', s.house],
              ['PEN (UDISE+)', s.penNumber],
              ['APAAR ID', s.apaarId],
              ['Identification marks', s.identificationMarks],
              ['Status', titleCase(s.status)],
              ...(s.dateOfLeaving ? ([['Date of leaving', formatDate(s.dateOfLeaving)]] as Array<[string, string]>) : []),
            ]}
          />
        </Card>

        <div className="space-y-5">
          <Card title={<span className="flex items-center gap-2"><House className="h-4 w-4 text-slate-400" aria-hidden />Address</span>} actions={editLink('address')}>
            {a ? (
              <address className="text-sm not-italic leading-6">
                {a.line1}
                {a.line2 && (
                  <>
                    <br />
                    {a.line2}
                  </>
                )}
                <br />
                {a.city}, {a.state} <span className="tabular-nums">{a.pincode}</span>
              </address>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">No address on record.</p>
            )}
          </Card>

          <Card title={<span className="flex items-center gap-2"><HeartPulse className="h-4 w-4 text-slate-400" aria-hidden />Health and emergency</span>} actions={editLink('health')}>
            <DefinitionList
              items={[
                ['Blood group', s.medical?.bloodGroup ?? s.bloodGroup],
                ['Allergies', s.medical?.allergies ? <span className="font-medium text-red-700 dark:text-red-300">{s.medical.allergies}</span> : null],
                ['Medical notes', s.medical?.notes],
              ]}
            />
            <div className="mt-4">
              <Person
                role="Emergency contact"
                name={s.emergencyContact?.name ?? null}
                phone={s.emergencyContact?.phone}
                extra={s.emergencyContact?.relation}
              />
            </div>
          </Card>
        </div>
      </div>

      <Card title={<span className="flex items-center gap-2"><UsersRound className="h-4 w-4 text-slate-400" aria-hidden />Parents and guardian</span>} actions={editLink('family')}>
        <div className="grid gap-3 md:grid-cols-3">
          <Person role="Father" name={s.father?.name ?? null} phone={s.father?.phone} email={s.father?.email} extra={s.father?.occupation} primary={Boolean(primaryPhone && primaryPhone === s.father?.phone)} />
          <Person role="Mother" name={s.mother?.name ?? null} phone={s.mother?.phone} email={s.mother?.email} extra={s.mother?.occupation} primary={Boolean(primaryPhone && primaryPhone === s.mother?.phone)} />
          <Person
            role="Guardian"
            name={s.guardian?.name ?? null}
            phone={s.guardian?.phone}
            extra={s.guardian?.relation}
            primary={Boolean(primaryPhone && primaryPhone === s.guardian?.phone)}
          />
        </div>
        {s.parent && (
          <p className="mt-3 text-13 text-slate-500 dark:text-slate-400">
            Parent app login and SMS: <span className="font-medium text-slate-700 dark:text-slate-200">{s.parent.name}</span>, {displayPhone(s.parent.phone)}
          </p>
        )}
      </Card>

      <Card title={<span className="flex items-center gap-2"><School className="h-4 w-4 text-slate-400" aria-hidden />Previous school</span>} actions={editLink('previous')}>
        {s.previousSchool ? (
          <DefinitionList
            items={[
              ['School', s.previousSchool.name],
              ['Board', s.previousSchool.board],
              ['Last class passed', s.previousSchool.lastClassPassed],
              ['TC number', s.previousSchool.tcNumber],
              ['TC date', s.previousSchool.tcDate ? formatDate(s.previousSchool.tcDate) : null],
            ]}
          />
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">First admission (no previous school recorded).</p>
        )}
      </Card>
    </div>
  );
}
