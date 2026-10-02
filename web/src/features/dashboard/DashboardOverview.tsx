'use client';

import Link from 'next/link';
import { useEffect, useId, useMemo, useState, type ComponentType, type ReactNode, type SVGProps } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  BellRing,
  CalendarCheck,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  Clock,
  Download,
  IndianRupee,
  Receipt,
  TriangleAlert,
  Users,
} from 'lucide-react';

/* ============================================================================
 * Types — shaped to match the API (GET /api/v1/finance/defaulters etc.)
 * ========================================================================== */

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

export type KpiFormat = 'count' | 'percent' | 'inr';

export interface Kpi {
  id: string;
  label: string;
  value: number;
  format: KpiFormat;
  /** Change vs the comparison period. Percent change, or percentage points when `deltaUnit` is 'pts'. */
  delta: number;
  deltaUnit?: '%' | 'pts';
  /** Is an increase good news? (false for outstanding fees) */
  upIsGood: boolean;
  comparison: string;          // e.g. "vs Aug"
  trend: number[];             // last ~12 points for the sparkline
  icon: Icon;
}

export type DefaulterSeverity = 'critical' | 'overdue' | 'due';

export interface Defaulter {
  studentId: string;
  studentName: string;
  admissionNumber: string;
  className: string;           // "Class 8"
  sectionName?: string | null; // "B"
  totalDue: number;            // rupees
  daysOverdue: number;
  openInvoices: number;
  partiallyPaid?: boolean;
}

export interface MonthlyFinance {
  month: string;               // "Apr"
  collection: number;          // rupees
  expense: number;             // rupees
}

export interface DashboardOverviewProps {
  campusName?: string;
  academicYear?: string;
  periodLabel?: string;        // "September 2026"
  asOfLabel?: string;          // "30 Sep 2026"
  kpis?: Kpi[];
  defaulters?: Defaulter[];
  defaultersTotal?: { count: number; amount: number };
  finance?: MonthlyFinance[];
  onExport?: () => void;
  onRemind?: (studentId: string) => void;
  onViewAllDefaulters?: () => void;
  /** Link for a defaulter's name (e.g. the student profile). */
  studentHref?: (studentId: string) => string;
  /** Extra content between the Today strip and the KPI strip (quick actions). */
  children?: ReactNode;
  /** Greeting name ("Good morning, Anita"). */
  firstName?: string;
  /** The day at a glance; the strip is hidden when absent. */
  today?: TodaySummary;
  /** Extra cards above the defaulters list (e.g. today's registers). */
  aside?: ReactNode;
}

/* ============================================================================
 * Formatting — Indian numbering (lakh / crore)
 * ========================================================================== */

const inrFull = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const countFmt = new Intl.NumberFormat('en-IN');

