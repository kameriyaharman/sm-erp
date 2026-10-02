'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, UserPlus } from 'lucide-react';
import { Button, Card, EmptyState, ErrorState, Page, PageHeader, Pagination, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { qs, useApi } from '@/lib/useApi';
import { formatDate, titleCase } from '@/lib/format';
import { Avatar, FilterBar, PhoneLink, StudentStatusBadge, useClasses, useDebounced } from '../shared';
import AdmissionModal from './AdmissionModal';
import type { Paged, StudentRow } from '../types';

export default function StudentsList() {
  const router = useRouter();
  const params = useSearchParams();
  const { classes, sections } = useClasses();
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [status, setStatus] = useState<'active' | 'left' | 'all'>('active');
  const [sort, setSort] = useState<'name' | 'admission' | 'class'>('name');
  const [page, setPage] = useState(1);
  const [admitting, setAdmitting] = useState(false);

  useEffect(() => {
    if (params.get('new') === '1') setAdmitting(true);
  }, [params]);
  useEffect(() => setPage(1), [q, classId, sectionId, status, sort]);

  const path = `/students${qs({ search: q.length ? q : undefined, classId, sectionId, status, sort, page, limit: 25 })}`;
  const { data, error, loading, reload } = useApi<Paged<StudentRow>>(path);
  const classSections = useMemo(() => sections.filter((s) => s.classId === classId), [sections, classId]);
  const filtered = Boolean(q || classId || sectionId || status !== 'active');

  return (
    <Page wide>
      <PageHeader
        title="Students"
        description={data ? `${data.meta.total.toLocaleString('en-IN')} ${status === 'left' ? 'former' : ''} students${filtered ? ' match the filters' : ''}` : 'Admissions, profiles and records'}
        actions={
          <Button icon={<UserPlus className="h-4 w-4" aria-hidden />} onClick={() => setAdmitting(true)}>
            New admission
          </Button>
        }
      />
      <Card padded={false}>
        <FilterBar>
          <label className="relative block sm:w-72">
            <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Search</span>
            <Search className="pointer-events-none absolute bottom-2.5 left-3 h-4 w-4 text-slate-400" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, admission no., roll, phone"
              className="block h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-950"
            />
          </label>
          <Select
            label="Class"
            value={classId}
            onChange={(e) => {
              setClassId(e.target.value);
              setSectionId('');
            }}
          >
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select label="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} disabled={!classId}>
            <option value="">All sections</option>
            {classSections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="active">Current students</option>
            <option value="left">Left the school</option>
            <option value="all">All</option>
          </Select>
          <Select label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="name">Name</option>
            <option value="admission">Admission no.</option>
            <option value="class">Class</option>
          </Select>
        </FilterBar>

        {loading && !data ? (
          <Spinner label="Loading students…" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data?.data.length ? (
          <EmptyState
            title={filtered ? 'No students match these filters' : 'No students yet'}
            description={filtered ? 'Try a different name or clear the filters.' : 'Admit your first student to get started.'}
            action={!filtered && <Button onClick={() => setAdmitting(true)}>New admission</Button>}
          />
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
                  <tr key={s.id} onClick={() => router.push(`/students/${s.id}`)} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40">
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
            <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onChange={setPage} />
          </div>
        )}
      </Card>

      <AdmissionModal
        open={admitting}
        onClose={() => setAdmitting(false)}
        classes={classes}
        sections={sections}
        onCreated={(s) => {
          setAdmitting(false);
          router.push(`/students/${s.id}?admitted=1`);
        }}
      />
    </Page>
  );
}
