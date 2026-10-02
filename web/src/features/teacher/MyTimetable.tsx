'use client';

import { CalendarDays } from 'lucide-react';
import { Card, ErrorState, Page, PageHeader, Spinner, Stat } from '@/components/ui';
import { useApi } from '@/lib/useApi';
import { WeekGrid } from './MyClass';
import type { TimetableSlot } from './types';

interface TeacherWeek {
  teacher: { staffId: string; name: string };
  days: Record<string, TimetableSlot[]>;
}

/** The signed-in teacher's own week across every section they teach (GET /teacher/timetable). */
export default function MyTimetable() {
  const { data, error, reload } = useApi<{ data: TeacherWeek }>('/teacher/timetable');
  const week = data?.data;
  const periods = week ? Object.values(week.days).flat().filter((p) => p.kind === 'class') : [];
  const classes = new Set(periods.map((p) => p.section?.id).filter(Boolean)).size;
  const busiest = week
    ? Object.entries(week.days).reduce((best, [d, list]) => (list.length > best.count ? { day: Number(d), count: list.length } : best), { day: 0, count: 0 })
    : null;
  const DAY = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  return (
    <Page wide>
      <PageHeader title="My timetable" description="Your periods this week across all your classes." />
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !week ? (
        <Spinner label="Loading your timetable…" />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Stat label="Periods a week" value={periods.length} />
            <Stat label="Classes" value={classes} />
            <Stat label="Busiest day" value={busiest && busiest.count ? DAY[busiest.day] : '–'} hint={busiest && busiest.count ? `${busiest.count} periods` : undefined} />
          </div>
          <Card title={<span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4 text-slate-400" aria-hidden /> Week</span>} padded={false}>
            <WeekGrid
              tt={{ section: null, days: week.days }}
              emptyTitle="No periods yet"
              emptyText="You have no periods in the timetable yet. The school office sets the timetable for each class."
            />
          </Card>
        </>
      )}
    </Page>
  );
}
