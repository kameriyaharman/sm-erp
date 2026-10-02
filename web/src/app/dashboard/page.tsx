'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IndianRupee, Percent, TriangleAlert, Users } from 'lucide-react';
import RequireAuth from '@/components/RequireAuth';
import DashboardOverview, { type Defaulter, type Kpi, type MonthlyFinance, type TodaySummary } from '@/features/dashboard/DashboardOverview';
import { ErrorState, Skeleton } from '@/components/ui';
import { QuickActions, TodayAttendance } from '@/features/dashboard/DashboardExtras';
import type { AttendanceSection, ExpenseMonth } from '@/features/admin/types';
import { apiGet } from '@/lib/session';

interface Analytics {
  summary: { collected: string; pending: string; overdue: string; collectionRate: number | null; studentsWithDues: number; studentsOverdue: number };
  byMonth: Array<{ month: string; invoiced: string; collected: string }>;
}
interface DefaultersResponse {
  data: Array<{ studentId: string; studentName: string; admissionNumber: string; class: { name: string } | null; section: { name: string } | null; totalDue: string; daysOverdue: number; openInvoices: number }>;
  meta: { total: number; totalOutstanding: string; asOf: string };
}
interface StudentList {
  data: Array<{ academicYear: { name: string } }>;
  meta: { total: number };
}
interface Me {
  data: { schoolName?: string | null; branchName?: string | null; role: string; firstName?: string };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toProps(me: Me['data'], a: Analytics, d: DefaultersResponse, s: StudentList, expenses: ExpenseMonth[]) {
  const months = a.byMonth.map((m) => ({ key: m.month.slice(0, 7), label: MONTHS[Number(m.month.slice(5, 7)) - 1], collected: Number(m.collected) }));
  const collectedTrend = months.map((m) => m.collected);
  const last = collectedTrend.at(-1) ?? 0;
  const prev = collectedTrend.at(-2) ?? 0;
  const pct = (cur: number, before: number) => (before > 0 ? ((cur - before) / before) * 100 : 0);
  const flat = (v: number) => [v, v];

  const kpis: Kpi[] = [
    { id: 'students', label: 'Students', value: s.meta.total, format: 'count', delta: 0, upIsGood: true, comparison: 'enrolled this year', trend: flat(s.meta.total), icon: Users },
    { id: 'collected', label: 'Fees collected', value: Number(a.summary.collected), format: 'inr', delta: pct(last, prev), upIsGood: true, comparison: 'last month vs previous', trend: collectedTrend.length > 1 ? collectedTrend : flat(last), icon: IndianRupee },
    { id: 'pending', label: 'Outstanding (invoiced)', value: Number(a.summary.pending), format: 'inr', delta: 0, upIsGood: false, comparison: `${a.summary.studentsWithDues} students`, trend: flat(Number(a.summary.pending)), icon: TriangleAlert },
    { id: 'rate', label: 'Collection rate', value: a.summary.collectionRate ?? 0, format: 'percent', delta: 0, deltaUnit: 'pts', upIsGood: true, comparison: 'of invoiced fees', trend: flat(a.summary.collectionRate ?? 0), icon: Percent },
  ];
  const defaulters: Defaulter[] = d.data.map((r) => ({
    studentId: r.studentId,
    studentName: r.studentName,
    admissionNumber: r.admissionNumber,
    className: r.class?.name ?? '-',
    sectionName: r.section?.name ?? null,
    totalDue: Number(r.totalDue),
    daysOverdue: r.daysOverdue,
    openInvoices: r.openInvoices,
  }));
  // Collections and expenses matched by month (YYYY-MM); a month present in either series is shown.
  const collectedBy = new Map(months.map((m) => [m.key, m.collected]));
  const spentBy = new Map(expenses.map((e) => [e.month.slice(0, 7), Number(e.amount)]));
  const keys = [...new Set([...collectedBy.keys(), ...spentBy.keys()])].sort();
  const finance: MonthlyFinance[] = keys.map((k) => ({ month: MONTHS[Number(k.slice(5, 7)) - 1], collection: collectedBy.get(k) ?? 0, expense: spentBy.get(k) ?? 0 }));
  const asOf = new Date(`${d.meta.asOf}T00:00:00`);
  return {
    firstName: me.firstName,
    campusName: [me.schoolName, me.role === 'super_admin' ? 'all campuses' : me.branchName].filter(Boolean).join(', '),
    academicYear: s.data[0]?.academicYear.name ?? '',
    periodLabel: asOf.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
    asOfLabel: asOf.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
    kpis,
    defaulters,
    defaultersTotal: { count: d.meta.total, amount: Number(d.meta.totalOutstanding) },
    finance,
  };
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The "Today" strip: registers taken, absentees, this month's collection, overdue fees. */
function todayOf(a: Analytics, sections: AttendanceSection[] | null): TodaySummary {
  const now = new Date();
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const list = sections ?? [];
  const taken = list.filter((s) => s.submission);
  return {
    dateLabel: now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }),
    sectionsMarked: taken.length,
    sectionsTotal: list.length,
    absent: taken.length ? taken.reduce((n, s) => n + ((s.submission?.total ?? 0) - (s.submission?.present ?? 0)), 0) : null,
    collectedLabel: `Collected in ${MONTH_NAMES[now.getMonth()]}`,
    collected: Number(a.byMonth.find((m) => m.month.slice(0, 7) === key)?.collected ?? 0),
    overdueAmount: Number(a.summary.overdue),
    overdueStudents: a.summary.studentsOverdue,
  };
}

function Dashboard() {
  const router = useRouter();
  const [props, setProps] = useState<ReturnType<typeof toProps> | null>(null);
  const [sections, setSections] = useState<AttendanceSection[] | null>(null);
  const [today, setToday] = useState<TodaySummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      // Expenses and today's registers are extras: the overview still loads if either fails.
      const [me, analytics, defaulters, students, expenses, today] = await Promise.all([
        apiGet<Me>('/auth/me'),
        apiGet<{ data: Analytics }>('/fees/analytics'),
        apiGet<DefaultersResponse>('/finance/defaulters?limit=8&sort=days'),
        apiGet<StudentList>('/fees/students?limit=1'),
        apiGet<{ data: ExpenseMonth[] }>('/expenses/monthly').catch(() => ({ data: [] as ExpenseMonth[] })),
        apiGet<{ data: AttendanceSection[] }>('/academics/sections').catch(() => null),
      ]);
      setProps(toProps(me.data, analytics.data, defaulters, students, expenses.data));
      setSections(today?.data ?? null);
      setToday(todayOf(analytics.data, today?.data ?? null));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16">
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }
  if (!props) {
    return (
      <div className="mx-auto max-w-content space-y-6 px-4 pt-6 sm:px-6 lg:px-8 lg:pt-8" role="status" aria-label="Loading">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    );
  }
  return (
    <DashboardOverview
      {...props}
      today={today ?? undefined}
      aside={sections && <TodayAttendance sections={sections} />}
      onViewAllDefaulters={() => router.push('/fees/defaulters')}
      studentHref={(id) => `/students/${id}`}
      onExport={() => window.print()}
    >
      <QuickActions />
    </DashboardOverview>
  );
}

export default function DashboardPage() {
  return (
    <RequireAuth roles={['super_admin', 'branch_admin']}>
      <Dashboard />
    </RequireAuth>
  );
}
