'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IndianRupee, Percent, TriangleAlert, Users } from 'lucide-react';
import RequireAuth from '@/components/RequireAuth';
import DashboardOverview, { type Defaulter, type Kpi, type MonthlyFinance } from '@/features/dashboard/DashboardOverview';
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
  data: { schoolName?: string | null; branchName?: string | null; role: string };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toProps(me: Me['data'], a: Analytics, d: DefaultersResponse, s: StudentList) {
  const months = a.byMonth.map((m) => ({ label: MONTHS[Number(m.month.slice(5, 7)) - 1], collected: Number(m.collected) }));
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
  // No expense module yet: the chart shows collections only.
  const finance: MonthlyFinance[] = months.map((m) => ({ month: m.label, collection: m.collected, expense: 0 }));
  const asOf = new Date(`${d.meta.asOf}T00:00:00`);
  return {
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

function Dashboard() {
  const router = useRouter();
  const [props, setProps] = useState<ReturnType<typeof toProps> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [me, analytics, defaulters, students] = await Promise.all([
        apiGet<Me>('/auth/me'),
        apiGet<{ data: Analytics }>('/fees/analytics'),
        apiGet<DefaultersResponse>('/finance/defaulters?limit=8&sort=days'),
        apiGet<StudentList>('/fees/students?limit=1'),
      ]);
      setProps(toProps(me.data, analytics.data, defaulters, students));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <div className="mx-auto max-w-lg px-6 py-20 text-center">
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        <button type="button" onClick={load} className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium dark:border-slate-700">Try again</button>
      </div>
    );
  }
  if (!props) {
    return <div className="mx-auto max-w-[1440px] px-8 py-8"><div className="h-40 animate-pulse rounded-xl bg-slate-200/70 dark:bg-slate-800" /></div>;
  }
  return <DashboardOverview {...props} onViewAllDefaulters={() => router.push('/fees?status=overdue')} onExport={() => window.print()} />;
}

export default function DashboardPage() {
  return (
    <RequireAuth roles={['super_admin', 'branch_admin']}>
      <Dashboard />
    </RequireAuth>
  );
}
