'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { ArrowLeft, Bus, FileBadge, FileDown, IndianRupee, Pencil, PlusCircle, Receipt, ScrollText } from 'lucide-react';
import { Badge, Button, buttonClass, Card, EmptyState, ErrorState, Notice, Page, PageHeader, Spinner, Stat, Table, Tabs, Td, Th } from '@/components/ui';
import { useApi } from '@/lib/useApi';
import { API_BASE, apiSend, getAccessToken, openPdf } from '@/lib/session';
import { formatDateTime, formatInr, formatTime, titleCase } from '@/lib/format';
import CollectFeeModal from '@/features/fees/CollectFeeModal';
import AddChargeModal from '@/features/fees/AddChargeModal';
import StudentFeeAccount from '@/features/fees/StudentFeeAccount';
import { createFeesApi, type StudentFeeRow } from '@/features/fees/api';
import { toPaise } from '@/features/fees/format';
import { ConfirmModal, DefinitionList, ReportCardBadge, StudentStatusBadge, errorText, useFlash } from '../shared';
import { BonafideModal, TcModal } from '../certificates/IssueModals';
import AssignModal from '../transport/AssignModal';
import StudentOverview, { StudentPhoto, Tel } from '@/features/setup/StudentOverview';
import type { StudentDetail, Wrapped } from '../types';

type Tab = 'overview' | 'fees' | 'attendance' | 'reports' | 'certificates' | 'transport';

