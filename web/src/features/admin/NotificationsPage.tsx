'use client';

import { useState } from 'react';
import { DateRangeFilter, FilterBar, FilterSearch, FilteredEmpty, ResultCount, SelectFilter, chip, describeRange, useUrlFilters } from '@/components/filters';
import { RotateCw } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, Notice, Page, PageHeader, Pagination, Select, Spinner, Table, Td, Th, type BadgeTone } from '@/components/ui';
import { qs, useApi } from '@/lib/useApi';
import { ApiError, apiSend } from '@/lib/session';
import { formatDateTime, titleCase, todayIso } from '@/lib/format';
import { errorText, useFlash } from './shared';
import type { LogEvent, LogStatus, NotificationLog, Paged, Wrapped } from './types';

const STATUS_TONE: Record<LogStatus, BadgeTone> = { sent: 'green', sending: 'indigo', failed: 'red', abandoned: 'gray' };
const EVENT_LABEL: Record<LogEvent, string> = {
  absentee_alert: 'Absence alert',
  fee_due_reminder: 'Fee reminder',
  broadcast_notice: 'Notice',
  attendance_correction: 'Attendance correction',
};

const STATUS_LABEL: Record<LogStatus, string> = { sent: 'Sent', sending: 'Sending', failed: 'Failed', abandoned: 'Abandoned' };

/** /notifications?status=failed&eventType=…&from=…&to=…&search=… */
export default function NotificationsPage() {
  const flash = useFlash();
  const f = useUrlFilters({ search: '', status: '', eventType: '', from: '', to: '' });
  const { search, status, eventType, from, to } = f.values;
  const [retrying, setRetrying] = useState<string | null>(null);
  const { data, error, loading, reload } = useApi<Paged<NotificationLog>>(`/notifications/logs${qs({ search, status, eventType, from, to, page: f.page, limit: 25 })}`);
  const chips = [
    chip('search', 'Search', search, `“${search}”`, () => f.set({ search: '' })),
    chip('status', 'Status', status, STATUS_LABEL[status as LogStatus], () => f.set({ status: '' })),
    chip('eventType', 'Type', eventType, EVENT_LABEL[eventType as LogEvent], () => f.set({ eventType: '' })),
    (from || to) && { key: 'date', label: `Sent: ${describeRange(from, to, todayIso())}`, onRemove: () => f.set({ from: '', to: '' }) },
  ];

  async function retry(log: NotificationLog) {
    setRetrying(log.id);
    try {
      const res = await apiSend<Wrapped<NotificationLog>>('POST', `/notifications/logs/${log.id}/retry`);
      flash.show(res.data.status === 'sent' ? 'success' : 'warn', res.data.status === 'sent' ? 'Message sent.' : `Retried: ${res.data.lastError?.message ?? titleCase(res.data.status)}.`);
      reload();
    } catch (err) {
      // 502 = the retry ran but the SMS / WhatsApp gateway refused it again; the row shows the new error.
      flash.show('error', err instanceof ApiError && err.status === 502 ? 'Retried, but the gateway still could not deliver the message. See the error column.' : errorText(err));
      reload();
    } finally {
      setRetrying(null);
    }
  }

  return (
    <Page wide>
      <PageHeader title="SMS / WhatsApp log" description="Every message the school sent to parents and staff, with delivery status" />
      {flash.node}
      <div className="mb-4">
        <Notice tone="info">No SMS or WhatsApp provider is configured in this demo, so messages are recorded but fail to deliver. Connect a provider (MSG91 / Gupshup) to send them for real.</Notice>
      </div>
      <Card padded={false}>
        <FilterBar
          search={<FilterSearch value={search} onChange={(v) => f.set({ search: v })} placeholder="Phone, parent or student name" />}
          chips={chips}
          onClear={f.clear}
          extra={data ? <ResultCount total={data.meta.total} noun={['message', 'messages']} filtered={f.active > 0} /> : undefined}
        >
          <SelectFilter label="Status" name="status" value={status} allLabel="All statuses" options={(Object.keys(STATUS_LABEL) as LogStatus[]).map((k) => ({ value: k, label: STATUS_LABEL[k] }))} onChange={(v) => f.set({ status: v })} />
          <SelectFilter label="Type" name="eventType" value={eventType} allLabel="All types" options={(Object.keys(EVENT_LABEL) as LogEvent[]).map((k) => ({ value: k, label: EVENT_LABEL[k] }))} onChange={(v) => f.set({ eventType: v })} />
          <DateRangeFilter label="Sent" from={from} to={to} today={todayIso()} max={todayIso()} onChange={(r) => f.set(r)} />
        </FilterBar>
        {loading && !data ? (
          <Spinner label="Loading messages…" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data?.data.length ? (
          f.active > 0 ? (
            <FilteredEmpty what="messages" chips={chips} onClear={f.clear} />
          ) : (
            <EmptyState title="No messages" description="Absence alerts, fee reminders and notices sent by SMS / WhatsApp appear here." />
          )
        ) : (
          <div className={loading ? 'opacity-60' : undefined}>
            <Table>
              <thead>
                <tr>
                  <Th>Created</Th>
                  <Th>Type</Th>
                  <Th>Recipient</Th>
                  <Th>Student</Th>
                  <Th>Channel</Th>
                  <Th>Status</Th>
                  <Th align="right">Attempts</Th>
                  <Th>Error</Th>
                  <Th align="right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((l) => (
                  <tr key={l.id}>
                    <Td className="whitespace-nowrap">{formatDateTime(l.createdAt)}</Td>
                    <Td className="whitespace-nowrap">{EVENT_LABEL[l.eventType] ?? titleCase(l.eventType)}</Td>
                    <Td className="whitespace-nowrap">
                      {l.recipient.name ?? '-'}
                      <span className="block text-xs tabular-nums text-slate-500">{l.recipient.phone ?? ''}</span>
                    </Td>
                    <Td className="whitespace-nowrap">{l.student?.name ?? '-'}</Td>
                    <Td className="whitespace-nowrap">{l.channel ? titleCase(l.channel) : '-'}</Td>
                    <Td>
                      <Badge tone={STATUS_TONE[l.status]}>{titleCase(l.status)}</Badge>
                      {l.status === 'failed' && l.nextRetryAt && <span className="mt-0.5 block whitespace-nowrap text-xs text-slate-500">retry {formatDateTime(l.nextRetryAt)}</span>}
                    </Td>
                    <Td align="right">{l.attempts}</Td>
                    <Td className="max-w-[16rem]">
                      <span className="line-clamp-2 text-xs text-slate-600 dark:text-slate-300">{l.lastError ? l.lastError.message ?? l.lastError.code : '-'}</span>
                    </Td>
                    <Td align="right">
                      {(l.status === 'failed' || l.status === 'abandoned') && (
                        <Button size="sm" variant="secondary" icon={<RotateCw className="h-3.5 w-3.5" aria-hidden />} loading={retrying === l.id} onClick={() => retry(l)}>
                          Retry
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onChange={f.setPage} />
          </div>
        )}
      </Card>
    </Page>
  );
}
