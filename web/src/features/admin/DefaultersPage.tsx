'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BellRing } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, Page, PageHeader, Pagination, Select, Spinner, Stat, Table, Td, Th } from '@/components/ui';
import { qs, useApi } from '@/lib/useApi';
import { apiSend } from '@/lib/session';
import { formatDate, formatInr } from '@/lib/format';
import { ConfirmModal, FilterBar, PhoneLink, errorText, useClasses, useFlash } from './shared';
import type { BatchStarted, DefaulterRow, DefaultersMeta, FeeReminderPreview, Paged, Wrapped } from './types';

function severity(days: number): { tone: 'red' | 'amber' | 'gray'; label: string } {
  if (days >= 90) return { tone: 'red', label: '90+ days' };
  if (days >= 30) return { tone: 'amber', label: '30+ days' };
  return { tone: 'gray', label: 'Recently due' };
}

export default function DefaultersPage() {
  const router = useRouter();
  const { classes, sections } = useClasses();
  const flash = useFlash(12000);
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [minDays, setMinDays] = useState(0);
  const [minAmount, setMinAmount] = useState(0);
  const [sort, setSort] = useState<'amount' | 'days'>('amount');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [classId, sectionId, minDays, minAmount, sort]);

  const { data, error, loading, reload } = useApi<Paged<DefaulterRow, DefaultersMeta>>(
    `/finance/defaulters${qs({ classId, sectionId, minDaysOverdue: minDays || undefined, minAmount: minAmount || undefined, sort, page, limit: 25 })}`,
  );
  const classSections = useMemo(() => sections.filter((s) => s.classId === classId), [sections, classId]);

  // ---- reminders: dry run first, then confirm
  const daysAhead = 3;
  const [preview, setPreview] = useState<FeeReminderPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  async function startReminders() {
    setPreviewing(true);
    setSendError(null);
    try {
      const res = await apiSend<Wrapped<FeeReminderPreview>>('POST', '/notifications/fee-reminders/run', { dryRun: true, daysAhead, includeOverdue: true });
      setPreview(res.data);
    } catch (err) {
      flash.show('error', errorText(err));
    } finally {
      setPreviewing(false);
    }
  }
  async function sendReminders() {
    setSending(true);
    setSendError(null);
    try {
      await apiSend<Wrapped<BatchStarted>>('POST', '/notifications/fee-reminders/run', { dryRun: false, daysAhead, includeOverdue: true });
      const n = preview?.reminders ?? 0;
      setPreview(null);
      flash.show(
        'success',
        <span>
          Sending {n} fee reminder{n === 1 ? '' : 's'} in the background.{' '}
          <Link href="/notifications?eventType=fee_due_reminder" className="font-medium underline">
            Track delivery
          </Link>
        </span>,
      );
    } catch (err) {
      setSendError(errorText(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <Page wide>
      <PageHeader
        title="Fee defaulters"
        description={data ? `Overdue invoices as of ${formatDate(data.meta.asOf)}` : 'Students with overdue invoices'}
        actions={
          <Button icon={<BellRing className="h-4 w-4" aria-hidden />} onClick={startReminders} loading={previewing}>
            Send fee reminders
          </Button>
        }
      />
      {flash.node}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Students overdue" value={data ? data.meta.total.toLocaleString('en-IN') : '-'} tone={data && data.meta.total > 0 ? 'bad' : 'default'} />
        <Stat label="Total outstanding" value={data ? formatInr(data.meta.totalOutstanding) : '-'} tone="bad" hint="matching the filters" />
        <Stat label="Average per student" value={data && data.meta.total ? formatInr(Math.round(Number(data.meta.totalOutstanding) / data.meta.total)) : '-'} />
      </div>
      <Card padded={false}>
        <FilterBar>
          <Select
            label="Class"
            value={classId}
            onChange={(e) => {
              setClassId(e.target.value);
              setSectionId('');
            }}
          >
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} disabled={!classId}>
            <option value="">All sections</option>
            {classSections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Select label="Overdue for" value={minDays} onChange={(e) => setMinDays(Number(e.target.value))}>
            <option value={0}>Any time</option>
            <option value={30}>30+ days</option>
            <option value={60}>60+ days</option>
            <option value={90}>90+ days</option>
          </Select>
          <Select label="Amount due" value={minAmount} onChange={(e) => setMinAmount(Number(e.target.value))}>
            <option value={0}>Any amount</option>
            <option value={5000}>₹5,000+</option>
            <option value={10000}>₹10,000+</option>
            <option value={25000}>₹25,000+</option>
          </Select>
          <Select label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="amount">Highest due</option>
            <option value="days">Longest overdue</option>
          </Select>
        </FilterBar>
        {loading && !data ? (
          <Spinner label="Loading defaulters…" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data?.data.length ? (
          <EmptyState title="No overdue fees" description="No student matches these filters. Everyone is up to date." />
        ) : (
          <div className={loading ? 'opacity-60' : undefined}>
            <Table>
              <thead>
                <tr>
                  <Th>Student</Th>
                  <Th>Class</Th>
                  <Th>Parent</Th>
                  <Th align="right">Open invoices</Th>
                  <Th>Oldest due</Th>
                  <Th>Overdue</Th>
                  <Th align="right">Total due</Th>
                  <Th align="right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((d) => {
                  const sev = severity(d.daysOverdue);
                  return (
                    <tr key={d.studentId} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => router.push(`/students/${d.studentId}`)}>
                      <Td>
                        <Link href={`/students/${d.studentId}`} onClick={(e) => e.stopPropagation()} className="whitespace-nowrap font-medium hover:text-indigo-700 hover:underline dark:hover:text-indigo-300">
                          {d.studentName}
                        </Link>
                        <p className="text-xs tabular-nums text-slate-500 dark:text-slate-400">{d.admissionNumber}</p>
                      </Td>
                      <Td className="whitespace-nowrap">{[d.class?.name, d.section?.name].filter(Boolean).join(' ') || '-'}</Td>
                      <Td className="whitespace-nowrap">
                        {d.parent?.name ?? '-'}
                        <span className="block" onClick={(e) => e.stopPropagation()}>
                          <PhoneLink phone={d.parent?.phone} className="text-xs" />
                        </span>
                      </Td>
                      <Td align="right">{d.openInvoices}</Td>
                      <Td className="whitespace-nowrap">{formatDate(d.oldestDueDate)}</Td>
                      <Td>
                        <Badge tone={sev.tone}>
                          {d.daysOverdue} days<span className="sr-only">, {sev.label}</span>
                        </Badge>
                      </Td>
                      <Td align="right" className="font-semibold">
                        {formatInr(d.totalDue)}
                      </Td>
                      <Td align="right">
                        <Link
                          href={`/fees?search=${encodeURIComponent(d.admissionNumber)}`}
                          onClick={(e) => e.stopPropagation()}
                          className="whitespace-nowrap text-sm font-medium text-indigo-700 hover:underline dark:text-indigo-300"
                        >
                          Collect
                        </Link>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onChange={setPage} />
          </div>
        )}
      </Card>

      <ConfirmModal open={!!preview} title="Send fee reminders?" tone="primary" confirmLabel={`Send ${preview?.reminders ?? 0} reminders`} busy={sending} error={sendError} onConfirm={sendReminders} onClose={() => setPreview(null)}>
        {preview && (
          <>
            <p>
              Parents of <strong>{preview.students}</strong> student{preview.students === 1 ? '' : 's'} will get an SMS / WhatsApp reminder for <strong>{formatInr(preview.totalDue)}</strong> due (overdue invoices and
              instalments due in the next {daysAhead} days).
            </p>
            {preview.noPhone > 0 && <p className="text-amber-700 dark:text-amber-300">{preview.noPhone} parent(s) have no mobile number and will be skipped.</p>}
            <p className="text-xs text-slate-500 dark:text-slate-400">No SMS provider is configured in the demo, so messages are logged as failed. See the SMS / WhatsApp log.</p>
          </>
        )}
      </ConfirmModal>
    </Page>
  );
}
