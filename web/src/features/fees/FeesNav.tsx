'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CreditCard, Layers, Receipt, TriangleAlert } from 'lucide-react';
import { cx } from '@/components/ui';

/**
 * Sub-navigation shown at the top of every fees screen (admins only, like the screens):
 * Collection | Fee structure | Defaulters | Online payments. The sidebar keeps its items too.
 * Real links (not tabs), so each screen keeps its own URL, filters and Back behaviour.
 */
const ITEMS = [
  { href: '/fees', label: 'Collection', icon: Receipt },
  { href: '/fees/setup', label: 'Fee structure', icon: Layers },
  { href: '/fees/defaulters', label: 'Defaulters', icon: TriangleAlert },
  { href: '/fees/online-payments', label: 'Online payments', icon: CreditCard },
];

export default function FeesNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Fees" className="-mx-4 mb-5 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0 print:hidden" data-fees-nav>
      <ul className="flex min-w-max gap-1">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'relative flex h-10 items-center gap-2 px-3 text-sm font-medium transition-colors',
                  active ? 'text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
                )}
              >
                <Icon className={cx('h-4 w-4', active ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-400')} aria-hidden />
                {label}
                {active && <span aria-hidden className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-indigo-600 dark:bg-indigo-400" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
