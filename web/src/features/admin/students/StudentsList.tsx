'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { UserPlus } from 'lucide-react';
import { buttonClass, Card, EmptyState, ErrorState, Page, PageHeader, Pagination, Spinner, Table, Td, Th } from '@/components/ui';
import { ClassSectionFilter, FilterBar, FilterSearch, FilteredEmpty, SelectFilter, chip, classSectionChips, useClassOptions, useUrlFilters } from '@/components/filters';
import { qs, useApi } from '@/lib/useApi';
import { formatDate, titleCase } from '@/lib/format';
import { Avatar, PhoneLink, StudentStatusBadge } from '../shared';
import type { Paged, StudentRow } from '../types';

const STATUSES = [
  { value: 'active', label: 'Current students' },
  { value: 'left', label: 'Left the school' },
  { value: 'all', label: 'All' },
];
const GENDERS = [
  { value: 'female', label: 'Girls' },
  { value: 'male', label: 'Boys' },
  { value: 'other', label: 'Other' },
];
const TRANSPORT = [
  { value: 'yes', label: 'Uses school bus' },
  { value: 'no', label: 'No school bus' },
];
const SORTS = [
  { value: 'name', label: 'Name' },
  { value: 'admission', label: 'Admission no.' },
  { value: 'class', label: 'Class' },
];

/** /students?search=…&classId=…&sectionId=…&status=left&gender=female&transport=yes&sort=class */
const DEFAULTS = { search: '', classId: '', sectionId: '', status: 'active', gender: '', transport: '', sort: 'name' };
const label = (list: Array<{ value: string; label: string }>, v: string) => list.find((o) => o.value === v)?.label ?? v;

export default function StudentsList() {
  const router = useRouter();
  const params = useSearchParams();
  const f = useUrlFilters(DEFAULTS);
  const cls = useClassOptions();
  const { search, classId, sectionId, gender, transport } = f.values;
  const status = STATUSES.some((o) => o.value === f.values.status) ? f.values.status : 'active';
  const sort = SORTS.some((o) => o.value === f.values.sort) ? f.values.sort : 'name';

  // Old links (dashboard quick action) open the admission page.
  useEffect(() => {
    if (params.get('new') === '1') router.replace('/students/new');
  }, [params, router]);

  const path = `/students${qs({ search, classId, sectionId, status, gender, transport, sort, page: f.page, limit: 25 })}`;
  const { data, error, loading, reload } = useApi<Paged<StudentRow>>(path);
  const chips = [
    chip('search', 'Search', search, `“${search}”`, () => f.set({ search: '' })),
    ...classSectionChips(cls, f.values, f.set),
    chip('status', 'Status', status, label(STATUSES, status), () => f.set({ status: 'active' }), status === 'active'),
    chip('gender', 'Gender', gender, label(GENDERS, gender), () => f.set({ gender: '' })),
    chip('transport', 'Transport', transport, label(TRANSPORT, transport), () => f.set({ transport: '' })),
  ];
  const filtered = chips.some(Boolean);

  return (
    <Page wide>
      <PageHeader
        title="Students"
        description={
          data ? (
            <span data-result-count={data.meta.total}>
              {data.meta.total.toLocaleString('en-IN')} {status === 'left' ? 'former ' : ''}student{data.meta.total === 1 ? '' : 's'}
              {filtered ? ' match the filters' : ''}
            </span>
          ) : (
            'Admissions, profiles and records'
          )
        }
        actions={
          <Link href="/students/new" className={buttonClass()}>
            <UserPlus className="h-4 w-4" aria-hidden />
            New admission
          </Link>
        }
      />
      <Card padded={false}>
        <FilterBar
          search={<FilterSearch value={search} onChange={(v) => f.set({ search: v })} placeholder="Name, admission no., roll, phone" />}
          chips={chips}
          onClear={f.clear}
          extra={<SelectFilter label="Sort by" name="sort" value={sort} options={SORTS} onChange={(v) => f.set({ sort: v })} />}
        >
          <ClassSectionFilter options={cls} classId={classId} sectionId={sectionId} onChange={f.set} />
          <SelectFilter label="Status" name="status" value={status} options={STATUSES} onChange={(v) => f.set({ status: v })} />
          <SelectFilter label="Gender" name="gender" value={gender} allLabel="All" options={GENDERS} onChange={(v) => f.set({ gender: v })} className="sm:w-32" />
          <SelectFilter label="Transport" name="transport" value={transport} allLabel="All" options={TRANSPORT} onChange={(v) => f.set({ transport: v })} />
        </FilterBar>

        {loading && !data ? (
          <Spinner label="Loading students…" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data?.data.length ? (
          filtered ? (
            <FilteredEmpty what="students" chips={chips} onClear={f.clear} />
          ) : (
            <EmptyState
              title="No students yet"
              description="Admit your first student to get started."
              action={
                <Link href="/students/new" className={buttonClass()}>
                  New admission
                </Link>
              }
            />
          )
        ) : (
          <div className={loading ? 'opacity-60 transition-opacity' : undefined}>
            <Table>
              <thead>
                <tr>
                  <Th>Student</Th>
                  <Th>Class</Th>
                  <Th align="right">Roll</Th>
                  <Th>Gender</Th>
                  <Th>Date of birth</Th>
                  <Th>Parent</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((s) => (
                  <tr key={s.id} onClick={() => router.push(`/students/${s.id}`)} className="cursor-pointer hover:bg-slate-50/70 dark:hover:bg-white/[0.025]">
                    <Td>
                      <div className="flex items-center gap-3">
                        <Avatar name={s.name} />
                        <div className="min-w-0">
                          <Link href={`/students/${s.id}`} onClick={(e) => e.stopPropagation()} className="whitespace-nowrap font-medium hover:text-indigo-700 hover:underline dark:hover:text-indigo-300">
                            {s.name}
                          </Link>
                          <p className="text-xs tabular-nums text-slate-500 dark:text-slate-400">{s.admissionNumber}</p>
                        </div>
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap">{[s.class?.name, s.section?.name].filter(Boolean).join(' ') || '-'}</Td>
                    <Td align="right">{s.rollNumber ?? '-'}</Td>
                    <Td>{titleCase(s.gender)}</Td>
                    <Td className="whitespace-nowrap">{formatDate(s.dateOfBirth)}</Td>
                    <Td className="whitespace-nowrap">
                      {s.parent ? (
                        <div>
                          <p>{s.parent.name}</p>
                          <span onClick={(e) => e.stopPropagation()}>
                            <PhoneLink phone={s.parent.phone} className="text-xs" />
                          </span>
                        </div>
                      ) : (
                        '-'
                      )}
                    </Td>
                    <Td>
                      <StudentStatusBadge status={s.status} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onChange={f.setPage} />
          </div>
        )}
      </Card>

    </Page>
  );
}