/** ₹42,80,000 -> "₹42.8L", ₹1,24,00,000 -> "₹1.24Cr" */
export function formatInrCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e7) return `₹${(value / 1e7).toFixed(2).replace(/\.?0+$/, '')}Cr`;
  if (abs >= 1e5) return `₹${(value / 1e5).toFixed(1).replace(/\.0$/, '')}L`;
  if (abs >= 1e3) return `₹${(value / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return inrFull.format(value);
}

function formatKpiValue(value: number, format: KpiFormat): string {
  if (format === 'inr') return formatInrCompact(value);
  if (format === 'percent') return `${value.toFixed(1)}%`;
  return countFmt.format(value);
}

function severityOf(d: Defaulter): DefaulterSeverity {
  if (d.daysOverdue >= 90) return 'critical';
  if (d.daysOverdue >= 30) return 'overdue';
  return 'due';
}

/* ============================================================================
 * Sample data — replace with API data
 * ========================================================================== */

const SAMPLE_KPIS: Kpi[] = [
  {
    id: 'students',
    label: 'Total students',
    value: 2846,
    format: 'count',
    delta: 1.8,
    upIsGood: true,
    comparison: 'vs last term',
    trend: [2710, 2722, 2731, 2740, 2752, 2768, 2779, 2790, 2801, 2815, 2830, 2846],
    icon: Users,
  },
  {
    id: 'attendance',
    label: "Today's attendance",
    value: 94.6,
    format: 'percent',
    delta: 1.2,
    deltaUnit: 'pts',
    upIsGood: true,
    comparison: 'vs 7-day avg',
    trend: [92.1, 93.4, 91.8, 94.0, 93.2, 92.7, 93.9, 94.2, 92.9, 93.5, 93.4, 94.6],
    icon: CalendarCheck,
  },
  {
    id: 'collection',
    label: 'Collection this month',
    value: 4_280_000,
    format: 'inr',
    delta: 12.4,
    upIsGood: true,
    comparison: 'vs Aug',
    trend: [9.6, 2.1, 1.8, 6.4, 3.8, 4.3, 3.1, 2.4, 3.6, 3.9, 3.8, 4.28],
    icon: IndianRupee,
  },
  {
    id: 'outstanding',
    label: 'Outstanding fees',
    value: 1_860_000,
    format: 'inr',
    delta: -6.3,
    upIsGood: false,
    comparison: 'vs Aug',
    trend: [12.4, 14.8, 17.9, 19.6, 21.0, 20.4, 19.8, 21.2, 20.6, 20.1, 19.85, 18.6],
    icon: Receipt,
  },
];

const SAMPLE_DEFAULTERS: Defaulter[] = [
  { studentId: 's1', studentName: 'Aarav Mehta', admissionNumber: 'DW-2019-0412', className: 'Class 8', sectionName: 'B', totalDue: 54_000, daysOverdue: 112, openInvoices: 4 },
  { studentId: 's2', studentName: 'Ishita Rao', admissionNumber: 'DW-2021-0877', className: 'Class 5', sectionName: 'A', totalDue: 38_500, daysOverdue: 96, openInvoices: 3, partiallyPaid: true },
  { studentId: 's3', studentName: 'Kabir Singh', admissionNumber: 'DW-2018-0233', className: 'Class 11', sectionName: 'Sci', totalDue: 29_700, daysOverdue: 64, openInvoices: 2 },
  { studentId: 's4', studentName: 'Ananya Iyer', admissionNumber: 'DW-2022-1140', className: 'Class 3', sectionName: 'C', totalDue: 18_000, daysOverdue: 41, openInvoices: 2, partiallyPaid: true },
  { studentId: 's5', studentName: 'Vihaan Gupta', admissionNumber: 'DW-2020-0659', className: 'Class 7', sectionName: 'A', totalDue: 13_500, daysOverdue: 22, openInvoices: 1 },
  { studentId: 's6', studentName: 'Meera Kapoor', admissionNumber: 'DW-2023-1302', className: 'Class 1', sectionName: 'B', totalDue: 9_000, daysOverdue: 9, openInvoices: 1 },
];

const SAMPLE_FINANCE: MonthlyFinance[] = [
  { month: 'Apr', collection: 9_650_000, expense: 4_120_000 },
  { month: 'May', collection: 2_240_000, expense: 3_870_000 },
  { month: 'Jun', collection: 1_890_000, expense: 3_690_000 },
  { month: 'Jul', collection: 6_420_000, expense: 4_450_000 },
  { month: 'Aug', collection: 3_810_000, expense: 4_030_000 },
  { month: 'Sep', collection: 4_280_000, expense: 4_160_000 },
];

/* ============================================================================
 * Page
 * ========================================================================== */

/** The day at a glance, shown under the greeting. */
export interface TodaySummary {
  dateLabel: string;           // "Friday, 2 October"
  sectionsMarked: number;
  sectionsTotal: number;
  absent: number | null;       // null until a register is taken
  collectedLabel: string;      // "Collected in October"
  collected: number;           // rupees
  overdueAmount: number;       // rupees
  overdueStudents: number;
}

function greetingFor(date = new Date()): string {
  const h = date.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function DashboardOverview({
  campusName = 'Dwarka campus',
  academicYear = '2026–27',
  periodLabel = 'September 2026',
  asOfLabel = '30 Sep 2026',
  kpis = SAMPLE_KPIS,
  defaulters = SAMPLE_DEFAULTERS,
  defaultersTotal = { count: 214, amount: 1_860_000 },
  finance = SAMPLE_FINANCE,
  onExport,
  onRemind,
  onViewAllDefaulters,
  studentHref,
  children,
  firstName,
  today,
  aside,
}: DashboardOverviewProps) {
  // Greeting depends on the viewer's clock: render it after mount to avoid a hydration mismatch.
  const [greeting, setGreeting] = useState('Welcome back');
  useEffect(() => setGreeting(greetingFor()), []);
  return (
    <main className="mx-auto w-full max-w-content px-4 pb-12 pt-6 sm:px-6 lg:px-8 lg:pt-8">
      <div className="flex flex-col gap-6">
        {/* Greeting */}
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white sm:text-[28px] sm:leading-9">
              {greeting}
              {firstName ? `, ${firstName}` : ''}
            </h1>
            <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
              {campusName}. Academic year {academicYear}.
            </p>
          </div>
          <button
            type="button"
            onClick={onExport}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3.5 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-white/5"
          >
            <Download className="h-4 w-4 text-slate-500" aria-hidden />
            Export report
          </button>
        </header>

        {today && <TodayStrip today={today} />}

        {children}

        {/* KPI strip: one surface, four measures */}
        <section aria-labelledby="overview-title">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="overview-title" className="text-base font-semibold text-slate-900 dark:text-white">
              Overview
            </h2>
            <p className="flex items-center gap-1.5 text-13 text-slate-500 dark:text-slate-400" aria-label={`Reporting period: ${periodLabel}`}>
              <CalendarDays className="h-3.5 w-3.5" aria-hidden />
              {periodLabel}, figures as of {asOfLabel}
            </p>
          </div>
          <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-surface xl:grid-cols-4 [&>*]:border-line max-xl:[&>*:nth-child(-n+2)]:border-b max-xl:[&>*:nth-child(odd)]:border-r xl:[&>*:not(:last-child)]:border-r">
            {kpis.map((kpi) => (
              <KpiTile key={kpi.id} kpi={kpi} />
            ))}
          </dl>
        </section>

        {/* Detail */}
        <div className="grid grid-cols-12 gap-6">
          <CollectionExpenseCard finance={finance} academicYear={academicYear} className="col-span-12 xl:col-span-7 xl:self-start" />
          <div className="col-span-12 flex flex-col gap-6 xl:col-span-5">
            {aside}
            <DefaultersCard defaulters={defaulters} total={defaultersTotal} onRemind={onRemind} studentHref={studentHref} onViewAll={onViewAllDefaulters} />
          </div>
        </div>
      </div>
    </main>
  );
}

/* ============================================================================
 * Today strip — the dashboard's echo of the sidebar's marigold "you are here"
 * ========================================================================== */

function TodayStrip({ today }: { today: TodaySummary }) {
  const allMarked = today.sectionsTotal > 0 && today.sectionsMarked === today.sectionsTotal;
  const items: Array<{ label: string; value: ReactNode; hint?: ReactNode; href?: string }> = [
    {
      label: 'Attendance marked',
      value: (
        <>
          {today.sectionsMarked}
          <span className="text-slate-400 dark:text-slate-500"> / {today.sectionsTotal}</span>
        </>
      ),
      hint: allMarked ? 'All registers taken' : today.sectionsTotal ? `${today.sectionsTotal - today.sectionsMarked} section${today.sectionsTotal - today.sectionsMarked === 1 ? '' : 's'} to go` : 'No sections yet',
      href: '/teacher/attendance',
    },
    {
      label: 'Absent today',
      value: today.absent === null ? <span className="text-slate-400 dark:text-slate-500">None yet</span> : countFmt.format(today.absent),
      hint: today.absent === null ? 'Shown once a register is taken' : 'Parents are alerted by SMS',
      href: '/attendance/history',
    },
    {
      label: today.collectedLabel,
      value: formatInrCompact(today.collected),
      hint: 'Fees received',
      href: '/fees',
    },
    {
      label: 'Overdue fees',
      value: formatInrCompact(today.overdueAmount),
      hint: `${countFmt.format(today.overdueStudents)} student${today.overdueStudents === 1 ? '' : 's'} past due date`,
      href: '/fees/defaulters',
    },
  ];
  return (
    <section aria-label="Today" className="relative overflow-hidden rounded-xl border border-line bg-surface">
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-marigold-400" />
      <div className="flex flex-col lg:flex-row">
        <div className="flex items-center gap-3 border-b border-line px-5 py-4 lg:w-[220px] lg:shrink-0 lg:flex-col lg:items-start lg:justify-center lg:gap-1 lg:border-b-0 lg:border-r">
          <span className="inline-flex items-center gap-1.5 text-13 font-medium text-marigold-700 dark:text-marigold-300">
            <span className="h-1.5 w-1.5 rounded-full bg-marigold-500" aria-hidden />
            Today
          </span>
          <p className="text-[15px] font-semibold text-slate-900 dark:text-white lg:text-base">{today.dateLabel}</p>
        </div>
        <ul className="grid flex-1 grid-cols-2 lg:grid-cols-4">
          {items.map((it, i) => (
            <li key={it.label} className={['border-line', i % 2 === 0 ? 'border-r' : '', i < 2 ? 'border-b lg:border-b-0' : '', i === 1 ? 'lg:border-r' : '', i === 3 ? 'lg:border-r-0' : ''].join(' ')}>
              <Link href={it.href ?? '#'} className="group block h-full px-4 py-3.5 transition-colors hover:bg-slate-50/80 dark:hover:bg-white/[0.02] sm:px-5 sm:py-4">
                <p className="text-13 font-medium text-slate-500 dark:text-slate-400">{it.label}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900 dark:text-white">{it.value}</p>
                {it.hint && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{it.hint}</p>}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ============================================================================
 * KPI tile
 * ========================================================================== */

function KpiTile({ kpi }: { kpi: Kpi }) {
  const { icon: KpiIcon } = kpi;
  const isUp = kpi.delta >= 0;
  const isGood = isUp === kpi.upIsGood;
  const DeltaIcon = isUp ? ArrowUpRight : ArrowDownRight;
  const unit = kpi.deltaUnit ?? '%';
  const deltaText = `${isUp ? '+' : '−'}${Math.abs(kpi.delta).toFixed(1)}${unit === 'pts' ? ' pts' : '%'}`;
  const hasDelta = Math.abs(kpi.delta) >= 0.05;
  const hasTrend = new Set(kpi.trend).size > 1;

  return (
    <div className="flex min-w-0 flex-col gap-3 p-4 sm:p-5">
      <dt className="flex items-center gap-2 text-13 font-medium text-slate-500 dark:text-slate-400">
        <KpiIcon className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden />
        <span className="truncate">{kpi.label}</span>
      </dt>
      <dd className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-2xl font-semibold leading-none tracking-tight tabular-nums text-slate-900 dark:text-white sm:text-[28px]">
            {formatKpiValue(kpi.value, kpi.format)}
          </span>
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
            {hasDelta && (
              <span
                className={[
                  'inline-flex items-center gap-0.5 font-medium tabular-nums',
                  isGood ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400',
                ].join(' ')}
              >
                <DeltaIcon className="h-3.5 w-3.5" aria-hidden />
                <span className="sr-only">{isUp ? 'Up' : 'Down'} </span>
                {deltaText}
              </span>
            )}
            <span className="text-slate-500 dark:text-slate-400">{kpi.comparison}</span>
          </span>
        </div>
        {hasTrend && <Sparkline points={kpi.trend} />}
      </dd>
    </div>
  );
}

function Sparkline({ points }: { points: number[] }) {
  const width = 88;
  const height = 32;
  const pad = 3;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const coords = points.map((p, i) => [
    pad + (i * (width - pad * 2)) / (points.length - 1),
    height - pad - ((p - min) / span) * (height - pad * 2),
  ]);
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${coords[coords.length - 1][0].toFixed(1)},${height} L${coords[0][0].toFixed(1)},${height} Z`;
  const [lx, ly] = coords[coords.length - 1];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="hidden shrink-0 overflow-visible sm:block" aria-hidden>
      <path d={area} className="fill-indigo-50 dark:fill-indigo-400/10" />
      <path d={line} fill="none" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" className="stroke-indigo-300 dark:stroke-indigo-400/60" />
      <circle cx={lx} cy={ly} r={3} strokeWidth={2} className="fill-indigo-600 stroke-white dark:fill-indigo-300 dark:stroke-slate-900" />
    </svg>
  );
}

