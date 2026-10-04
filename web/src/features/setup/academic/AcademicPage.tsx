'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Page, PageHeader, Tabs } from '@/components/ui';
import { useFlash } from '@/features/admin/shared';
import ClassesTab from './ClassesTab';
import SubjectsTab from './SubjectsTab';
import YearsTab from './YearsTab';

type Tab = 'years' | 'classes' | 'subjects';
const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'years', label: 'Years & terms' },
  { value: 'classes', label: 'Classes & sections' },
  { value: 'subjects', label: 'Subjects' },
];

export default function AcademicPage() {
  const [tab, setTab] = useState<Tab>('classes');
  const flash = useFlash();
  // ?tab=years opens that tab (remembered in the URL so a reload stays put).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab') as Tab | null;
    if (t && TABS.some((x) => x.value === t)) setTab(t);
  }, []);
  const choose = (t: Tab) => {
    setTab(t);
    flash.clear();
    window.history.replaceState(null, '', `?tab=${t}`);
  };
  const say = (text: string) => flash.show('success', text);

  return (
    <Page wide>
      <PageHeader
        back={
          <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Settings
          </Link>
        }
        title="Classes and subjects"
        description="Academic years and terms, classes and their sections, class teachers and the subject list."
      />
      <Tabs value={tab} onChange={choose} items={TABS} />
      {flash.node}
      {tab === 'years' && <YearsTab onMessage={say} />}
      {tab === 'classes' && <ClassesTab onMessage={say} />}
      {tab === 'subjects' && <SubjectsTab onMessage={say} />}
    </Page>
  );
}