export default function StudentProfile() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const { data, error, loading, reload, setData } = useApi<Wrapped<StudentDetail>>(`/students/${id}`);
  const flash = useFlash();
  const [tab, setTab] = useState<Tab>('overview');
  const [modal, setModal] = useState<null | 'collect' | 'charge' | 'bonafide' | 'tc' | 'bus' | 'unbus'>(null);
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [duesKey, setDuesKey] = useState(0);

  const feesApi = useMemo(() => createFeesApi({ baseUrl: API_BASE, getAccessToken }), []);
  const s = data?.data;

  if (loading && !s) return <Spinner label="Loading student…" />;
  if (error || !s) return <ErrorState message={error ?? 'Student not found'} onRetry={reload} />;

  const feeRow: StudentFeeRow = {
    studentId: s.id,
    branchId: '',
    studentName: s.name,
    admissionNumber: s.admissionNumber,
    rollNumber: s.rollNumber,
    class: s.class,
    section: s.section,
    academicYear: s.academicYear ?? { id: '', name: '' },
    totalFee: s.fees.totalFee,
    paid: s.fees.paid,
    pending: s.fees.pending,
    overdue: s.fees.overdue,
    notYetInvoiced: '0.00',
    openInvoices: 0,
    status: toPaise(s.fees.overdue) > 0 ? 'overdue' : toPaise(s.fees.pending) > 0 ? 'unpaid' : 'paid',
  };
  const classLabel = [s.class?.name, s.section?.name].filter(Boolean).join(' ') || 'No class';
  const active = s.status === 'enrolled' || s.status === 'suspended';
  const att = s.attendance;

  async function removeBus() {
    setBusy(true);
    setModalError(null);
    try {
      await apiSend('PUT', '/transport/assignments', { studentId: id, routeId: null });
      setModal(null);
      flash.show('success', 'Removed from school transport.');
      reload();
    } catch (err) {
      setModalError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page wide>
      <PageHeader
        back={
          <Link href="/students" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Students
          </Link>
        }
        title={s.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{classLabel}</span>
            <span className="tabular-nums">Adm. {s.admissionNumber}</span>
            {s.rollNumber && <span>Roll {s.rollNumber}</span>}
            <StudentStatusBadge status={s.status} />
          </span>
        }
        actions={
          <>
            <Link href={`/students/${s.id}/edit`} className={buttonClass({ variant: 'secondary' })}>
              <Pencil className="h-4 w-4" aria-hidden />
              Edit
            </Link>
            {active && (
              <Button icon={<IndianRupee className="h-4 w-4" aria-hidden />} onClick={() => setModal('collect')}>
                Collect fee
              </Button>
            )}
          </>
        }
      />
      {params.get('admitted') === '1' && !flash.flash && (
        <div className="mb-4">
          <Notice tone="success">
            Admission complete. {s.name} is in {classLabel} with admission number <strong>{s.admissionNumber}</strong>.
          </Notice>
        </div>
      )}
      {params.get('saved') === '1' && !flash.flash && (
        <div className="mb-4">
          <Notice tone="success">Student details saved.</Notice>
        </div>
      )}
      {params.get('warn') && (
        <div className="mb-4">
          <Notice tone="warn">{params.get('warn')}</Notice>
        </div>
      )}
      {flash.node}

      <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-4 rounded-xl border border-line bg-surface p-4">
        <StudentPhoto student={s} size="xl" />
        <div className="min-w-0 flex-1 basis-56">
          <p className="text-13 font-medium text-slate-500 dark:text-slate-400">Parent (login and SMS)</p>
          {s.parent ? (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-medium">{s.parent.name}</span>
              <Tel phone={s.parent.phone} />
              {s.parent.email && (
                <a href={`mailto:${s.parent.email}`} className="truncate text-indigo-700 hover:underline dark:text-indigo-300">
                  {s.parent.email}
                </a>
              )}
            </p>
          ) : (
            <p className="text-sm text-slate-500">No parent linked</p>
          )}
          {s.address && (
            <p className="mt-2 truncate text-13 text-slate-500 dark:text-slate-400" title={[s.address.line1, s.address.line2, s.address.city].filter(Boolean).join(', ')}>
              {[s.address.line2 ?? s.address.line1, s.address.city].filter(Boolean).join(', ')}
            </p>
          )}
        </div>
        {(s.medical?.allergies || s.medical?.bloodGroup) && (
          <div className="text-sm">
            <p className="text-13 font-medium text-slate-500 dark:text-slate-400">Health</p>
            <p className="mt-0.5">
              {s.medical.bloodGroup && <span className="font-medium">{s.medical.bloodGroup}</span>}
              {s.medical.allergies && <span className="ml-2 text-red-700 dark:text-red-300">Allergy: {s.medical.allergies}</span>}
            </p>
          </div>
        )}
        {s.transport && (
          <div className="text-sm">
            <p className="text-13 font-medium text-slate-500 dark:text-slate-400">Bus</p>
            <p className="mt-0.5">
              {s.transport.routeName}, {s.transport.stopName}
            </p>
          </div>
        )}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Fees paid" value={formatInr(s.fees.paid)} hint={`of ${formatInr(s.fees.totalFee)} this year`} tone={toPaise(s.fees.paid) > 0 ? 'good' : 'default'} />
        <Stat label="Pending" value={formatInr(s.fees.pending)} tone={toPaise(s.fees.pending) > 0 ? 'warn' : 'default'} hint="incl. not yet invoiced" />
        <Stat label="Overdue" value={formatInr(s.fees.overdue)} tone={toPaise(s.fees.overdue) > 0 ? 'bad' : 'default'} hint={toPaise(s.fees.overdue) > 0 ? 'past due date' : 'nothing overdue'} />
        <Stat
          label="Attendance"
          value={att.percentage === null ? '-' : `${att.percentage.toFixed(1)}%`}
          tone={att.percentage === null ? 'default' : att.percentage >= 85 ? 'good' : att.percentage >= 75 ? 'warn' : 'bad'}
          hint={`${att.workingDays} working days`}
        />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'overview', label: 'Overview' },
          { value: 'fees', label: 'Fees' },
          { value: 'attendance', label: 'Attendance' },
          { value: 'reports', label: `Report cards (${s.reportCards.length})` },
          { value: 'certificates', label: `Certificates (${s.certificates.length})` },
          { value: 'transport', label: 'Transport' },
        ]}
      />

      {tab === 'overview' && <StudentOverview s={s} canEdit />}

      {tab === 'fees' && (
        <FeesTab
          studentId={s.id}
          studentName={s.name}
          reloadKey={duesKey}
          canCollect={active}
          onCollect={() => setModal('collect')}
          onCharge={() => setModal('charge')}
          admissionNumber={s.admissionNumber}
          onChanged={reload}
          flash={flash.show}
        />
      )}

      {tab === 'attendance' && (
        <Card title="Attendance this year">
          {att.workingDays === 0 ? (
            <EmptyState title="No attendance marked yet" description="Registers taken for the student's section will show here." />
          ) : (
            <div className="space-y-5">
              <div className="flex h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden>
                {(
                  [
                    ['present', 'bg-emerald-500'],
                    ['late', 'bg-indigo-400'],
                    ['halfDay', 'bg-sky-400'],
                    ['leave', 'bg-amber-400'],
                    ['absent', 'bg-red-500'],
                  ] as const
                ).map(([k, cls]) => (
                  <div key={k} className={cls} style={{ width: `${(att[k] / att.workingDays) * 100}%` }} />
                ))}
              </div>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                {(
                  [
                    ['Working days', att.workingDays],
                    ['Present', att.present],
                    ['Late', att.late],
                    ['Half day', att.halfDay],
                    ['On leave', att.leave],
                    ['Absent', att.absent],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-13 font-medium text-slate-500 dark:text-slate-400">{k}</dt>
                    <dd className="text-lg font-semibold tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Attendance rate <strong className="text-slate-900 dark:text-slate-100">{att.percentage === null ? '-' : `${att.percentage.toFixed(1)}%`}</strong> (present + late + half of half days).{' '}
                <Link href="/attendance/history" className="text-indigo-700 hover:underline dark:text-indigo-300">
                  Section history
                </Link>
              </p>
            </div>
          )}
        </Card>
      )}

      {tab === 'reports' && (
        <Card title="Report cards" padded={false}>
          {s.reportCards.length === 0 ? (
            <EmptyState icon={<ScrollText className="h-7 w-7" aria-hidden />} title="No report cards yet" description="Generate them for the section under Report cards." action={<Link href="/report-cards" className="text-sm font-medium text-indigo-700 hover:underline dark:text-indigo-300">Go to report cards</Link>} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Report</Th>
                  <Th>Status</Th>
                  <Th align="right">Percentage</Th>
                  <Th>Grade</Th>
                  <Th>Published</Th>
                  <Th align="right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {s.reportCards.map((r) => (
                  <tr key={r.id}>
                    <Td className="font-medium">{r.label}</Td>
                    <Td>
                      <ReportCardBadge status={r.status} />
                    </Td>
                    <Td align="right">{r.percentage === null ? '-' : `${Number(r.percentage).toFixed(1)}%`}</Td>
                    <Td>{r.grade ?? '-'}</Td>
                    <Td className="whitespace-nowrap">{r.publishedAt ? formatDateTime(r.publishedAt) : '-'}</Td>
                    <Td align="right">
                      <PdfButton path={`/documents/report-cards/${r.id}/pdf`} filename={`${s.admissionNumber}-${r.label}.pdf`} onError={(m) => flash.show('error', m)} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === 'certificates' && (
        <Card
          title="Certificates"
          padded={false}
          actions={
            active && (
              <>
                <Button size="sm" variant="secondary" onClick={() => setModal('bonafide')}>
                  Issue bonafide
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setModal('tc')}>
                  Issue TC
                </Button>
              </>
            )
          }
        >
          {s.certificates.length === 0 ? (
            <EmptyState icon={<FileBadge className="h-7 w-7" aria-hidden />} title="No certificates issued" description="Bonafide and transfer certificates issued to this student are listed here." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Type</Th>
                  <Th>Number</Th>
                  <Th>Issued</Th>
                  <Th>Status</Th>
                  <Th align="right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {s.certificates.map((c) => (
                  <tr key={c.id}>
                    <Td className="whitespace-nowrap font-medium">{c.type === 'bonafide' ? 'Bonafide' : 'Transfer certificate'}</Td>
                    <Td className="whitespace-nowrap tabular-nums">{c.number}</Td>
                    <Td className="whitespace-nowrap">{formatDateTime(c.issuedAt)}</Td>
                    <Td>
                      <Badge tone={c.status === 'issued' ? 'green' : 'red'}>{titleCase(c.status)}</Badge>
                    </Td>
                    <Td align="right">
                      <PdfButton path={`/documents/certificates/${c.id}/pdf`} filename={`${c.number.replace(/\//g, '-')}.pdf`} onError={(m) => flash.show('error', m)} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === 'transport' && (
        <Card
          title="School transport"
          actions={
            active && (
              <>
                {s.transport && (
                  <Button size="sm" variant="ghost" onClick={() => setModal('unbus')}>
                    Remove
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={() => setModal('bus')}>
                  {s.transport ? 'Change route / stop' : 'Assign to a route'}
                </Button>
              </>
            )
          }
        >
          {s.transport ? (
            <DefinitionList
              items={[
                ['Route', <Link key="r" href="/transport" className="text-indigo-700 hover:underline dark:text-indigo-300">{s.transport.routeName}</Link>],
                ['Stop', s.transport.stopName],
                ['Pickup time', s.transport.pickupTime ? formatTime(s.transport.pickupTime) : null],
              ]}
            />
          ) : (
            <EmptyState icon={<Bus className="h-7 w-7" aria-hidden />} title="Does not use school transport" description="Assign a route and stop if the student takes the school bus." />
          )}
        </Card>
      )}

      {modal === 'collect' && (
        <CollectFeeModal
          api={feesApi}
          student={feeRow}
          onClose={() => setModal(null)}
          onCollected={(receipt) => {
            flash.show(
              'success',
              <span>
                Collected {formatInr(receipt.amount)}. Receipt {receipt.receiptNumber}.{' '}
                <button type="button" className="font-medium underline" onClick={() => openPdf(`/finance/receipts/${receipt.id}/pdf`, `${receipt.receiptNumber}.pdf`).catch((e) => flash.show('error', errorText(e)))}>
                  Print receipt
                </button>
              </span>,
            );
            reload();
            setDuesKey((k) => k + 1);
          }}
        />
      )}
      <AddChargeModal
        open={modal === 'charge'}
        student={{ id: s.id, name: s.name, classLabel }}
        onClose={() => setModal(null)}
        onDone={(r) => {
          setModal(null);
          flash.show('success', r.invoicesCreated > 0 ? `Charged ${formatInr(r.amount)} “${r.description}” to ${s.name}.` : `${s.name} already had this charge.`);
          reload();
          setDuesKey((k) => k + 1);
        }}
      />
      <BonafideModal student={s} open={modal === 'bonafide'} onClose={() => setModal(null)} onIssued={() => reload()} />
      <TcModal student={s} open={modal === 'tc'} onClose={() => setModal(null)} onIssued={() => reload()} />
      <AssignModal
        student={s}
        open={modal === 'bus'}
        currentRouteId={s.transport?.routeId}
        currentStopName={s.transport?.stopName}
        onClose={() => setModal(null)}
        onSaved={(msg) => {
          setModal(null);
          flash.show('success', msg);
          reload();
        }}
      />
      <ConfirmModal open={modal === 'unbus'} title="Remove from transport?" confirmLabel="Remove" busy={busy} error={modalError} onConfirm={removeBus} onClose={() => setModal(null)}>
        <p>
          {s.name} will no longer be on {s.transport?.routeName}. Transport fees already billed are not changed.
        </p>
      </ConfirmModal>
    </Page>
  );
}

function PdfButton({ path, filename, onError }: { path: string; filename: string; onError: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={busy}
      icon={<FileDown className="h-3.5 w-3.5" aria-hidden />}
      onClick={async () => {
        setBusy(true);
        try {
          await openPdf(path, filename);
        } catch (err) {
          onError(errorText(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      View PDF
    </Button>
  );
}

function FeesTab({ studentId, studentName, reloadKey, canCollect, onCollect, onCharge, admissionNumber, onChanged, flash }: { studentId: string; studentName: string; reloadKey: number; canCollect: boolean; onCollect: () => void; onCharge: () => void; admissionNumber: string; onChanged: () => void; flash: ReturnType<typeof useFlash>['show'] }) {
  return (
    <StudentFeeAccount
      studentId={studentId}
      studentName={studentName}
      canManage={canCollect}
      reloadKey={reloadKey}
      onChanged={onChanged}
      flash={flash}
      invoiceActions={
        <>
          <Link href={`/fees?search=${encodeURIComponent(admissionNumber)}`} className="text-sm font-medium text-indigo-700 hover:underline dark:text-indigo-300">
            Fee ledger
          </Link>
          {canCollect && (
            <Button size="sm" variant="secondary" icon={<PlusCircle className="h-3.5 w-3.5" aria-hidden />} onClick={onCharge}>
              Add charge
            </Button>
          )}
          {canCollect && (
            <Button size="sm" icon={<Receipt className="h-3.5 w-3.5" aria-hidden />} onClick={onCollect}>
              Collect fee
            </Button>
          )}
        </>
      }
    />
  );
}
