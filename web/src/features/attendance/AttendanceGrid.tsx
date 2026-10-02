'use client';

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CalendarDays,
  Check,
  CheckCheck,
  CircleAlert,
  Clock,
  LoaderCircle,
  Lock,
  MailCheck,
  MessageSquareOff,
  RotateCcw,
  Search,
  Send,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  ApiError,
  type AttendanceApi,
  type AttendanceStatus,
  type Roster,
  type RosterStudent,
  type SectionOption,
  type SubmitAttendanceResult,
} from './api';
import { friendlyError } from '@/lib/access';

/* ============================================================================
 * Teacher attendance grid
 * Mobile first: one thumb-sized row per student, a fixed bottom bar with the
 * running count and the submit button. On desktop the summary moves into a
 * sticky side panel. New registers start with everyone present; tapping a row
 * toggles that student between Present and Absent.
 * ========================================================================== */

const OTHER_LABEL: Partial<Record<AttendanceStatus, string>> = { late: 'Late', leave: 'On leave', half_day: 'Half day' };

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatDay(iso: string, today?: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const label = `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
  return iso === today ? `Today, ${label}` : `${label} ${y}`;
}
const formatTime = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

const isPresentLike = (status: AttendanceStatus) => status !== 'absent';

interface AttendanceGridProps {
  api: AttendanceApi;
  /** Let the user pick another date (the API still enforces how far back each role may go). */
  allowDateChange?: boolean;
  /** Shown instead of the grid when the user has no section to mark (e.g. a teacher who is not a class teacher). */
  emptyState?: ReactNode;
}

export default function AttendanceGrid({ api, allowDateChange = true, emptyState }: AttendanceGridProps) {
  const ids = { section: useId(), date: useId(), search: useId(), sheetTitle: useId() };

  const [sections, setSections] = useState<SectionOption[] | null>(null);
  const [sectionsError, setSectionsError] = useState<string | null>(null);
  const [sectionId, setSectionId] = useState<string>('');
  const [date, setDate] = useState<string | undefined>(undefined);

  const [roster, setRoster] = useState<Roster | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
  const [search, setSearch] = useState('');
  const [absentOnly, setAbsentOnly] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<ApiError | Error | null>(null);
  const [result, setResult] = useState<SubmitAttendanceResult | null>(null);

  // ---------------------------------------------------------------- data
  useEffect(() => {
    const controller = new AbortController();
    api
      .listSections(undefined, controller.signal)
      .then((list) => {
        setSections(list);
        // Prefer the teacher's own class that still needs today's register.
        const pick = list.find((s) => s.isClassTeacher && !s.submission) ?? list.find((s) => s.isClassTeacher) ?? list[0];
        if (pick) setSectionId((current) => current || pick.id);
      })
      .catch((err: Error) => err.name !== 'AbortError' && setSectionsError(friendlyError(err)));
    return () => controller.abort();
  }, [api]);

  const loadedFor = useRef<string>('');
  useEffect(() => {
    if (!sectionId) return;
    const controller = new AbortController();
    const key = `${sectionId}|${date ?? ''}`;
    const sameView = loadedFor.current === key; // a background refresh after submit
    setLoadingRoster(true);
    setRosterError(null);
    api
      .getRoster(sectionId, date, controller.signal)
      .then((data) => {
        setRoster(data);
        if (!sameView) {
          setMarks(Object.fromEntries(data.students.map((s) => [s.studentId, s.status ?? 'present'])));
          setSearch('');
          setAbsentOnly(false);
          setResult(null);
        }
        loadedFor.current = key;
        setLoadingRoster(false);
      })
      .catch((err: Error) => {
        if (err.name === 'AbortError') return;
        setRosterError(friendlyError(err));
        setLoadingRoster(false);
      });
    return () => controller.abort();
  }, [api, sectionId, date, reloadKey]);

  // ---------------------------------------------------------------- derived
  const students = roster?.students ?? [];
  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, other: 0, total: students.length };
    for (const s of students) {
      const status = marks[s.studentId] ?? 'present';
      if (status === 'present') c.present += 1;
      else if (status === 'absent') c.absent += 1;
      else c.other += 1;
    }
    return c;
  }, [students, marks]);

  // Marks that differ from what is saved (unmarked students count as present).
  const changedCount = useMemo(
    () => students.filter((s) => (s.status ?? 'present') !== marks[s.studentId]).length,
    [students, marks],
  );
  const neverSubmitted = !roster?.submission;
  const dirty = neverSubmitted || changedCount > 0;
  const canSubmit = !!roster && roster.canEdit && students.length > 0 && dirty && !submitting;

  const absentStudents = students.filter((s) => marks[s.studentId] === 'absent');
  const absentWithoutContact = absentStudents.filter((s) => !s.hasParentContact);
  const newlyAbsent = absentStudents.filter((s) => s.status !== 'absent');

  const visibleStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students.filter((s) => {
      if (absentOnly && marks[s.studentId] !== 'absent') return false;
      if (!q) return true;
      return s.name.toLowerCase().includes(q) || (s.rollNumber ?? '').toLowerCase() === q || s.admissionNumber.toLowerCase().includes(q);
    });
  }, [students, marks, search, absentOnly]);

  // Warn before leaving with unsaved marks.
  useEffect(() => {
    if (!roster?.canEdit || changedCount === 0) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [roster?.canEdit, changedCount]);

  // ---------------------------------------------------------------- actions
  const toggle = useCallback(
    (studentId: string) => {
      if (!roster?.canEdit) return;
      setResult(null);
      setMarks((current) => ({ ...current, [studentId]: current[studentId] === 'absent' ? 'present' : 'absent' }));
    },
    [roster?.canEdit],
  );

  function markAllPresent() {
    setResult(null);
    setMarks(Object.fromEntries(students.map((s) => [s.studentId, 'present' as AttendanceStatus])));
  }

  function discardChanges() {
    setMarks(Object.fromEntries(students.map((s) => [s.studentId, s.status ?? 'present'])));
  }

  async function submit() {
    if (!roster) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await api.submitAttendance({
        sectionId: roster.section.id,
        date: roster.date,
        records: students.map((s) => ({ studentId: s.studentId, status: marks[s.studentId] ?? 'present' })),
      });
      setResult(response);
      setConfirmOpen(false);
      setSections((list) =>
        list?.map((s) =>
          s.id === roster.section.id && roster.date === roster.today
            ? { ...s, submission: { submittedAt: response.submittedAt, present: response.counts.present, absent: response.counts.absent, total: response.counts.total } }
            : s,
        ) ?? null,
      );
      // Refresh marks + delivery status now, and again once the messages have had time to go out.
      setReloadKey((k) => k + 1);
      window.setTimeout(() => setReloadKey((k) => k + 1), 2000);
    } catch (err) {
      setSubmitError(err as Error);
    } finally {
      setSubmitting(false);
    }
  }

  // ---------------------------------------------------------------- render
  if (sectionsError) {
    return <FullState icon={TriangleAlert} title="Couldn't load your classes" body={sectionsError} />;
  }
  if (sections && sections.length === 0) {
    return emptyState ?? <FullState icon={CircleAlert} title="No sections to mark" body="No sections are set up for this year yet. Add classes and sections first." />;
  }

  const submitLabel = neverSubmitted ? 'Submit attendance' : 'Update attendance';
  const lockedReason = roster && !roster.canEdit ? roster.editBlockedReason : null;
  const switchLocked = changedCount > 0;

  return (
    <div className="mx-auto w-full max-w-content pb-36 lg:pb-8">
      {/* ------------------------------------------------ header */}
      <header className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Attendance</h1>
            <p className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">
              {roster ? `${roster.section.branchName}, ${roster.section.academicYear}` : 'Loading your classes'}
            </p>
          </div>
          {roster?.submission && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300">
              <CheckCheck className="h-3.5 w-3.5" aria-hidden />
              Submitted
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <label htmlFor={ids.section} className="mb-1.5 block text-13 font-medium text-slate-700 dark:text-slate-300">
              Class and section
            </label>
            <select
              id={ids.section}
              value={sectionId}
              disabled={!sections || switchLocked || submitting}
              onChange={(e) => setSectionId(e.target.value)}
              className="block h-11 w-full rounded-lg lg:h-10 border border-line-strong bg-surface px-3 text-base font-medium text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-[3px] focus:ring-indigo-500/20 disabled:opacity-60 sm:text-sm dark:border-slate-700 dark:text-slate-100"
            >
              {!sections && <option>Loading</option>}
              {sections?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                  {sections.some((x) => x.branch.id !== s.branch.id) ? `, ${s.branch.name}` : ''}
                  {` (${s.studentCount})`}
                  {s.submission ? ', done' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={ids.date} className="mb-1.5 block text-13 font-medium text-slate-700 dark:text-slate-300">
              Date
            </label>
            {allowDateChange && roster ? (
              <div className="relative">
                <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <input
                  id={ids.date}
                  type="date"
                  value={roster.date}
                  max={roster.today}
                  disabled={switchLocked || submitting}
                  onChange={(e) => e.target.value && setDate(e.target.value)}
                  className="block h-11 w-full rounded-lg lg:h-10 border border-line-strong bg-surface pl-9 pr-3 text-base text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-[3px] focus:ring-indigo-500/20 disabled:opacity-60 sm:w-48 sm:text-sm dark:border-slate-700 dark:text-slate-100"
                />
              </div>
            ) : (
              <p id={ids.date} className="flex h-11 items-center text-sm font-medium text-slate-900 dark:text-slate-100">
                {roster ? formatDay(roster.date, roster.today) : ''}
              </p>
            )}
          </div>
        </div>
        {switchLocked && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Submit or discard your {changedCount} change{changedCount === 1 ? '' : 's'} to switch class or date.{' '}
            <button type="button" onClick={discardChanges} className="font-medium text-slate-700 underline underline-offset-2 dark:text-slate-200">
              Discard changes
            </button>
          </p>
        )}
      </header>

      {/* ------------------------------------------------ banners */}
      <div className="mt-4 flex flex-col gap-3" aria-live="polite">
        {result && <ResultBanner result={result} />}
        {lockedReason && (
          <Banner tone="neutral" icon={Lock}>
            {lockedReason} The register is read-only.
          </Banner>
        )}
        {roster && !lockedReason && !result && (
          neverSubmitted ? (
            <Banner tone="info" icon={Clock}>
              {roster.date === roster.today ? 'Not taken yet today.' : `Not taken yet for ${formatDay(roster.date)}.`} Everyone starts as present; tap a student to mark them absent.
            </Banner>
          ) : (
            <Banner tone="neutral" icon={CheckCheck}>
              Submitted at {formatTime(roster.submission!.submittedAt)}
              {roster.submission!.submittedBy ? ` by ${roster.submission!.submittedBy}` : ''}
              {roster.submission!.revision > 1 && roster.submission!.updatedBy ? `, last changed at ${formatTime(roster.submission!.updatedAt)} by ${roster.submission!.updatedBy}` : ''}
              . You can still correct it; parents are only messaged about changes.
            </Banner>
          )
        )}
        {rosterError && (
          <Banner tone="danger" icon={TriangleAlert}>
            {rosterError}{' '}
            <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="font-semibold underline underline-offset-2">
              Try again
            </button>
          </Banner>
        )}
      </div>

      {/* ------------------------------------------------ body */}
      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section aria-label="Students" className="min-w-0">
          {/* list tools */}
          <div className="mb-3 flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <label htmlFor={ids.search} className="sr-only">
                Find a student
              </label>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                id={ids.search}
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name or roll no."
                className="block h-10 w-full rounded-lg border border-line-strong bg-surface pl-9 pr-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-[3px] focus:ring-indigo-500/20 sm:text-sm dark:border-slate-700 dark:text-slate-100"
              />
            </div>
            <button
              type="button"
              aria-pressed={absentOnly}
              onClick={() => setAbsentOnly((v) => !v)}
              className={[
                'h-10 shrink-0 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                absentOnly
                  ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300'
                  : 'border-line-strong bg-surface text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-white/5',
              ].join(' ')}
            >
              Absent <span className="tabular-nums">({counts.absent})</span>
            </button>
          </div>

          <div className="overflow-hidden rounded-xl border border-line bg-surface">
            {loadingRoster && !roster ? (
              <SkeletonList />
            ) : visibleStudents.length === 0 ? (
              <p className="px-4 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                {students.length === 0 ? 'No students are enrolled in this section.' : absentOnly ? 'Nobody is marked absent.' : 'No student matches your search.'}
              </p>
            ) : (
              <ul className={`divide-y divide-line ${loadingRoster ? 'opacity-70' : ''}`}>
                {visibleStudents.map((s) => (
                  <StudentRow
                    key={s.studentId}
                    student={s}
                    status={marks[s.studentId] ?? 'present'}
                    changed={(s.status ?? 'present') !== marks[s.studentId]}
                    disabled={!roster?.canEdit || submitting}
                    onToggle={toggle}
                  />
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* desktop summary panel */}
        <aside className="hidden lg:block">
          <div className="sticky top-20 flex flex-col gap-4 rounded-xl border border-line bg-surface p-5">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {roster ? `${roster.section.label}, ${formatDay(roster.date, roster.today)}` : 'Summary'}
            </h2>
            <Counts counts={counts} />
            {roster?.canEdit && counts.absent > 0 && (
              <button type="button" onClick={markAllPresent} className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white">
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                Mark everyone present
              </button>
            )}
            {absentWithoutContact.length > 0 && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {absentWithoutContact.length} absent student{absentWithoutContact.length === 1 ? ' has' : 's have'} no parent contact on file, so no message will go out.
              </p>
            )}
            <SubmitButton label={submitLabel} disabled={!canSubmit} submitting={submitting} onClick={() => setConfirmOpen(true)} dirty={dirty} />
          </div>
        </aside>
      </div>

      {/* mobile bottom bar */}
      <div
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 pt-3 backdrop-blur lg:hidden"
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="mx-auto flex max-w-content items-center gap-3">
          <p className="min-w-0 flex-1 text-sm text-slate-600 dark:text-slate-300">
            <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">{counts.present + counts.other}</span> present
            <span className="mx-1.5 text-slate-300 dark:text-slate-600" aria-hidden>/</span>
            <span className={`font-semibold tabular-nums ${counts.absent > 0 ? 'text-red-700 dark:text-red-400' : 'text-slate-900 dark:text-slate-100'}`}>{counts.absent}</span> absent
          </p>
          <SubmitButton label={submitLabel} disabled={!canSubmit} submitting={submitting} onClick={() => setConfirmOpen(true)} dirty={dirty} compact />
        </div>
      </div>

      {confirmOpen && roster && (
        <ConfirmSheet
          titleId={ids.sheetTitle}
          title={`${submitLabel} for ${roster.section.label}?`}
          dateLabel={formatDay(roster.date, roster.today)}
          counts={counts}
          absent={absentStudents}
          newlyAbsent={newlyAbsent.length}
          noContact={absentWithoutContact.length}
          isUpdate={!neverSubmitted}
          submitting={submitting}
          error={submitError}
          confirmLabel={submitLabel}
          onCancel={() => {
            if (!submitting) {
              setConfirmOpen(false);
              setSubmitError(null);
            }
          }}
          onConfirm={submit}
          onReload={() => {
            setConfirmOpen(false);
            setSubmitError(null);
            loadedFor.current = '';
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

/* ============================================================================
 * Row
 * ========================================================================== */

const StudentRow = memo(function StudentRow({
  student,
  status,
  changed,
  disabled,
  onToggle,
}: {
  student: RosterStudent;
  status: AttendanceStatus;
  changed: boolean;
  disabled: boolean;
  onToggle: (studentId: string) => void;
}) {
  const present = isPresentLike(status);
  const otherLabel = OTHER_LABEL[status];
  const note = student.notification;

  return (
    <li>
      <button
        type="button"
        role="switch"
        aria-checked={present}
        aria-label={`${student.name}, roll ${student.rollNumber ?? 'not set'}: ${present ? otherLabel ?? 'present' : 'absent'}`}
        disabled={disabled}
        onClick={() => onToggle(student.studentId)}
        className={[
          'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 disabled:cursor-default sm:px-5 dark:focus-visible:ring-slate-300',
          present ? 'hover:bg-slate-50/70 dark:hover:bg-white/[0.025]' : 'bg-red-50/70 hover:bg-red-50 dark:bg-red-500/[0.07] dark:hover:bg-red-500/10',
        ].join(' ')}
      >
        <span
          aria-hidden
          className={[
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums',
            present ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' : 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200',
          ].join(' ')}
        >
          {student.rollNumber ?? '·'}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[15px] font-medium text-slate-900 dark:text-slate-100">{student.name}</span>
            {changed && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500 dark:bg-indigo-400" title="Changed, not saved yet" aria-hidden />}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
            <span className="tabular-nums">{student.admissionNumber}</span>
            {otherLabel && <span className="rounded bg-slate-100 px-1.5 py-px font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">{otherLabel}</span>}
            {!present && <NotificationHint student={student} note={note} />}
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-2.5">
          <span className={`w-14 text-right text-xs font-semibold ${present ? 'text-slate-500 dark:text-slate-400' : 'text-red-700 dark:text-red-400'}`}>
            {present ? 'Present' : 'Absent'}
          </span>
          <span
            aria-hidden
            className={[
              'relative inline-flex h-7 w-12 items-center rounded-full transition-colors',
              present ? 'bg-emerald-600 dark:bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600',
            ].join(' ')}
          >
            <span
              className={[
                'absolute left-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-white shadow transition-transform',
                present ? 'translate-x-5' : 'translate-x-0',
              ].join(' ')}
            >
              {present ? <Check className="h-3.5 w-3.5 text-emerald-600" strokeWidth={3} /> : <X className="h-3.5 w-3.5 text-slate-500" strokeWidth={3} />}
            </span>
          </span>
        </span>
      </button>
    </li>
  );
});

function NotificationHint({ student, note }: { student: RosterStudent; note: RosterStudent['notification'] }) {
  if (!student.hasParentContact) {
    return (
      <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
        <MessageSquareOff className="h-3 w-3" aria-hidden />
        No parent contact
      </span>
    );
  }
  if (!note || note.template !== 'attendance_absent' || student.status !== 'absent') return null;
  const channel = note.channel === 'email' ? 'Email' : note.channel === 'whatsapp' ? 'WhatsApp' : 'SMS';
  if (note.status === 'sent') {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
        <MailCheck className="h-3 w-3" aria-hidden />
        {channel} sent to parent
      </span>
    );
  }
  if (note.status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400">
        <TriangleAlert className="h-3 w-3" aria-hidden />
        Message failed
      </span>
    );
  }
  if (note.status === 'queued' || note.status === 'sending') {
    return (
      <span className="inline-flex items-center gap-1">
        <Clock className="h-3 w-3" aria-hidden />
        {channel} sending
      </span>
    );
  }
  return null;
}

/* ============================================================================
 * Pieces
 * ========================================================================== */

function Counts({ counts }: { counts: { present: number; absent: number; other: number; total: number } }) {
  const pct = counts.total ? Math.round(((counts.present + counts.other) / counts.total) * 1000) / 10 : 0;
  return (
    <div>
      <dl className="grid grid-cols-3 gap-3">
        <div>
          <dt className="text-xs text-slate-500 dark:text-slate-400">Present</dt>
          <dd className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">{counts.present + counts.other}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500 dark:text-slate-400">Absent</dt>
          <dd className={`text-2xl font-semibold tabular-nums ${counts.absent ? 'text-red-700 dark:text-red-400' : 'text-slate-900 dark:text-slate-50'}`}>{counts.absent}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500 dark:text-slate-400">Total</dt>
          <dd className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">{counts.total}</dd>
        </div>
      </dl>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-red-100 dark:bg-red-500/20" aria-hidden>
        <div className="h-full rounded-full bg-emerald-600 transition-[width] dark:bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 text-xs tabular-nums text-slate-500 dark:text-slate-400">{pct}% attendance</p>
    </div>
  );
}

function SubmitButton({
  label,
  disabled,
  submitting,
  onClick,
  dirty,
  compact,
}: {
  label: string;
  disabled: boolean;
  submitting: boolean;
  onClick: () => void;
  dirty: boolean;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 dark:bg-indigo-500 dark:hover:bg-indigo-400 dark:disabled:bg-white/[0.06] dark:disabled:text-slate-500',
        compact ? 'h-11 px-4 text-sm' : 'h-11 w-full text-sm',
      ].join(' ')}
    >
      {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
      {!dirty ? 'Saved' : label}
    </button>
  );
}

function Banner({ tone, icon: Icon, children }: { tone: 'info' | 'neutral' | 'danger' | 'success'; icon: typeof Lock; children: ReactNode }) {
  const tones = {
    info: 'border-indigo-200 bg-indigo-50/70 text-indigo-900 dark:border-indigo-400/25 dark:bg-indigo-400/10 dark:text-indigo-100',
    neutral: 'border-line bg-surface text-slate-700 dark:text-slate-300',
    danger: 'border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200',
  };
  return (
    <div className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm ${tones[tone]}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <p className="min-w-0">{children}</p>
    </div>
  );
}

function ResultBanner({ result }: { result: SubmitAttendanceResult }) {
  const n = result.notifications;
  const parts: string[] = [];
  if (n.queued) parts.push(`${n.queued} parent message${n.queued === 1 ? '' : 's'} sent`);
  if (n.corrections) parts.push(`${n.corrections} correction${n.corrections === 1 ? '' : 's'} sent`);
  if (n.cancelled) parts.push(`${n.cancelled} pending message${n.cancelled === 1 ? '' : 's'} withdrawn`);
  if (n.skipped.length) parts.push(`${n.skipped.length} without parent contact`);
  return (
    <Banner tone="success" icon={CheckCheck}>
      <span className="font-semibold">
        {result.updated ? 'Attendance updated' : 'Attendance submitted'} at {formatTime(result.submittedAt)}.
      </span>{' '}
      {result.counts.present + result.counts.other} present, {result.counts.absent} absent.
      {parts.length > 0 && ` ${parts.join(', ')}.`}
    </Banner>
  );
}

function ConfirmSheet(props: {
  titleId: string;
  title: string;
  dateLabel: string;
  counts: { present: number; absent: number; other: number; total: number };
  absent: RosterStudent[];
  newlyAbsent: number;
  noContact: number;
  isUpdate: boolean;
  submitting: boolean;
  error: ApiError | Error | null;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  onReload: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const { onCancel } = props;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onCancel();
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [onCancel]);

  const rosterChanged = props.error instanceof ApiError && (props.error.code === 'ROSTER_INCOMPLETE' || props.error.code === 'STUDENT_NOT_IN_SECTION');
  const messageable = props.isUpdate ? props.newlyAbsent : props.absent.length - props.noContact;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 bg-ink-950/45" aria-hidden onClick={props.onCancel} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={props.titleId}
        className="relative flex max-h-[85vh] w-full flex-col rounded-t-2xl border border-line bg-surface shadow-pop sm:max-w-md sm:rounded-2xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-slate-300 sm:hidden dark:bg-slate-700" aria-hidden />
        <div className="px-5 pb-2 pt-4 sm:pt-5">
          <h2 id={props.titleId} className="text-lg font-semibold text-slate-900 dark:text-slate-50">
            {props.title}
          </h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{props.dateLabel}</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          <Counts counts={props.counts} />

          {props.absent.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">Absent</h3>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {props.absent.map((s) => (
                  <li key={s.studentId} className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-800 dark:bg-red-500/10 dark:text-red-300">
                    {s.rollNumber ? `${s.rollNumber}. ` : ''}
                    {s.name}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">
            {messageable > 0
              ? `Parents of ${messageable} ${props.isUpdate ? 'newly absent ' : ''}student${messageable === 1 ? '' : 's'} will get an SMS or email.`
              : props.isUpdate
                ? 'Parents are only messaged about changes; nobody new is absent.'
                : 'No parent messages will be sent.'}
            {props.noContact > 0 && ` ${props.noContact} absent student${props.noContact === 1 ? ' has' : 's have'} no parent contact on file.`}
          </p>

          {props.error && (
            <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              {props.error.message}
              {rosterChanged && (
                <button type="button" onClick={props.onReload} className="ml-1 font-semibold underline underline-offset-2">
                  Reload class list
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2 border-t border-line px-5 py-4">
          <button
            type="button"
            onClick={props.onCancel}
            disabled={props.submitting}
            className="h-11 flex-1 rounded-lg border border-line-strong text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Go back
          </button>
          <button
            type="button"
            data-autofocus
            onClick={props.onConfirm}
            disabled={props.submitting}
            className="inline-flex h-11 flex-[1.4] items-center justify-center gap-2 rounded-lg bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 dark:bg-indigo-500 dark:hover:bg-indigo-400"
          >
            {props.submitting ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
            {props.submitting ? 'Submitting' : props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function FullState({ icon: Icon, title, body }: { icon: typeof Lock; title: string; body: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-20 text-center">
      <Icon className="h-6 w-6 text-slate-400" aria-hidden />
      <p className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</p>
      <p className="text-sm text-slate-500 dark:text-slate-400">{body}</p>
    </div>
  );
}

function SkeletonList() {
  return (
    <ul aria-hidden className="divide-y divide-line">
      {Array.from({ length: 8 }, (_, i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
          <span className="h-9 w-9 animate-pulse rounded-full bg-slate-200/70 dark:bg-white/[0.06]" />
          <span className="flex-1 space-y-1.5">
            <span className="block h-3.5 w-40 animate-pulse rounded bg-slate-200/70 dark:bg-white/[0.06]" />
            <span className="block h-3 w-24 animate-pulse rounded bg-slate-200/70 dark:bg-white/[0.06]" />
          </span>
          <span className="h-7 w-12 animate-pulse rounded-full bg-slate-200/70 dark:bg-white/[0.06]" />
        </li>
      ))}
    </ul>
  );
}
