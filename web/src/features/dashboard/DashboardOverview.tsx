'use client';

import Link from 'next/link';
import { useId, useMemo, useState, type ComponentType, type ReactNode, type SVGProps } from 'react';
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
  /** Extra content between the header and the KPI strip (quick actions, today's attendance). */
  children?: ReactNode;
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
}: DashboardOverviewProps) {
  return (
    <main className="min-h-full bg-slate-50 px-4 py-6 sm:px-8 sm:py-8 text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
        {/* Header */}
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {campusName}, academic year {academicYear}. Figures as of {asOfLabel}.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:focus-visible:ring-slate-300 dark:focus-visible:ring-offset-slate-950"
              aria-label={`Reporting period: ${periodLabel}`}
            >
              <CalendarDays className="h-4 w-4 text-slate-400" aria-hidden />
              {periodLabel}
            </button>
            <button
              type="button"
              onClick={onExport}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-900 px-3.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200 dark:focus-visible:ring-slate-300 dark:focus-visible:ring-offset-slate-950"
            >
              <Download className="h-4 w-4" aria-hidden />
              Export report
            </button>
          </div>
        </header>

        {children}

        {/* KPI strip: one surface, four measures */}
        <section aria-label="Key figures" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <dl className="grid grid-cols-2 divide-slate-200 xl:grid-cols-4 xl:divide-x dark:divide-slate-800 [&>*:nth-child(-n+2)]:border-b [&>*:nth-child(-n+2)]:border-slate-200 xl:[&>*:nth-child(-n+2)]:border-b-0 dark:[&>*:nth-child(-n+2)]:border-slate-800">
            {kpis.map((kpi) => (
              <KpiTile key={kpi.id} kpi={kpi} />
            ))}
          </dl>
        </section>

        {/* Detail */}
        <div className="grid grid-cols-12 gap-6">
          <CollectionExpenseCard finance={finance} academicYear={academicYear} className="col-span-12 xl:col-span-7 xl:self-start" />
          <DefaultersCard
            defaulters={defaulters}
            total={defaultersTotal}
            onRemind={onRemind}
            studentHref={studentHref}
            onViewAll={onViewAllDefaulters}
            className="col-span-12 xl:col-span-5"
          />
        </div>
      </div>
    </main>
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

  return (
    <div className="flex flex-col gap-4 p-6">
      <dt className="flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400">
        <KpiIcon className="h-4 w-4 text-slate-400 dark:text-slate-500" aria-hidden />
        {kpi.label}
      </dt>
      <dd className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-[1.875rem] font-semibold leading-none tracking-tight tabular-nums">
            {formatKpiValue(kpi.value, kpi.format)}
          </span>
          <span className="flex items-center gap-1.5 text-xs">
            <span
              className={[
                'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-semibold tabular-nums',
                isGood
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
                  : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400',
              ].join(' ')}
            >
              <DeltaIcon className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">{isUp ? 'Up' : 'Down'} </span>
              {deltaText}
            </span>
            <span className="text-slate-500 dark:text-slate-400">{kpi.comparison}</span>
          </span>
        </div>
        <Sparkline points={kpi.trend} />
      </dd>
    </div>
  );
}

function Sparkline({ points }: { points: number[] }) {
  const width = 96;
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
      <path d={area} className="fill-slate-100 dark:fill-slate-800/70" />
      <path d={line} fill="none" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" className="stroke-slate-400 dark:stroke-slate-500" />
      <circle cx={lx} cy={ly} r={3} strokeWidth={2} className="fill-[#2a78d6] stroke-white dark:fill-[#3987e5] dark:stroke-slate-900" />
    </svg>
  );
}

/* ============================================================================
 * Collection vs expense chart
 * Grouped bars, one axis, legend + hover/focus tooltip, table for screen readers.
 * ========================================================================== */

