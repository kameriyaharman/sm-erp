'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { RotateCw } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, Notice, Page, PageHeader, Pagination, Select, Spinner, Table, Td, Th, type BadgeTone } from '@/components/ui';
import { qs, useApi } from '@/lib/useApi';
import { ApiError, apiSend } from '@/lib/session';
import { formatDateTime, titleCase } from '@/lib/format';
import { FilterBar, errorText, useFlash } from './shared';
import type { LogEvent, LogStatus, NotificationLog, Paged, Wrapped } from './types';

const STATUS_TONE: Record<LogStatus, BadgeTone> = { sent: 'green', sending: 'indigo', failed: 'red', abandoned: 'gray' };
const EVENT_LABEL: Record<LogEvent, string> = {
  absentee_alert: 'Absence alert',
  fee_due_reminder: 'Fee reminder',
  broadcast_notice: 'Notice',
  attendance_correction: 'Attendance correction',
};

export default function NotificationsPage() {
  const params = useSearchParams();
  const flash = useFlash();
  const [status, setStatus] = useState<'' | LogStatus>('');
  const [eventType, setEventType] = useState<'' | LogEvent>((params.get('eventType') as LogEvent | null) ?? '');
  const [page, setPage] = useState(1);
  const [retrying, setRetrying] = useState<string | null>(null);
  useEffect(() => setPage(1), [status, eventType]);
  const { data, error, loading, reload } = useApi<Paged<NotificationLog>>(`/notifications/logs${qs({ status, eventType, page, limit: 25 })}`);

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
        <FilterBar>
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="">All statuses</option>
            <option value="sent">Sent</option>
            <option value="sending">Sending</option>
            <option value="failed">Failed</option>
            <option value="abandoned">Abandoned</option>
          </Select>
          <Select label="Type" value={eventType} onChange={(e) => setEventType(e.target.value as typeof eventType)}>
            <option value="">All types</option>
            {(Object.keys(EVENT_LABEL) as LogEvent[]).map((k) => (
              <option key={k} value={k}>
                {EVENT_LABEL[k]}
              </option>
            ))}
          </Select>
          {data && <p className="pb-2 text-sm text-slate-500 dark:text-slate-400">{data.meta.total.toLocaleString('en-IN')} messages</p>}
        </FilterBar>
        {loading && !data ? (
          <Spinner label="Loading messages…" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data?.data.length ? (
          <EmptyState title="No messages" description={status || eventType ? 'Nothing matches these filters.' : 'Absence alerts, fee reminders and notices sent by SMS / WhatsApp appear here.'} />
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
            <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onChange={setPage} />
          </div>
        )}
      </Card>
    </Page>
  );
}
