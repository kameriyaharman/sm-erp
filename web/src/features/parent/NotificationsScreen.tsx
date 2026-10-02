'use client';

import { useEffect, useState } from 'react';
import { BellOff, Pin } from 'lucide-react';
import { EmptyBlock, ErrorBlock, Loading, PCard, loadNotices, markNoticesSeen } from './ParentLayout';
import { relativeAgo, tsDate } from './format';
import type { SchoolNotice } from './types';

const SEEN_KEY = 'sm_parent_notices_seen';

/** School notices for this parent (all children), pinned first then newest. */
export default function NotificationsScreen() {
  const [notices, setNotices] = useState<SchoolNotice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // What was unread when the screen opened, so the dots stay visible on this visit.
  const [seenBefore] = useState(() => {
    try {
      return localStorage.getItem(SEEN_KEY) ?? '';
    } catch {
      return '';
    }
  });

  function load(force = false) {
    setError(null);
    loadNotices(force).then(
      (list) => {
        setNotices(list);
        markNoticesSeen(list.reduce((max, n) => (n.createdAt > max ? n.createdAt : max), ''));
      },
      (e: Error) => setError(e.message),
    );
  }
  useEffect(() => load(true), []);

  if (error) return <ErrorBlock message={error} onRetry={() => load(true)} />;
  if (!notices) return <Loading label="Loading notices" />;
  if (notices.length === 0) return <EmptyBlock icon={BellOff} title="No notices yet" description="Messages from the school will appear here." />;

  const sorted = [...notices].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt));

  return (
    <ul className="flex flex-col gap-3">
      {sorted.map((n) => {
        const unread = n.createdAt > seenBefore;
        return (
          <PCard as="li" key={n.id} className={`p-4 ${n.pinned ? 'border-[#0b6b78]/40 bg-[#f4fafa] dark:border-[#5cc0cc]/30 dark:bg-[#0b6b78]/10' : ''}`}>
            <div className="flex items-start gap-2">
              {unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#d03b3b]" aria-label="New" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {n.pinned && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#0b6b78] px-2 py-0.5 text-[11px] font-bold text-white dark:bg-[#5cc0cc] dark:text-stone-950">
                      <Pin className="h-3 w-3" aria-hidden />
                      Pinned
                    </span>
                  )}
                  {n.class && (
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold text-stone-600 dark:bg-stone-800 dark:text-stone-300">{n.class.name}</span>
                  )}
                </div>
                <h2 className="mt-1 text-[15px] font-semibold leading-snug">{n.title}</h2>
                <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-stone-700 dark:text-stone-300">{n.body}</p>
                <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
                  <time dateTime={n.createdAt} title={tsDate(n.createdAt)}>
                    {relativeAgo(n.createdAt)}
                  </time>
                  {n.createdBy?.name ? ` · ${n.createdBy.name}` : ''}
                </p>
              </div>
            </div>
          </PCard>
        );
      })}
    </ul>
  );
}
