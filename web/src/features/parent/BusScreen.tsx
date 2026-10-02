'use client';

import { Bus, MapPin, Phone, UserRound } from 'lucide-react';
import { useApi } from '@/lib/useApi';
import { EmptyBlock, ErrorBlock, Loading, PCard, SectionTitle } from './ParentLayout';
import { displayPhone, telHref, time12 } from './format';
import type { ChildHome, ChildTransport } from './types';

export default function BusScreen({ home, schoolPhone }: { home: ChildHome; schoolPhone: string | null }) {
  const { data, error, loading, reload } = useApi<{ data: ChildTransport | null }>(`/parent/children/${home.child.id}/transport`);

  if (error) return <ErrorBlock message={error} onRetry={reload} />;
  if (loading && !data) return <Loading label="Loading bus details" />;
  const t = data?.data ?? null;
  if (!t) {
    return (
      <EmptyBlock
        icon={Bus}
        title={`${home.child.firstName} is not using school transport`}
        description={
          <>
            To start the school bus, contact the school office
            {schoolPhone ? (
              <>
                {' '}
                on{' '}
                <a href={telHref(schoolPhone)} className="font-semibold text-indigo-600 underline underline-offset-2 dark:text-indigo-200">
                  {schoolPhone}
                </a>
              </>
            ) : null}
            .
          </>
        }
      />
    );
  }

  const { route, stop, stops } = t;
  return (
    <>
      <PCard className="overflow-hidden" aria-label="Route">
        <div className="flex items-center gap-3 bg-indigo-600 px-4 py-4 text-white dark:bg-indigo-600/60">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white/15" aria-hidden>
            <Bus className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[17px] font-semibold leading-tight">{route.name}</p>
            {route.vehicleNumber && <p className="mt-0.5 text-sm tracking-wide text-white/85">{route.vehicleNumber}</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 divide-x divide-stone-100 border-b border-stone-100 dark:divide-line dark:border-line">
          <div className="px-4 py-3">
            <p className="text-xs font-medium text-stone-500 dark:text-stone-400">Morning pickup</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums">{time12(stop.pickupTime) || '–'}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-xs font-medium text-stone-500 dark:text-stone-400">Afternoon drop</p>
            <p className="mt-0.5 text-xl font-bold tabular-nums">{time12(stop.dropTime) || '–'}</p>
          </div>
        </div>
        <p className="flex items-center gap-2 px-4 py-3 text-sm">
          <MapPin className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-200" aria-hidden />
          <span>
            <span className="text-stone-500 dark:text-stone-400">Stop: </span>
            <span className="font-semibold">{stop.name}</span>
          </span>
        </p>

        {(route.driverName || route.attendantName) && (
          <ul className="border-t border-stone-100 dark:border-line">
            {route.driverName && (
              <li className="flex items-center gap-3 px-4 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-600 dark:bg-white/[0.06] dark:text-stone-300" aria-hidden>
                  <UserRound className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold">{route.driverName}</span>
                  <span className="block text-xs text-stone-500 dark:text-stone-400">Driver{route.driverPhone ? `, ${displayPhone(route.driverPhone)}` : ''}</span>
                </span>
                {route.driverPhone && (
                  <a
                    href={telHref(route.driverPhone)}
                    aria-label={`Call driver ${route.driverName}`}
                    className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-stone-900"
                  >
                    <Phone className="h-4 w-4" aria-hidden />
                    Call
                  </a>
                )}
              </li>
            )}
            {route.attendantName && (
              <li className="flex items-center gap-3 border-t border-stone-100 px-4 py-3 dark:border-line">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-600 dark:bg-white/[0.06] dark:text-stone-300" aria-hidden>
                  <UserRound className="h-[18px] w-[18px]" />
                </span>
                <span>
                  <span className="block text-[15px] font-semibold">{route.attendantName}</span>
                  <span className="block text-xs text-stone-500 dark:text-stone-400">Bus attendant</span>
                </span>
              </li>
            )}
          </ul>
        )}
      </PCard>

      <section aria-labelledby="stops-title">
        <SectionTitle id="stops-title" icon={MapPin}>
          Stops on this route
        </SectionTitle>
        <PCard as="div" className="px-4 py-2">
          <ol>
            {stops.map((s, i) => {
              const last = i === stops.length - 1;
              return (
                <li key={`${s.name}-${i}`} aria-current={s.isMine ? 'location' : undefined} className="relative flex gap-3">
                  <span className="relative flex w-5 shrink-0 justify-center" aria-hidden>
                    <span className={`absolute top-0 w-0.5 bg-stone-200 dark:bg-white/10 ${i === 0 ? 'top-1/2' : ''} ${last ? 'h-1/2' : 'bottom-0'}`} />
                    <span
                      className={[
                        'relative z-10 mt-[1.1rem] rounded-full',
                        s.isMine ? 'h-4 w-4 bg-indigo-600 ring-4 ring-indigo-50 dark:bg-indigo-300 dark:ring-indigo-600/30' : 'h-2.5 w-2.5 bg-stone-300 dark:bg-stone-600',
                      ].join(' ')}
                    />
                  </span>
                  <div className={`flex min-w-0 flex-1 items-center justify-between gap-3 py-3 ${s.isMine ? '' : ''}`}>
                    <div className="min-w-0">
                      <p className={`truncate ${s.isMine ? 'text-[15px] font-semibold text-indigo-600 dark:text-indigo-200' : 'text-sm text-stone-700 dark:text-stone-300'}`}>{s.name}</p>
                      {s.isMine && <p className="text-xs font-medium text-stone-500 dark:text-stone-400">{home.child.firstName}&apos;s stop</p>}
                    </div>
                    <div className="shrink-0 text-right text-xs tabular-nums text-stone-500 dark:text-stone-400">
                      <span className="block">
                        <span className="sr-only">Pickup </span>
                        {time12(s.pickupTime)}
                      </span>
                      <span className="block">
                        <span className="sr-only">Drop </span>
                        {time12(s.dropTime)}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </PCard>
        <p className="mt-2 px-1 text-xs text-stone-500 dark:text-stone-400">Times are the planned pickup (top) and drop (bottom). Live bus tracking is not available yet.</p>
      </section>
    </>
  );
}
