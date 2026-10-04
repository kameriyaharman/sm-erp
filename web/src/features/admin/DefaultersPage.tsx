'use client';

import FeesNav from '@/features/fees/FeesNav';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BellRing } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, Page, PageHeader, Pagination, Spinner, Stat, Table, Td, Th } from '@/components/ui';
import { ClassSectionFilter, FilterBar, FilterSearch, FilteredEmpty, SelectFilter, chip, classSectionChips, useClassOptions, useUrlFilters } from '@/components/filters';
import { qs, useApi } from '@/lib/useApi';
import { apiSend } from '@/lib/session';
import { formatDate, formatInr } from '@/lib/format';
import { ConfirmModal, PhoneLink, errorText, useFlash } from './shared';
import type { BatchStarted, DefaulterRow, DefaultersMeta, FeeReminderPreview, Paged, Wrapped } from './types';

function severity(days: number): { tone: 'red' | 'amber' | 'gray'; label: string } {
  if (days >= 90) return { tone: 'red', label: '90+ days' };
  if (days >= 30) return { tone: 'amber', label: '30+ days' };
  return { tone: 'gray', label: 'Recently due' };
}

const DAYS = [
  { value: '0', label: 'Any time' },
  { value: '30', label: '30+ days' },
  { value: '60', label: '60+ days' },
  { value: '90', label: '90+ days' },
];
const AMOUNTS = [
  { value: '5000', label: '₹5,000+' },
  { value: '10000', label: '₹10,000+' },
  { value: '25000', label: '₹25,000+' },
];
const SORTS = [
  { value: 'amount', label: 'Highest due' },
  { value: 'days', label: 'Longest overdue' },
];

/** /fees/defaulters?classId=…&sectionId=…&minDays=30&minAmount=5000&search=…&sort=days */
const DEFAULTS = { search: '', classId: '', sectionId: '', minDays: '0', minAmount: '', sort: 'amount' };

