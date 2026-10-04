'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ChevronRight, Pencil, Plus } from 'lucide-react';
import { Badge, Button, Card, cx, ErrorState, Notice, Page, PageHeader, Select, Spinner, Tabs, buttonClass } from '@/components/ui';
import { formatInr } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { useFlash } from '@/features/admin/shared';
import FeesNav from '@/features/fees/FeesNav';
import ConcessionsTab from './ConcessionsTab';
import HeadsTab, { HeadModal } from './HeadsTab';
import StructureEditor from './StructureEditor';
import type { FeeHead, Overview } from './types';

type Tab = 'classes' | 'heads' | 'concessions';
const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'classes', label: 'Class fees' },
  { value: 'heads', label: 'Fee heads' },
  { value: 'concessions', label: 'Concessions' },
];

type ClassRow = Overview['classes'][number];

/** Where a class stands: no fees yet, fees set but some students without them, or done. */
function classState(c: ClassRow): { label: string; tone: 'amber' | 'green' | 'gray' | 'indigo'; todo: boolean } {
  if (c.installments === 0) return { label: 'No fees set', tone: 'amber', todo: true };
  if (c.students === 0) return { label: 'No students yet', tone: 'gray', todo: false };
  const missing = c.students - c.studentsSetUp;
  if (missing > 0) return { label: `${missing} student${missing === 1 ? '' : 's'} without fees`, tone: 'indigo', todo: true };
  return { label: 'Set up', tone: 'green', todo: false };
}

/**
 * Fees → Fee structure (/fees/setup).
 *  - Class fees: every class with its yearly fee per student and a "Set fees" / "Edit fees" button;
 *    ?classId=… opens that class's editor (Back returns to the list).
 *  - Fee heads, Concessions: as before.
 */
export default function FeeSetupPage() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const flash = useFlash(9000);
  const tabParam = params.get('tab');
  const tab: Tab = TABS.some((t) => t.value === tabParam) ? (tabParam as Tab) : 'classes';
  // ?class= is the older link name.
  const classId = params.get('classId') ?? params.get('class') ?? '';
  const overview = useApi<{ data: Overview }>('/fees/structure/overview');
  const headsRes = useApi<{ data: FeeHead[] }>('/fees/heads');
  const heads = headsRes.data?.data ?? [];
  const classes = overview.data?.data.classes ?? [];
  const [headOpen, setHeadOpen] = useState(false);

  const go = (q: Record<string, string>, push = true) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v) sp.set(k, v);
    const url = sp.toString() ? `${pathname}?${sp}` : pathname;
    if (push) router.push(url, { scroll: true });
    else router.replace(url, { scroll: false });
  };
  const setTab = (t: Tab) => go({ tab: t === 'classes' ? '' : t, classId: t === 'classes' ? classId : '' }, false);
  const openClass = (id: string) => go({ classId: id });

  const reloadAll = () => {
    overview.reload();
    headsRes.reload();
  };
  const selected = classes.find((c) => c.id === classId);

  return (
    <Page wide>
      <FeesNav />
      <PageHeader
        title="Fee structure"
        description={
          overview.data
            ? `What each class pays in ${overview.data.data.academicYear.name}: fee heads, instalments and due dates. Applied fees show up in Fee collection.`
            : 'What each class pays: fee heads, instalments and due dates.'
        }
        actions={
          tab === 'classes' && !classId ? (
            <Button variant="secondary" icon={<Plus aria-hidden />} onClick={() => setHeadOpen(true)}>
              Add fee head
            </Button>
          ) : undefined
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
            <Notice tone="info">
              Add classes first (
              <Link href="/settings/academic" className="font-medium underline">
                Settings → Classes and subjects
              </Link>
              ), then set their fees here.
            </Notice>
          ) : classId && selected ? (
            <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
              <div className="space-y-3 lg:hidden">
                <Link href={pathname} className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-700 hover:underline dark:text-indigo-300">
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  All classes
                </Link>
                <Select label="Class" value={classId} onChange={(e) => go({ classId: e.target.value }, false)}>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.installments ? `${formatInr(c.annual)}/yr` : 'not set'}
                    </option>
                  ))}
                </Select>
              </div>
              <nav aria-label="Classes" className="hidden lg:block">
                <div className="sticky top-20 space-y-2">
                  <Link href={pathname} className="inline-flex items-center gap-1.5 px-1 text-sm font-medium text-indigo-700 hover:underline dark:text-indigo-300">
                    <ArrowLeft className="h-4 w-4" aria-hidden />
                    All classes
                  </Link>
                  <ul className="overflow-hidden rounded-xl border border-line bg-surface">
                    {classes.map((c) => {
                      const active = c.id === classId;
                      const st = classState(c);
                      return (
                        <li key={c.id} className="border-b border-line last:border-b-0">
                          <button
                            type="button"
                            onClick={() => go({ classId: c.id }, false)}
                            aria-current={active ? 'true' : undefined}
                            className={cx(
                              'relative flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors',
                              active ? 'bg-indigo-50/70 dark:bg-indigo-400/10' : 'hover:bg-slate-50 dark:hover:bg-white/[0.03]',
                            )}
                          >
                            {active && <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-marigold-400" />}
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium">{c.name}</span>
                              <span className={cx('block text-xs', st.todo ? 'text-amber-700 dark:text-amber-300' : 'text-slate-500 dark:text-slate-400')}>
                                {c.installments === 0 ? 'No fees set' : `${c.studentsSetUp}/${c.students} students set up`}
                              </span>
                            </span>
                            <span className={cx('shrink-0 text-sm tabular-nums', c.installments ? 'font-semibold' : 'text-slate-400')}>{c.installments ? formatInr(c.annual) : '—'}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </nav>
              <div className="min-w-0">
                <StructureEditor key={classId} overview={overview.data.data} classId={classId} heads={heads} onSaved={reloadAll} onHeadsChanged={headsRes.reload} flash={flash.show} />
              </div>
            </div>
          ) : (
            <ClassesOverview overview={overview.data.data} onOpen={openClass} />
          )
        ) : null)}

      {tab === 'heads' && <HeadsTab heads={heads} loading={headsRes.loading} error={headsRes.error} reload={reloadAll} flash={flash.show} />}
      {tab === 'concessions' && <ConcessionsTab heads={heads} flash={flash.show} />}

      <HeadModal
        open={headOpen}
        head={null}
        onClose={() => setHeadOpen(false)}
        onSaved={(h) => {
          setHeadOpen(false);
          flash.show('success', `Saved ${h.name}. Add it to a class with “Set fees” / “Edit fees”.`);
          headsRes.reload();
        }}
      />
    </Page>
  );
}