const SERIES = [
  { key: 'collection', label: 'Collection', swatch: 'bg-[#2a78d6] dark:bg-[#3987e5]', fill: 'fill-[#2a78d6] dark:fill-[#3987e5]' },
  { key: 'expense', label: 'Expense', swatch: 'bg-[#eb6834] dark:bg-[#d95926]', fill: 'fill-[#eb6834] dark:fill-[#d95926]' },
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
  const W = 720;
  const H = 300;
  const M = { top: 12, right: 8, bottom: 28, left: 52 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const yMax = niceMax(Math.max(...finance.flatMap((m) => [m.collection, m.expense])));
  const ticks = Array.from({ length: 5 }, (_, i) => (yMax / 4) * i);
  const band = plotW / finance.length;
  const barW = Math.min(28, band * 0.26);
  const gap = 2;
  const y = (v: number) => M.top + plotH - (v / yMax) * plotH;

  const activeMonth = active !== null ? finance[active] : null;

  return (
    <section
      aria-labelledby={titleId}
      className={`flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 px-6 py-5 dark:border-slate-800">
        <div>
          <h2 id={titleId} className="text-base font-semibold">
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

      <dl className="grid grid-cols-3 gap-6 px-6 pt-5">
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
                  className={isActive ? 'fill-slate-100/70 dark:fill-slate-800/50' : 'fill-transparent'}
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
            className="pointer-events-none absolute top-3 z-10 w-48 -translate-x-1/2 rounded-lg border border-slate-200 bg-white/95 p-3 text-xs shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
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
            <p className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-slate-600 dark:border-slate-800 dark:text-slate-300">
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
        <div className="mt-auto flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-slate-100 px-6 py-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
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
    iconClass: 'text-[#d03b3b]',
    chip: 'bg-[#d03b3b]/10 text-red-800 ring-[#d03b3b]/25 dark:bg-[#d03b3b]/15 dark:text-red-300',
  },
  overdue: {
    label: '30+ days',
    icon: CircleAlert,
    iconClass: 'text-[#ec835a]',
    chip: 'bg-[#ec835a]/10 text-orange-800 ring-[#ec835a]/30 dark:bg-[#ec835a]/15 dark:text-orange-300',
  },
  due: {
    label: 'Recently due',
    icon: Clock,
    iconClass: 'text-[#d99a0b] dark:text-[#fab219]',
    chip: 'bg-[#fab219]/10 text-amber-800 ring-[#fab219]/35 dark:bg-[#fab219]/10 dark:text-amber-300',
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
      className={`flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}
    >
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5 dark:border-slate-800">
        <div>
          <h2 id={titleId} className="text-base font-semibold">
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
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white dark:focus-visible:ring-slate-300"
        >
          View all
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {defaulters.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-12 text-center">
          <p className="text-sm font-medium">No overdue fees</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">Every student is up to date for this period.</p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {defaulters.map((d) => {
            const sev = SEVERITY[severityOf(d)];
            const SevIcon = sev.icon;
            const classLabel = [d.className, d.sectionName].filter(Boolean).join(' ');
            return (
              <li key={d.studentId} className="group flex items-center gap-4 px-6 py-3.5 transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                <Initials name={d.studentName} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                    {studentHref ? (
                      <Link href={studentHref(d.studentId)} className="hover:underline">
                        {d.studentName}
                      </Link>
                    ) : (
                      d.studentName
                    )}
                  </p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {classLabel}
                    <span className="mx-1.5 text-slate-300 dark:text-slate-600" aria-hidden>/</span>
                    <span className="tabular-nums">{d.admissionNumber}</span>
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <span className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">{inrFull.format(d.totalDue)}</span>
                  <span className="flex items-center gap-1.5">
                    {d.partiallyPaid && (
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
                        Part paid
                      </span>
                    )}
                    <span
                      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${sev.chip}`}
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

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 px-6 py-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
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
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 ring-1 ring-inset ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700"
    >
      {initials}
    </span>
  );
}
