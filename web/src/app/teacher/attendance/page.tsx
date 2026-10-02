'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { BookOpenCheck, CalendarDays, CalendarCheck, ClipboardList } from 'lucide-react';
import AttendanceGrid from '@/features/attendance/AttendanceGrid';
import { createAttendanceApi } from '@/features/attendance/api';
import RequireAuth from '@/components/RequireAuth';
import { Card, Page, PageHeader, Spinner, buttonClass } from '@/components/ui';
import { API_BASE, getAccessToken } from '@/lib/session';
import { useTeacherScope } from '@/lib/access';

/** Shown to teachers who are not a class teacher: attendance is the class teacher's job (docs/rbac.md). */
function ClassTeachersOnly({ hasSubjects }: { hasSubjects: boolean }) {
  return (
    <Page>
      <PageHeader title="Attendance" />
      <ClassTeachersOnlyCard hasSubjects={hasSubjects} />
    </Page>
  );
}

function ClassTeachersOnlyCard({ hasSubjects }: { hasSubjects: boolean }) {
  return (
    <Card>
      <div className="mx-auto flex max-w-lg flex-col items-center gap-3 px-2 py-10 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-300">
          <CalendarCheck className="h-5 w-5" aria-hidden />
        </span>
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Only class teachers mark attendance</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          You are not the class teacher of any section this year, so there is no register for you to mark. Each class&apos;s attendance is taken by its class teacher. Ask
          the school office if this is wrong.
        </p>
        {hasSubjects ? (
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Link href="/homework" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
              <BookOpenCheck aria-hidden /> Homework
            </Link>
            <Link href="/teacher/marks" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
              <ClipboardList aria-hidden /> Marks entry
            </Link>
            <Link href="/teacher/timetable" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
              <CalendarDays aria-hidden /> My timetable
            </Link>
          </div>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">You haven&apos;t been assigned any subjects yet either. Ask the school office to assign your classes.</p>
        )}
      </div>
    </Card>
  );
}

function Attendance() {
  const api = useMemo(
    () => createAttendanceApi({ baseUrl: API_BASE, getAccessToken, onUnauthorized: () => window.location.assign('/login?next=/teacher/attendance') }),
    [],
  );
  const { scope, loading, isTeacher } = useTeacherScope();
  if (isTeacher && loading) return <Spinner label="Loading your classes…" />;
  if (isTeacher && scope && !scope.isClassTeacher) return <ClassTeachersOnly hasSubjects={scope.subjects.length > 0} />;
  return (
    <main className="px-4 pt-6 sm:px-6 lg:px-8 lg:pt-8">
      <AttendanceGrid api={api} emptyState={isTeacher ? <ClassTeachersOnlyCard hasSubjects={!!scope?.subjects.length} /> : undefined} />
    </main>
  );
}

export default function TeacherAttendancePage() {
  return (
    <RequireAuth roles={['teacher', 'branch_admin', 'super_admin']}>
      <Attendance />
    </RequireAuth>
  );
}