// ------------------------------------------------------------------ landing: every class

function ClassesOverview({ overview, onOpen }: { overview: Overview; onOpen: (classId: string) => void }) {
  const classes = overview.classes;
  const noFees = classes.filter((c) => c.installments === 0).length;
  const missing = classes.reduce((n, c) => n + (c.installments > 0 ? Math.max(0, c.students - c.studentsSetUp) : 0), 0);

  const action = (c: ClassRow, full = false) => {
    const set = c.installments === 0;
    return (
      <button
        type="button"
        onClick={() => onOpen(c.id)}
        aria-label={`${set ? 'Set fees' : 'Edit fees'} for ${c.name}`}
        className={cx(buttonClass({ variant: set ? 'primary' : 'secondary', size: 'sm' }), full && 'w-full justify-center')}
        data-class-action={c.name}
      >
        {set ? <Plus className="h-3.5 w-3.5" aria-hidden /> : <Pencil className="h-3.5 w-3.5" aria-hidden />}
        {set ? 'Set fees' : 'Edit fees'}
      </button>
    );
  };

  return (
    <div className="space-y-4" data-fee-classes>
      {(noFees > 0 || missing > 0) && (
        <Notice tone="info">
          {noFees > 0 && (
            <>
              <strong>{noFees}</strong> class{noFees === 1 ? ' has' : 'es have'} no fees yet: press <strong>Set fees</strong> to add tuition, annual charges and other fees.{' '}
            </>
          )}
          {missing > 0 && (
            <>
              <strong>{missing}</strong> student{missing === 1 ? '' : 's'} in classes with fees {missing === 1 ? 'does' : 'do'} not have them yet: open the class and press <strong>Apply to students</strong>.
            </>
          )}
        </Notice>
      )}

      <Card padded={false} title={`Classes · ${overview.academicYear.name}`} description="Yearly fee per student, from the class's fee structure">
        {/* phones: one card per class */}
        <ul className="divide-y divide-line sm:hidden">
          {classes.map((c) => {
            const st = classState(c);
            return (
              <li key={c.id} className="space-y-2.5 px-4 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <button type="button" onClick={() => onOpen(c.id)} className="min-w-0 text-left">
                    <span className="block font-semibold">{c.name}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      {c.installments ? `${c.heads} fee head${c.heads === 1 ? '' : 's'} · ${c.installments} instalments` : 'Nothing set'} · {c.students} student{c.students === 1 ? '' : 's'}
                    </span>
                  </button>
                  <span className={cx('shrink-0 text-right text-sm tabular-nums', c.installments ? 'font-semibold' : 'text-slate-400')}>
                    {c.installments ? formatInr(c.annual) : '—'}
                    {c.installments > 0 && <span className="block text-xs font-normal text-slate-500">a year</span>}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Badge tone={st.tone}>{st.label}</Badge>
                  {action(c)}
                </div>
              </li>
            );
          })}
        </ul>

        {/* tablets and up */}
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-line bg-surface-muted text-left text-13 text-slate-500 dark:text-slate-400">
                <th scope="col" className="px-5 py-2.5 font-medium">Class</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Yearly fee per student</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Fee lines</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Students</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                <th scope="col" className="px-5 py-2.5 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {classes.map((c) => {
                const st = classState(c);
                return (
                  <tr key={c.id} className="group transition-colors hover:bg-slate-50/70 dark:hover:bg-white/[0.025]" data-class-row={c.name}>
                    <th scope="row" className="px-5 py-3 text-left font-normal">
                      <button type="button" onClick={() => onOpen(c.id)} className="inline-flex items-center gap-1 font-semibold text-slate-900 hover:text-indigo-700 dark:text-white dark:hover:text-indigo-300">
                        {c.name}
                        <ChevronRight className="h-3.5 w-3.5 text-slate-400 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                      </button>
                    </th>
                    <td className="px-4 py-3 text-right tabular-nums">{c.installments ? <span className="font-semibold">{formatInr(c.annual)}</span> : <span className="text-slate-400">—</span>}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {c.installments ? (
                        <>
                          {c.heads} fee head{c.heads === 1 ? '' : 's'}
                          <span className="text-slate-400"> · {c.installments} instalments</span>
                        </>
                      ) : (
                        <span className="text-slate-400">None</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600 dark:text-slate-300">
                      {c.installments > 0 && c.students > 0 ? `${c.studentsSetUp} / ${c.students}` : c.students}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </td>
                    <td className="px-5 py-3 text-right">{action(c)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="text-13 text-slate-500 dark:text-slate-400">
        Need a fee that only some students pay, like an exam fee, a picnic or a lost ID card? Use{' '}
        <Link href="/fees" className="font-medium text-indigo-700 hover:underline dark:text-indigo-300">
          Fee collection → Add charge
        </Link>
        .
      </p>
    </div>
  );
}
