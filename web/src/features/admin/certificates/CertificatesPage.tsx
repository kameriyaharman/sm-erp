'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { FileBadge, FileDown, FilePlus2 } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, Notice, Page, PageHeader, Pagination, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { qs, useApi } from '@/lib/useApi';
import { apiSend, openPdf } from '@/lib/session';
import { formatDateTime, titleCase, todayIso } from '@/lib/format';
import { ClassSectionFilter, DateRangeFilter, FilterBar, FilterSearch, FilteredEmpty, ResultCount, SelectFilter, chip, classSectionChips, describeRange, useClassOptions, useUrlFilters } from '@/components/filters';
import { StudentPicker, errorText, useFlash } from '../shared';
import { BonafideModal, TcModal, type CertStudent } from './IssueModals';
import type { CertificateRow, CertificateType, Wrapped } from '../types';

const TYPE_LABEL: Record<CertificateType, string> = { bonafide: 'Bonafide', transfer_certificate: 'Transfer certificate' };

/** /certificates?type=…&status=…&classId=…&sectionId=…&from=…&to=…&search=… */
const FILTERS = { search: '', type: '', status: '', classId: '', sectionId: '', from: '', to: '' };
type CertPage = { data: CertificateRow[]; meta?: { page: number; limit: number; total: number; totalPages: number } };

