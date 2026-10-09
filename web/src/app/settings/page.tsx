'use client';

import Link from 'next/link';
import {
  BellRing,
  Blocks,
  Building2,
  CalendarCheck2,
  CreditCard,
  Fingerprint,
  GraduationCap,
  History,
  KeyRound,
  Layers,
  MessagesSquare,
  ScrollText,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import RequireAuth from '@/components/RequireAuth';
import { Badge, Page, PageHeader, Skeleton, cx } from '@/components/ui';
import { useApi } from '@/lib/useApi';
import { hasModule, useEntitlements, type ModuleKey } from '@/lib/entitlements';
import { CHANNEL_LABEL, ChannelIcon } from '@/features/settings/bits';
import type { Channel, SettingsOverview } from '@/features/settings/types';

type Item = { href: string; icon: LucideIcon; title: string; text: string; module?: ModuleKey; status?: (o: SettingsOverview) => string | null };

const GROUPS: Array<{ title: string; text: string; items: Item[] }> = [
  {
    title: 'School',
    text: 'Set up once; receipts, certificates and report cards use these details.',
    items: [
      { href: '/settings/school', icon: Building2, title: 'School profile', text: 'Name, address, affiliation and UDISE codes, logo and contact details.' },
      { href: '/settings/academic', icon: GraduationCap, title: 'Classes and subjects', text: 'Academic years and terms, classes and sections, class teachers, subjects.' },
      { href: '/fees/setup', icon: Layers, title: 'Fee structure', text: 'Fee heads, class-wise amounts, instalments and due dates.' },
      { href: '/settings/payments', icon: CreditCard, title: 'Online payments', text: 'Connect your Razorpay account so parents can pay from their portal.', module: 'online_payments' },
      { href: '/settings/users', icon: KeyRound, title: 'Portal logins', text: 'Parent and student logins, password resets.' },
    ],
  },
  {
    title: 'Messages to parents and staff',
    text: 'Which account messages go out from, what they say, and when they are sent.',
    items: [
      {
        href: '/settings/communication',
        icon: MessagesSquare,
        title: 'WhatsApp, SMS & email',
        text: 'Use the SM ERP account or connect your own WhatsApp number, SMS sender ID and mailbox.',
        status: (o) => {
          const own = (Object.keys(o.channels) as Channel[]).filter((c) => o.channels[c].provider !== 'platform');
          return own.length ? `Own: ${own.map((c) => CHANNEL_LABEL[c]).join(', ')}` : 'SM ERP account';
        },
      },
      {
        href: '/settings/notification-rules',
        icon: BellRing,
        title: 'Notification rules',
        text: 'Absent, late, reached school, fee reminders and receipts, report cards, homework, birthdays: on/off, channels, timing.',
        status: (o) => `${o.rules.automaticOn} of ${o.rules.automaticTotal} automatic messages on`,
      },
      {
        href: '/settings/templates',
        icon: ScrollText,
        title: 'Message templates',
        text: 'The text of each message per channel, DLT template IDs, WhatsApp template approval.',
        status: (o) => (o.templates.custom ? `${o.templates.custom} custom` : 'Default texts'),
      },
    ],
  },
  {
    title: 'Attendance',
    text: 'How attendance is taken and who may change it.',
    items: [
      { href: '/settings/attendance', icon: CalendarCheck2, title: 'Attendance policy & holidays', text: 'Back-dating, late and cut-off times, holidays and weekly offs, minimum attendance.' },
      {
        href: '/settings/devices',
        icon: Fingerprint,
        title: 'Attendance devices',
        text: 'RFID card readers, biometric and face terminals (eSSL / ZKTeco), QR scanners and gate apps.',
        module: 'device_attendance',
        status: (o) => (o.devices.count ? `${o.devices.count} device${o.devices.count === 1 ? '' : 's'}` : null),
      },
    ],
  },
  {
    title: 'Plan, modules and account',
    text: '',
    items: [
      { href: '/settings/modules', icon: Blocks, title: 'Modules', text: 'Switch the parts of SM ERP your school uses on or off.', status: (o) => `${o.modules.enabled} of ${o.modules.total} on` },
      { href: '/settings/audit', icon: History, title: 'Change log', text: 'Who changed which setting, and when.' },
      { href: '/settings/account', icon: UserRound, title: 'My account', text: 'Your name, phone and password.' },
    ],
  },
];

function PlanCard({ o }: { o: SettingsOverview }) {
  const sub = o.subscription;
  const fmt = (n: number) => n.toLocaleString('en-IN');
  return (
    <section className="mb-8 grid gap-4 rounded-xl border border-line bg-surface p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
      <div className="min-w-0">
        <p className="text-13 font-medium text-slate-500 dark:text-slate-400">Your plan</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{sub?.plan?.name ?? 'All features'}</h2>
          {sub?.status === 'trial' && <Badge tone="amber">{sub.trialDaysLeft !== null && sub.trialDaysLeft >= 0 ? `Trial: ${sub.trialDaysLeft} day${sub.trialDaysLeft === 1 ? '' : 's'} left` : 'Trial ended'}</Badge>}
          {sub?.status === 'past_due' && <Badge tone="red">Payment due</Badge>}
          {sub?.status === 'active' && <Badge tone="green">Active</Badge>}
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {sub?.limits.maxStudents ? `Up to ${fmt(sub.limits.maxStudents)} students` : 'No student limit'}
          {sub?.limits.maxBranches ? ` · ${sub.limits.maxBranches} branch${sub.limits.maxBranches === 1 ? '' : 'es'}` : ''}. To change your plan, contact SM ERP.
        </p>
      </div>
      <div className="grid min-w-0 grid-cols-3 gap-3">
        {(['whatsapp', 'sms', 'email'] as Channel[]).map((c) => {
          const u = o.usage[c];
          const limitKey = c === 'whatsapp' ? 'whatsappPerMonth' : c === 'sms' ? 'smsPerMonth' : 'emailsPerMonth';
          const limit = sub?.limits[limitKey] ?? null;
          const own = o.channels[c].provider !== 'platform';
          const pct = limit ? Math.min(100, Math.round((u.platform / limit) * 100)) : 0;
          return (
            <div key={c} className="min-w-0 rounded-lg bg-surface-muted/70 p-3">
              <p className="flex items-center gap-1.5 text-13 font-medium text-slate-600 dark:text-slate-300">
                <ChannelIcon channel={c} className="h-3.5 w-3.5" />
                {CHANNEL_LABEL[c]}
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900 dark:text-white">{fmt(u.school + u.platform)}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {!o.channels[c].module ? 'Not in use' : own ? 'this month, own account' : limit === null ? 'this month' : `of ${fmt(limit)} this month`}
              </p>
              {!own && limit !== null && o.channels[c].module && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                  <div className={cx('h-full rounded-full', pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-indigo-500')} style={{ width: `${pct}%` }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function SettingsPage() {
  const { data } = useApi<{ data: SettingsOverview }>('/settings/overview');
  const entitlements = useEntitlements();
  const o = data?.data ?? null;
  return (
    <RequireAuth roles={['super_admin', 'branch_admin']}>
      <Page>
        <PageHeader title="Settings" description="Everything your school can configure: the school itself, messages to parents, attendance, and the modules you use." />
        {o ? <PlanCard o={o} /> : <Skeleton className="mb-8 h-[120px] w-full rounded-xl" />}
        <div className="space-y-8">
          {GROUPS.map((group) => {
            const items = group.items.filter((i) => hasModule(entitlements, i.module));
            if (!items.length) return null;
            return (
              <section key={group.title}>
                <div className="mb-3">
                  <h2 className="text-[15px] font-semibold text-slate-900 dark:text-white">{group.title}</h2>
                  {group.text && <p className="text-13 text-slate-500 dark:text-slate-400">{group.text}</p>}
                </div>
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map(({ href, icon: Icon, title, text, status }) => {
                    const s = o && status ? status(o) : null;
                    return (
                      <li key={href}>
                        <Link
                          href={href}
                          className="flex h-full gap-3 rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-indigo-300 hover:bg-indigo-50/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-500/40 dark:hover:bg-indigo-500/5"
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200">
                            <Icon className="h-[18px] w-[18px]" aria-hidden />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold">{title}</span>
                            <span className="mt-0.5 block text-sm text-slate-500 dark:text-slate-400">{text}</span>
                            {s && <span className="mt-2 inline-block rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-white/[0.06] dark:text-slate-300">{s}</span>}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </Page>
    </RequireAuth>
  );
}
