'use client';

import Link from 'next/link';
import { Building2, CreditCard, GraduationCap, KeyRound, Layers, UserRound } from 'lucide-react';
import RequireAuth from '@/components/RequireAuth';
import { Page, PageHeader } from '@/components/ui';

const SECTIONS = [
  { href: '/settings/school', icon: Building2, title: 'School profile', text: 'Name, address, affiliation and UDISE codes, logo and contact details printed on receipts and certificates.' },
  { href: '/settings/academic', icon: GraduationCap, title: 'Classes and subjects', text: 'Academic years and terms, classes and sections, class teachers and the subject list.' },
  { href: '/fees/setup', icon: Layers, title: 'Fee structure', text: 'Fee heads and how much each class pays, in which instalments and by which due dates.' },
  { href: '/settings/payments', icon: CreditCard, title: 'Online payments', text: 'Connect your Razorpay account so parents and students can pay fees from their portal.' },
  { href: '/settings/users', icon: KeyRound, title: 'Portal logins', text: 'Give parents and students a login, reset passwords, and see who has access.' },
  { href: '/settings/account', icon: UserRound, title: 'My account', text: 'Your name, phone and password.' },
];

export default function SettingsPage() {
  return (
    <RequireAuth roles={['super_admin', 'branch_admin']}>
      <Page>
        <PageHeader title="Settings" description="Set up your school once; everything else in SM ERP uses these details." />
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SECTIONS.map(({ href, icon: Icon, title, text }) => (
            <li key={href}>
              <Link
                href={href}
                className="flex h-full gap-3 rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-indigo-300 hover:bg-indigo-50/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-500/40 dark:hover:bg-indigo-500/5"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200">
                  <Icon className="h-[18px] w-[18px]" aria-hidden />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{title}</span>
                  <span className="mt-0.5 block text-sm text-slate-500 dark:text-slate-400">{text}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Page>
    </RequireAuth>
  );
}