/* ============================================================================
 * Collection vs expense chart
 * Grouped bars, one axis, legend + hover/focus tooltip, table for screen readers.
 * ========================================================================== */

const SERIES = [
  { key: 'collection', label: 'Collection', swatch: 'bg-indigo-500 dark:bg-indigo-400', fill: 'fill-indigo-500 dark:fill-indigo-400' },
  { key: 'expense', label: 'Expense', swatch: 'bg-[#B4BFD3] dark:bg-[#4A5A7C]', fill: 'fill-[#B4BFD3] dark:fill-[#4A5A7C]' },
] as const;

/** Rounds the axis maximum up to 4 even gridlines on a 1 / 2 / 2.5 / 5 x 10^n step. */
function niceMax(value: number): number {
  if (!(value > 0)) return 100_000;
  const raw = value / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  return step * 4;
}

function CollectionExpenseCard({
  finance,
  academicYear,
  className = '',
}: {
  finance: MonthlyFinance[];
  academicYear: string;
  className?: string;
}) {
  const titleId = useId();
  const [active, setActive] = useState<number | null>(null);

  const totals = useMemo(() => {
    const collection = finance.reduce((s, m) => s + m.collection, 0);
    const expense = finance.reduce((s, m) => s + m.expense, 0);
    const monthsAhead = finance.filter((m) => m.collection >= m.expense).length;
    const worst = finance.reduce<MonthlyFinance | null>(
      (acc, m) => (acc === null || m.collection - m.expense < acc.collection - acc.expense ? m : acc),
      null,
    );
    return { collection, expense, net: collection - expense, monthsAhead, worst };
  }, [finance]);

  // Geometry (SVG user units; the SVG scales to the card width)
  // Phones get a narrower drawing so the axis labels stay readable when the SVG scales down.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  const W = narrow ? 360 : 720;
  const H = narrow ? 230 : 300;
  const M = { top: 12, right: 4, bottom: 26, left: narrow ? 40 : 52 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const yMax = niceMax(Math.max(...finance.flatMap((m) => [m.collection, m.expense])));
  const ticks = Array.from({ length: 5 }, (_, i) => (yMax / 4) * i);
  const band = plotW / finance.length;
  const barW = Math.min(28, band * (narrow ? 0.32 : 0.26));
  const gap = 2;
  const y = (v: number) => M.top + plotH - (v / yMax) * plotH;

  const activeMonth = active !== null ? finance[active] : null;

  return (
    <section
      aria-labelledby={titleId}
      className={`flex flex-col rounded-xl border border-line bg-surface ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div>
          <h2 id={titleId} className="text-[15px] font-semibold text-slate-900 dark:text-white">
            Collection vs expense
          </h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">Monthly, academic year {academicYear} to date</p>
        </div>
        <ul className="flex items-center gap-4 text-sm text-slate-600 dark:text-slate-300" aria-label="Legend">
          {SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-sm ${s.swatch}`} aria-hidden />
              {s.label}
            </li>
          ))}
        </ul>
      </div>

      <dl className="grid grid-cols-3 gap-4 px-5 pt-4">
        <Figure label="Collected" value={formatInrCompact(totals.collection)} />
        <Figure label="Spent" value={formatInrCompact(totals.expense)} />
        <Figure
          label="Net surplus"
          value={`${totals.net < 0 ? '−' : ''}${formatInrCompact(Math.abs(totals.net))}`}
          tone={totals.net >= 0 ? 'good' : 'bad'}
        />
      </dl>

      <div className="relative px-4 pb-4 pt-2">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          role="img"
          aria-label={`Bar chart of monthly fee collection and expense. Total collected ${formatInrCompact(totals.collection)}, spent ${formatInrCompact(totals.expense)}.`}
          onMouseLeave={() => setActive(null)}
        >
          {/* Grid + y-axis */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={M.left}
                x2={W - M.right}
                y1={y(t)}
                y2={y(t)}
                strokeWidth={1}
                className={t === 0 ? 'stroke-slate-300 dark:stroke-slate-700' : 'stroke-slate-100 dark:stroke-slate-800'}
              />
              <text x={M.left - 10} y={y(t)} dy="0.32em" textAnchor="end" className="fill-slate-400 text-[11px] tabular-nums dark:fill-slate-500">
                {t === 0 ? '₹0' : formatInrCompact(t)}
              </text>
            </g>
          ))}

          {/* Bars */}
          {finance.map((m, i) => {
            const cx = M.left + band * i + band / 2;
            const isActive = active === i;
            const dimmed = active !== null && !isActive;
            return (
              <g
                key={m.month}
                tabIndex={0}
                role="button"
                aria-label={`${m.month}: collection ${inrFull.format(m.collection)}, expense ${inrFull.format(m.expense)}`}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className="cursor-default outline-none"
              >
                {/* Hit target spans the whole band */}
                <rect
                  x={M.left + band * i}
                  y={M.top}
                  width={band}
                  height={plotH}
                  className={isActive ? 'fill-slate-100/80 dark:fill-white/[0.03]' : 'fill-transparent'}
                />
                {SERIES.map((s, si) => {
                  const v = m[s.key];
                  const x = si === 0 ? cx - barW - gap / 2 : cx + gap / 2;
                  return (
                    <path
                      key={s.key}
                      d={roundedTopBar(x, y(v), barW, y(0) - y(v), 4)}
                      className={`${s.fill} transition-opacity duration-150 ${dimmed ? 'opacity-40' : 'opacity-100'}`}
                    />
                  );
                })}
                <text x={cx} y={H - 8} textAnchor="middle" className="fill-slate-500 text-[12px] dark:fill-slate-400">
                  {m.month}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Tooltip */}
        {activeMonth && active !== null && (
          <div
            role="status"
            className="pointer-events-none absolute top-3 z-10 w-48 -translate-x-1/2 rounded-lg border border-line bg-surface p-3 text-xs shadow-float"
            // Centre over the hovered month: 1rem gutter + fraction of the SVG's rendered width.
            style={{
              left: `clamp(6rem, calc(1rem + (100% - 2rem) * ${((M.left + band * active + band / 2) / W).toFixed(4)}), calc(100% - 6rem))`,
            }}
          >
            <p className="mb-2 font-semibold text-slate-900 dark:text-slate-100">{activeMonth.month} 2026</p>
            {SERIES.map((s) => (
              <p key={s.key} className="flex items-center justify-between gap-3 py-0.5 text-slate-600 dark:text-slate-300">
                <span className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-sm ${s.swatch}`} aria-hidden />
                  {s.label}
                </span>
                <span className="font-medium tabular-nums text-slate-900 dark:text-slate-100">{formatInrCompact(activeMonth[s.key])}</span>
              </p>
            ))}
            <p className="mt-2 flex items-center justify-between border-t border-line pt-2 text-slate-600 dark:text-slate-300">
              Net
              <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {activeMonth.collection - activeMonth.expense < 0 ? '−' : '+'}
                {formatInrCompact(Math.abs(activeMonth.collection - activeMonth.expense))}
              </span>
            </p>
          </div>
        )}

        {/* Data table for assistive tech */}
        <table className="sr-only">
          <caption>Monthly collection and expense, in rupees</caption>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Collection</th>
              <th scope="col">Expense</th>
            </tr>
          </thead>
          <tbody>
            {finance.map((m) => (
              <tr key={m.month}>
                <th scope="row">{m.month}</th>
                <td>{inrFull.format(m.collection)}</td>
                <td>{inrFull.format(m.expense)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totals.worst && (
        <div className="mt-auto flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line px-5 py-3 text-xs text-slate-500 dark:text-slate-400">
          <span>
            Collection covered expenses in{' '}
            <span className="font-medium tabular-nums text-slate-700 dark:text-slate-200">
              {totals.monthsAhead} of {finance.length}
            </span>{' '}
            months
          </span>
          {totals.worst.collection < totals.worst.expense && (
            <span>
              Largest shortfall:{' '}
              <span className="font-medium tabular-nums text-slate-700 dark:text-slate-200">
                {totals.worst.month}, {formatInrCompact(totals.worst.expense - totals.worst.collection)}
              </span>
            </span>
          )}
        </div>
      )}
    </section>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</dt>
      <dd
        className={[
          'mt-1 text-lg font-semibold tabular-nums',
          tone === 'good' ? 'text-emerald-700 dark:text-emerald-400' : tone === 'bad' ? 'text-red-700 dark:text-red-400' : '',
        ].join(' ')}
      >
        {value}
      </dd>
    </div>
  );
}

/** Bar path with rounded top corners and a square base sitting on the axis. */
function roundedTopBar(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

/* ============================================================================
 * Fee defaulters
 * ========================================================================== */

const SEVERITY: Record<DefaulterSeverity, { label: string; icon: Icon; iconClass: string; chip: string }> = {
  critical: {
    label: '90+ days',
    icon: TriangleAlert,
    iconClass: 'text-red-600 dark:text-red-400',
    chip: 'bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-300',
  },
  overdue: {
    label: '30+ days',
    icon: CircleAlert,
    iconClass: 'text-amber-600 dark:text-amber-400',
    chip: 'bg-amber-50 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300',
  },
  due: {
    label: 'Recently due',
    icon: Clock,
    iconClass: 'text-slate-500 dark:text-slate-400',
    chip: 'bg-slate-100 text-slate-700 dark:bg-white/[0.07] dark:text-slate-300',
  },
};

function DefaultersCard({
  defaulters,
  total,
  onRemind,
  onViewAll,
  studentHref,
  className = '',
}: {
  defaulters: Defaulter[];
  total: { count: number; amount: number };
  onRemind?: (studentId: string) => void;
  onViewAll?: () => void;
  studentHref?: (studentId: string) => string;
  className?: string;
}) {
  const titleId = useId();

  return (
    <section
      aria-labelledby={titleId}
      className={`flex flex-col rounded-xl border border-line bg-surface ${className}`}
    >
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div>
          <h2 id={titleId} className="text-[15px] font-semibold text-slate-900 dark:text-white">
            Fee defaulters
          </h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            <span className="font-medium tabular-nums text-slate-700 dark:text-slate-200">{countFmt.format(total.count)}</span> students owe{' '}
            <span className="font-medium tabular-nums text-slate-700 dark:text-slate-200">{inrFull.format(total.amount)}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onViewAll}
          className="inline-flex shrink-0 items-center gap-0.5 rounded-md px-2 py-1 text-13 font-medium text-indigo-700 transition-colors hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-400/10"
        >
          View all
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {defaulters.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 py-12 text-center">
          <p className="text-sm font-medium">No overdue fees</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">Every student is up to date for this period.</p>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {defaulters.map((d) => {
            const sev = SEVERITY[severityOf(d)];
            const SevIcon = sev.icon;
            const classLabel = [d.className, d.sectionName].filter(Boolean).join(' ');
            return (
              <li key={d.studentId} className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-slate-50/80 dark:hover:bg-white/[0.02]">
                <Initials name={d.studentName} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                    {studentHref ? (
                      <Link href={studentHref(d.studentId)} className="hover:text-indigo-700 hover:underline dark:hover:text-indigo-300">
                        {d.studentName}
                      </Link>
                    ) : (
                      d.studentName
                    )}
                  </p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {classLabel}, <span className="tabular-nums">{d.admissionNumber}</span>
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <span className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">{inrFull.format(d.totalDue)}</span>
                  <span className="flex items-center gap-1.5">
                    {d.partiallyPaid && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-white/[0.07] dark:text-slate-300">
                        Part paid
                      </span>
                    )}
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${sev.chip}`}
                      title={`${d.daysOverdue} days overdue, ${d.openInvoices} open invoice${d.openInvoices === 1 ? '' : 's'}`}
                    >
                      <SevIcon className={`h-3 w-3 ${sev.iconClass}`} aria-hidden />
                      <span className="tabular-nums">{d.daysOverdue}d</span>
                      <span className="sr-only">overdue, {sev.label}</span>
                    </span>
                  </span>
                </div>
                {onRemind && <button
                  type="button"
                  onClick={() => onRemind(d.studentId)}
                  aria-label={`Send fee reminder to ${d.studentName}'s parent`}
                  title="Send reminder"
                  className="rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-white dark:focus-visible:ring-slate-300"
                >
                  <BellRing className="h-4 w-4" aria-hidden />
                </button>}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line px-5 py-3 text-xs text-slate-500 dark:text-slate-400">
        {(Object.keys(SEVERITY) as DefaulterSeverity[]).map((key) => {
          const { icon: LegendIcon, iconClass, label } = SEVERITY[key];
          return (
            <span key={key} className="flex items-center gap-1.5">
              <LegendIcon className={`h-3.5 w-3.5 ${iconClass}`} aria-hidden />
              {label}
            </span>
          );
        })}
      </div>
    </section>
  );
}

function Initials({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600 dark:bg-white/[0.06] dark:text-slate-300"
    >
      {initials}
    </span>
  );
}
