'use client';

import { useState } from 'react';
import { Badge, Card, EmptyState, ErrorState, Page, Pagination, Select, Spinner } from '@/components/ui';
import { qs, useApi } from '@/lib/useApi';
import { formatDateTime } from '@/lib/format';
import { SettingsHeader } from './bits';
import type { AuditRow } from './types';

const AREA_LABEL: Record<string, string> = {
  modules: 'Modules',
  communication: 'WhatsApp, SMS & email',
  templates: 'Templates',
  rules: 'Notification rules',
  attendance: 'Attendance',
  calendar: 'Holidays',
  messaging: 'Messaging',
  devices: 'Devices',
  subscription: 'Plan',
};

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.map(show).join(', ') : '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Settings -> Change log: who changed which setting, when. */
export default function AuditPage() {
  const [area, setArea] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, reload } = useApi<{ data: AuditRow[]; meta: { totalPages: number; total: number } }>(`/settings/audit${qs({ area, page, limit: 30 })}`);
  return (
    <Page>
      <SettingsHeader title="Change log" description="Every change to modules, messaging, templates, rules, attendance settings and devices. Passwords and tokens are never shown." />
      <Card padded={false}>
        <div className="border-b border-line p-3">
          <div className="w-60">
          <Select aria-label="Area" value={area} onChange={(e) => (setArea(e.target.value), setPage(1))}>
            <option value="">All areas</option>
            {Object.entries(AREA_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          </div>
        </div>
        {error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data ? (
          <Spinner skeleton />
        ) : data.data.length === 0 ? (
          <EmptyState title="No changes yet" />
        ) : (
          <>
            <ol className="divide-y divide-line">
              {data.data.map((r) => (
                <li key={r.id} className="px-4 py-3.5 sm:px-5">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge tone="indigo">{AREA_LABEL[r.area] ?? r.area}</Badge>
                    <span className="font-medium text-slate-900 dark:text-white">{r.summary}</span>
                  </div>
                  <p className="mt-1 text-13 text-slate-500 dark:text-slate-400">
                    {formatDateTime(r.createdAt)} · {r.actor ? r.actor.name : 'System'}
                    {r.branch ? ` · ${r.branch.name}` : ''}
                  </p>
                  {r.changes && Object.keys(r.changes).length > 0 && (
                    <details className="mt-2 text-13">
                      <summary className="cursor-pointer text-indigo-700 dark:text-indigo-300">{Object.keys(r.changes).length} field{Object.keys(r.changes).length === 1 ? '' : 's'} changed</summary>
                      <table className="mt-2 w-full text-left">
                        <tbody>
                          {Object.entries(r.changes).map(([field, [before, after]]) => (
                            <tr key={field} className="align-top">
                              <td className="py-0.5 pr-3 font-mono text-xs text-slate-500">{field}</td>
                              <td className="py-0.5 pr-3 text-red-700 line-through decoration-red-300 dark:text-red-300">{show(before)}</td>
                              <td className="py-0.5 text-emerald-700 dark:text-emerald-300">{show(after)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  )}
                </li>
              ))}
            </ol>
            <Pagination page={page} totalPages={data.meta.totalPages} onChange={setPage} />
          </>
        )}
      </Card>
    </Page>
  );
}
