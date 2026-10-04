'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, cx, ErrorState, Notice, Page, PageHeader, Select, Spinner, Tabs } from '@/components/ui';
import { formatInr } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { useFlash } from '@/features/admin/shared';
import ConcessionsTab from './ConcessionsTab';
import HeadsTab from './HeadsTab';
import StructureEditor from './StructureEditor';
import type { FeeHead, Overview } from './types';

type Tab = 'classes' | 'heads' | 'concessions';
const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'classes', label: 'Class fees' },
  { value: 'heads', label: 'Fee heads' },
  { value: 'concessions', label: 'Concessions' },
];

export default function FeeSetupPage() {
  const params = useSearchParams();
  const flash = useFlash(9000);
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t.value === params.get('tab')) ? (params.get('tab') as Tab) : 'classes');
  const overview = useApi<{ data: Overview }>('/fees/structure/overview');
  const headsRes = useApi<{ data: FeeHead[] }>('/fees/heads');
  const heads = headsRes.data?.data ?? [];
  const classes = overview.data?.data.classes ?? [];
  const [classId, setClassId] = useState(params.get('class') ?? '');

  useEffect(() => {
    if (!classId && classes.length) setClassId((classes.find((c) => c.installments === 0) ?? classes[0]).id);
  }, [classId, classes]);

  const reloadAll = () => {
    overview.reload();
    headsRes.reload();
  };

  return (
    <Page wide>
      <PageHeader
        title="Fee structure"
        description={
          overview.data
            ? `How much each class pays in ${overview.data.data.academicYear.name}, in which instalments and by which due dates.`
            : 'How much each class pays, in which instalments and by which due dates.'
        }
      />
      {flash.node}
      <Tabs value={tab} onChange={setTab} items={TABS} />

      {tab === 'classes' &&
        (overview.loading && !overview.data ? (
          <Spinner label="Loading classes…" />
        ) : overview.error ? (
          <Card>
            <ErrorState message={overview.error} onRetry={overview.reload} />
          </Card>
        ) : overview.data ? (
          classes.length === 0 ? (
            <Notice tone="info">Add classes first (Settings → Classes and subjects), then set their fees here.</Notice>
          ) : (
            <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
              <div className="lg:hidden">
                <Select label="Class" value={classId} onChange={(e) => setClassId(e.target.value)}>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.installments ? `${formatInr(c.annual)}/yr` : 'not set'}
                    </option>
                  ))}
                </Select>
              </div>
              <nav aria-label="Classes" className="hidden lg:block">
                <ul className="sticky top-20 overflow-hidden rounded-xl border border-line bg-surface">
                  {classes.map((c) => {
                    const active = c.id === classId;
                    const pending = c.installments > 0 && c.students > c.studentsSetUp;
                    return (
                      <li key={c.id} className="border-b border-line last:border-b-0">
                        <button
                          type="button"
                          onClick={() => setClassId(c.id)}
                          aria-current={active ? 'true' : undefined}
                          className={cx(
                            'relative flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors',
                            active ? 'bg-indigo-50/70 dark:bg-indigo-400/10' : 'hover:bg-slate-50 dark:hover:bg-white/[0.03]',
                          )}
                        >
                          {active && <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-marigold-400" />}
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">{c.name}</span>
                            <span className={cx('block text-xs', pending ? 'text-amber-700 dark:text-amber-300' : 'text-slate-500 dark:text-slate-400')}>
                              {c.installments === 0 ? 'No fees set' : `${c.studentsSetUp}/${c.students} students set up`}
                            </span>
                          </span>
                          <span className={cx('shrink-0 text-sm tabular-nums', c.installments ? 'font-semibold' : 'text-slate-400')}>{c.installments ? formatInr(c.annual) : '—'}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </nav>
              <div className="min-w-0">
                {classId && (
                  <StructureEditor key={classId} overview={overview.data.data} classId={classId} heads={heads} onSaved={reloadAll} flash={flash.show} />
                )}
              </div>
            </div>
          )
        ) : null)}

      {tab === 'heads' && <HeadsTab heads={heads} loading={headsRes.loading} error={headsRes.error} reload={reloadAll} flash={flash.show} />}
      {tab === 'concessions' && <ConcessionsTab heads={heads} flash={flash.show} />}
    </Page>
  );
}