export default function DefaultersPage() {
  const router = useRouter();
  const f = useUrlFilters(DEFAULTS);
  const cls = useClassOptions();
  const flash = useFlash(12000);
  const { search, classId, sectionId, minDays, minAmount } = f.values;
  const sort = f.values.sort === 'days' ? 'days' : 'amount';

  const { data, error, loading, reload } = useApi<Paged<DefaulterRow, DefaultersMeta>>(
    `/finance/defaulters${qs({ search, classId, sectionId, minDaysOverdue: minDays && minDays !== '0' ? minDays : undefined, minAmount: minAmount || undefined, sort, page: f.page, limit: 25 })}`,
  );

  const chips = [
    chip('search', 'Search', search, `“${search}”`, () => f.set({ search: '' })),
    ...classSectionChips(cls, f.values, f.set),
    chip('minDays', 'Overdue', minDays, DAYS.find((d) => d.value === minDays)?.label ?? `${minDays}+ days`, () => f.set({ minDays: '0' }), !minDays || minDays === '0'),
    chip('minAmount', 'Due', minAmount, AMOUNTS.find((a) => a.value === minAmount)?.label ?? `₹${minAmount}+`, () => f.set({ minAmount: '' })),
  ];
  // Reminders go to the class / section in the filters (the server supports both); the other filters don't apply to them.
  const reminderScope = sectionId
    ? `${cls.section(sectionId)?.label ?? 'this section'}`
    : classId
      ? `${cls.className(classId) ?? 'this class'}`
      : 'the whole school';

  // ---- reminders: dry run first, then confirm
  const daysAhead = 3;
  const [preview, setPreview] = useState<FeeReminderPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const reminderBody = { daysAhead, includeOverdue: true, ...(classId && { classId }), ...(sectionId && { sectionId }) };

  async function startReminders() {
    setPreviewing(true);
    setSendError(null);
    try {
      const res = await apiSend<Wrapped<FeeReminderPreview>>('POST', '/notifications/fee-reminders/run', { ...reminderBody, dryRun: true });
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
      await apiSend<Wrapped<BatchStarted>>('POST', '/notifications/fee-reminders/run', { ...reminderBody, dryRun: false });
      const n = preview?.reminders ?? 0;
      setPreview(null);
      flash.show(
        'success',
        <span>
          Sending {n} fee reminder{n === 1 ? '' : 's'} to parents in {reminderScope} in the background.{' '}
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
      <FeesNav />
      <PageHeader
        title="Fee defaulters"
        description={data ? `Overdue invoices as of ${formatDate(data.meta.asOf)}` : 'Students with overdue invoices'}
        actions={
          <Button icon={<BellRing className="h-4 w-4" aria-hidden />} onClick={startReminders} loading={previewing}>
            {classId || sectionId ? `Send reminders: ${reminderScope}` : 'Send fee reminders'}
          </Button>
        }
      />
      {flash.node}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Students overdue" value={data ? data.meta.total.toLocaleString('en-IN') : '-'} tone={data && data.meta.total > 0 ? 'bad' : 'default'} hint={chips.some(Boolean) ? 'matching the filters' : undefined} />
        <Stat label="Total outstanding" value={data ? formatInr(data.meta.totalOutstanding) : '-'} tone="bad" hint={chips.some(Boolean) ? 'matching the filters' : 'all overdue invoices'} />
        <Stat label="Average per student" value={data && data.meta.total ? formatInr(Math.round(Number(data.meta.totalOutstanding) / data.meta.total)) : '-'} />
      </div>
      <Card padded={false}>
        <FilterBar
          search={<FilterSearch value={search} onChange={(v) => f.set({ search: v })} placeholder="Student, admission no., parent" />}
          chips={chips}
          onClear={f.clear}
          extra={<SelectFilter label="Sort by" name="sort" value={sort} onChange={(v) => f.set({ sort: v })} options={SORTS} />}
        >
          <ClassSectionFilter options={cls} classId={classId} sectionId={sectionId} onChange={f.set} />
          <SelectFilter label="Overdue for" name="minDays" value={minDays || '0'} options={DAYS} onChange={(v) => f.set({ minDays: v })} />
          <SelectFilter label="Amount due" name="minAmount" value={minAmount} allLabel="Any amount" options={AMOUNTS} onChange={(v) => f.set({ minAmount: v })} />
        </FilterBar>
        {loading && !data ? (
          <Spinner label="Loading defaulters…" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data?.data.length ? (
          chips.some(Boolean) ? (
            <FilteredEmpty what="defaulters" chips={chips} onClear={f.clear} />
          ) : (
            <EmptyState title="No overdue fees" description="Everyone is up to date." />
          )
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
                    <tr key={d.studentId} className="cursor-pointer hover:bg-slate-50/70 dark:hover:bg-white/[0.025]" onClick={() => router.push(`/students/${d.studentId}`)}>
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
            <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onChange={f.setPage} />
          </div>
        )}
      </Card>

      <ConfirmModal open={!!preview} title="Send fee reminders?" tone="primary" confirmLabel={`Send ${preview?.reminders ?? 0} reminders`} busy={sending} error={sendError} onConfirm={sendReminders} onClose={() => setPreview(null)}>
        {preview && (
          <>
            <p>
              Parents of <strong>{preview.students}</strong> student{preview.students === 1 ? '' : 's'} in <strong>{reminderScope}</strong> will get an SMS / WhatsApp reminder for <strong>{formatInr(preview.totalDue)}</strong> due (overdue invoices and
              instalments due in the next {daysAhead} days).
            </p>
            {(search || (minDays && minDays !== '0') || minAmount) && (
              <p className="text-xs text-slate-500 dark:text-slate-400">Reminders follow the class and section filters only; search, days and amount filters do not narrow them.</p>
            )}
            {preview.noPhone > 0 && <p className="text-amber-700 dark:text-amber-300">{preview.noPhone} parent(s) have no mobile number and will be skipped.</p>}
            <p className="text-xs text-slate-500 dark:text-slate-400">No SMS provider is configured in the demo, so messages are logged as failed. See the SMS / WhatsApp log.</p>
          </>
        )}
      </ConfirmModal>
    </Page>
  );
}