export default function CertificatesPage() {
  const params = useSearchParams();
  const flash = useFlash();
  const f = useUrlFilters(FILTERS);
  const { search, type, status, classId, sectionId, from, to } = f.values;
  const cls = useClassOptions();
  const { data, error, loading, reload } = useApi<CertPage>(`/documents/certificates${qs({ search, type, status, classId, sectionId, from, to, page: f.page, limit: 50 })}`);
  const [picking, setPicking] = useState(false);
  const [student, setStudent] = useState<CertStudent | null>(null);
  const [issueType, setIssueType] = useState<CertificateType>('bonafide');
  const [issueOpen, setIssueOpen] = useState(false);
  const [cancelling, setCancelling] = useState<CertificateRow | null>(null);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);

  useEffect(() => {
    if (params.get('new') === '1') setPicking(true);
  }, [params]);

  async function pdf(c: CertificateRow, copy: 'original' | 'duplicate') {
    setPdfBusy(`${c.id}-${copy}`);
    try {
      await openPdf(`/documents/certificates/${c.id}/pdf${qs({ copy })}`, `${c.certificate_number.replace(/\//g, '-')}${copy === 'duplicate' ? '-duplicate' : ''}.pdf`);
      reload();
    } catch (err) {
      flash.show('error', errorText(err));
    } finally {
      setPdfBusy(null);
    }
  }

  const rows = data?.data ?? [];
  const chips = [
    chip('search', 'Search', search, `“${search}”`, () => f.set({ search: '' })),
    chip('type', 'Type', type, TYPE_LABEL[type as CertificateType], () => f.set({ type: '' })),
    chip('status', 'Status', status, titleCase(status), () => f.set({ status: '' })),
    ...classSectionChips(cls, f.values, f.set),
    (from || to) && { key: 'date', label: `Issued: ${describeRange(from, to, todayIso())}`, onRemove: () => f.set({ from: '', to: '' }) },
  ];

  return (
    <Page wide>
      <PageHeader
        title="Certificates"
        description="Bonafide and transfer certificate register"
        actions={
          <Button icon={<FilePlus2 className="h-4 w-4" aria-hidden />} onClick={() => setPicking(true)}>
            Issue certificate
          </Button>
        }
      />
      {flash.node}
      <Card padded={false}>
        <FilterBar
          search={<FilterSearch value={search} onChange={(v) => f.set({ search: v })} placeholder="Student, admission or certificate no." />}
          chips={chips}
          onClear={f.clear}
          extra={data?.meta ? <ResultCount total={data.meta.total} noun={['certificate', 'certificates']} filtered={f.active > 0} /> : undefined}
        >
          <SelectFilter
            label="Type"
            name="type"
            value={type}
            allLabel="All certificates"
            options={[
              { value: 'bonafide', label: 'Bonafide' },
              { value: 'transfer_certificate', label: 'Transfer certificates' },
            ]}
            onChange={(v) => f.set({ type: v })}
          />
          <SelectFilter
            label="Status"
            name="status"
            value={status}
            allLabel="Any status"
            options={[
              { value: 'issued', label: 'Issued' },
              { value: 'cancelled', label: 'Cancelled' },
            ]}
            onChange={(v) => f.set({ status: v })}
            className="sm:w-36"
          />
          <ClassSectionFilter options={cls} classId={classId} sectionId={sectionId} onChange={f.set} />
          <DateRangeFilter label="Issued" from={from} to={to} today={todayIso()} max={todayIso()} onChange={(r) => f.set(r)} />
        </FilterBar>
        {loading && !data ? (
          <Spinner label="Loading register…" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : rows.length === 0 && f.active > 0 ? (
          <FilteredEmpty what="certificates" chips={chips} onClear={f.clear} icon={<FileBadge className="h-7 w-7" aria-hidden />} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<FileBadge className="h-7 w-7" aria-hidden />} title="No certificates issued" description="Issue a bonafide or transfer certificate for a student." action={<Button onClick={() => setPicking(true)}>Issue certificate</Button>} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>Type</Th>
                <Th>Student</Th>
                <Th>Issued</Th>
                <Th align="right">Prints</Th>
                <Th>Status</Th>
                <Th align="right">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className={c.status === 'cancelled' ? 'opacity-70' : undefined}>
                  <Td className="whitespace-nowrap font-medium tabular-nums">{c.certificate_number}</Td>
                  <Td className="whitespace-nowrap">{TYPE_LABEL[c.certificate_type]}</Td>
                  <Td className="whitespace-nowrap">
                    <Link href={`/students/${c.student_id}`} className="hover:underline">
                      {c.student_name ?? 'Student'}
                    </Link>
                    <span className="block text-xs tabular-nums text-slate-500">{c.admission_number ?? ''}</span>
                  </Td>
                  <Td className="whitespace-nowrap">{formatDateTime(c.issued_at)}</Td>
                  <Td align="right">{c.print_count}</Td>
                  <Td>
                    <Badge tone={c.status === 'issued' ? 'green' : 'red'}>{titleCase(c.status)}</Badge>
                  </Td>
                  <Td align="right">
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="secondary" icon={<FileDown className="h-3.5 w-3.5" aria-hidden />} loading={pdfBusy === `${c.id}-original`} onClick={() => pdf(c, 'original')}>
                        PDF
                      </Button>
                      <Button size="sm" variant="ghost" loading={pdfBusy === `${c.id}-duplicate`} onClick={() => pdf(c, 'duplicate')}>
                        Duplicate
                      </Button>
                      {c.status === 'issued' && (
                        <Button size="sm" variant="ghost" className="text-red-600 dark:text-red-400" onClick={() => setCancelling(c)}>
                          Cancel
                        </Button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {data?.meta && <Pagination page={f.page} totalPages={data.meta.totalPages} onChange={f.setPage} />}
      </Card>

      <Modal open={picking} onClose={() => setPicking(false)} title="Issue a certificate">
        <div className="space-y-4">
          <Select label="Certificate" value={issueType} onChange={(e) => setIssueType(e.target.value as CertificateType)}>
            <option value="bonafide">Bonafide certificate</option>
            <option value="transfer_certificate">Transfer certificate (TC)</option>
          </Select>
          <div>
            <p className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-300">Student</p>
            <StudentPicker
              autoFocus={false}
              onPick={(s) => {
                setStudent({ id: s.id, name: s.name });
                setPicking(false);
                setIssueOpen(true);
              }}
            />
          </div>
        </div>
      </Modal>
      <BonafideModal
        student={student}
        open={issueOpen && issueType === 'bonafide'}
        onClose={() => setIssueOpen(false)}
        onIssued={(c) => {
          flash.show('success', `Bonafide ${c.number} issued to ${student?.name}.`);
          reload();
        }}
      />
      <TcModal
        student={student}
        open={issueOpen && issueType === 'transfer_certificate'}
        onClose={() => setIssueOpen(false)}
        onIssued={(c) => {
          flash.show('success', `Transfer certificate ${c.number} issued to ${student?.name}.`);
          reload();
        }}
      />
      <CancelModal
        cert={cancelling}
        onClose={() => setCancelling(null)}
        onCancelled={(note) => {
          setCancelling(null);
          flash.show('success', `Certificate cancelled.${note ? ` ${note}` : ''}`);
          reload();
        }}
      />
    </Page>
  );
}

function CancelModal({ cert, onClose, onCancelled }: { cert: CertificateRow | null; onClose: () => void; onCancelled: (note?: string) => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setReason('');
    setError(null);
  }, [cert]);

  async function submit() {
    if (!cert) return;
    if (reason.trim().length < 3) {
      setError('Give a reason for cancelling.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<Wrapped<{ id: string; status: string; note?: string }>>('POST', `/documents/certificates/${cert.id}/cancel`, { reason: reason.trim() });
      onCancelled(res.data.note);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!cert}
      onClose={busy ? () => undefined : onClose}
      title="Cancel certificate?"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Keep it
          </Button>
          <Button variant="danger" onClick={submit} loading={busy}>
            Cancel certificate
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p>
          <strong>{cert?.certificate_number}</strong> for {cert?.student_name} will be marked cancelled. Its QR code will show as cancelled when scanned.
        </p>
        <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={255} placeholder="e.g. Issued with a wrong date of birth" />
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}
