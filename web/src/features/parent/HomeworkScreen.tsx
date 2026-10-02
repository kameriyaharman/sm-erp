'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, CircleAlert, Clock, LoaderCircle, NotebookPen } from 'lucide-react';
import { apiGet } from '@/lib/session';
import { EmptyBlock, ErrorBlock, Loading, secondaryBtn } from './ParentLayout';
import { daysUntil, relativeAgo, shortDate, WEEKDAYS, parseDay } from './format';
import type { ChildHome, HomeworkRow, PageMeta } from './types';

const PAGE = 30;
type Group = { key: string; title: string; tone: 'critical' | 'warning' | 'neutral' | 'muted'; items: HomeworkRow[] };

function groupOf(due: string): Group['key'] {
  const d = daysUntil(due);
  if (d < -7) return 'earlier';
  if (d < 0) return 'overdue';
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  return 'upcoming';
}

const GROUPS: Omit<Group, 'items'>[] = [
  { key: 'overdue', title: 'Overdue', tone: 'critical' },
  { key: 'today', title: 'Due today', tone: 'warning' },
  { key: 'tomorrow', title: 'Due tomorrow', tone: 'warning' },
  { key: 'upcoming', title: 'Upcoming', tone: 'neutral' },
  { key: 'earlier', title: 'Earlier', tone: 'muted' },
];

export default function HomeworkScreen({ home }: { home: ChildHome }) {
  const [rows, setRows] = useState<HomeworkRow[] | null>(null);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [subject, setSubject] = useState<string>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const childId = home.child.id;

  async function load(page: number) {
    setError(null);
    if (page > 1) setLoadingMore(true);
    try {
      const r = await apiGet<{ data: HomeworkRow[]; meta: PageMeta }>(`/parent/children/${childId}/homework?page=${page}&limit=${PAGE}`);
      setRows((prev) => (page === 1 ? r.data : [...(prev ?? []), ...r.data]));
      setMeta(r.meta);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childId]);

  if (error && !rows) return <ErrorBlock message={error} onRetry={() => load(1)} />;
  if (!rows) return <Loading label="Loading homework" />;
  if (rows.length === 0) {
    return <EmptyBlock icon={NotebookPen} title="No homework yet" description={`Homework set for ${home.child.className} ${home.child.sectionName} will show up here.`} />;
  }

  const subjects = [...new Set(rows.map((r) => r.subject?.name ?? 'General'))].sort();
  const visible = subject === 'all' ? rows : rows.filter((r) => (r.subject?.name ?? 'General') === subject);
  const groups: Group[] = GROUPS.map((g) => ({
    ...g,
    items: visible
      .filter((r) => groupOf(r.dueDate) === g.key)
      .sort((a, b) => (g.key === 'earlier' || g.key === 'overdue' ? b.dueDate.localeCompare(a.dueDate) : a.dueDate.localeCompare(b.dueDate))),
  })).filter((g) => g.items.length > 0);

  return (
    <>
      <div role="radiogroup" aria-label="Filter by subject" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:-mx-6 sm:px-6">
        {['all', ...subjects].map((s) => {
          const selected = s === subject;
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setSubject(s)}
              className={[
                'h-9 shrink-0 rounded-full px-3.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600',
                selected
                  ? 'bg-indigo-600 text-white dark:bg-indigo-300 dark:text-stone-950'
                  : 'bg-white text-stone-700 ring-1 ring-inset ring-stone-200 hover:bg-stone-100 dark:bg-surface dark:text-stone-300 dark:ring-line-strong dark:hover:bg-white/5',
              ].join(' ')}
            >
              {s === 'all' ? 'All subjects' : s}
            </button>
          );
        })}
      </div>

      {groups.length === 0 && <EmptyBlock icon={NotebookPen} title={`No ${subject} homework`} description="Try another subject." />}

      {groups.map((g) => (
        <section key={g.key} aria-labelledby={`hw-${g.key}`}>
          <h2 id={`hw-${g.key}`} className="mb-2.5 flex items-center gap-2 text-sm font-semibold">
            {g.tone === 'critical' && <CircleAlert className="h-4 w-4 text-red-600 dark:text-red-400" aria-hidden />}
            {g.tone === 'warning' && <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />}
            <span className={g.tone === 'muted' ? 'text-stone-500 dark:text-stone-400' : ''}>{g.title}</span>
            <span className="rounded-full bg-stone-200/80 px-2 text-xs font-semibold text-stone-600 dark:bg-white/[0.06] dark:text-stone-300">{g.items.length}</span>
          </h2>
          <ul className="flex flex-col gap-2.5">
            {g.items.map((item) => {
              const open = openId === item.id;
              const panelId = `hwp-${item.id}`;
              const due = parseDay(item.dueDate);
              return (
                <li
                  key={item.id}
                  className={`rounded-xl border bg-white dark:bg-surface ${g.tone === 'critical' ? 'border-red-200 dark:border-red-500/30' : 'border-stone-200 dark:border-line'} ${g.tone === 'muted' ? 'opacity-80' : ''}`}
                >
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => setOpenId(open ? null : item.id)}
                    className="flex w-full items-start gap-3 rounded-xl p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-600 dark:bg-indigo-600/25 dark:text-indigo-200">{item.subject?.name ?? 'General'}</span>
                        <span className="text-xs text-stone-500 dark:text-stone-400">
                          Due {WEEKDAYS[due.getDay()]} {shortDate(item.dueDate)}
                        </span>
                      </span>
                      <span className={`mt-1.5 block text-[15px] font-medium leading-snug ${open ? '' : 'line-clamp-2'}`}>{item.title}</span>
                      <span className="mt-1 block text-xs text-stone-500 dark:text-stone-400">
                        {item.teacher.name ? `${item.teacher.name}, ` : ''}
                        {relativeAgo(item.assignedAt)}
                      </span>
                    </span>
                    <ChevronDown className={`mt-1 h-5 w-5 shrink-0 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
                  </button>
                  <div id={panelId} hidden={!open} className="border-t border-stone-100 px-4 pb-4 pt-3 text-sm dark:border-line">
                    {item.details ? <p className="whitespace-pre-line leading-relaxed text-stone-700 dark:text-stone-300">{item.details}</p> : <p className="text-stone-500 dark:text-stone-400">No extra instructions from the teacher.</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {error && rows && (
        <p role="alert" className="text-center text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      {meta && meta.page < meta.totalPages && (
        <button type="button" className={`${secondaryBtn} self-center`} onClick={() => load(meta.page + 1)} disabled={loadingMore}>
          {loadingMore && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
          Show older homework
        </button>
      )}
    </>
  );
}
