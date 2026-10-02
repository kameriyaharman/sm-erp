'use client';

/**
 * Admin: which subjects a teacher teaches in which sections (one teacher per subject per section).
 *  - AssignSubjectsModal: section x subject matrix for one teacher; PUT /staff/:id/assignments.
 *    A pair held by someone else shows their name; saving it gives 409 SUBJECT_TAKEN, and the admin
 *    can move those subjects (resend with reassign: true).
 *  - WhoTeaches: per-section list from GET /school/assignments.
 *  - SubjectChips: compact "English, 5 A" chips for the staff table.
 */

import { useMemo, useState } from 'react';
import { ArrowRightLeft, BookOpen, UserRound } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, Modal, Notice, Select, Spinner, Table, Td, Th, cx } from '@/components/ui';
import { qs, useApi } from '@/lib/useApi';
import { ApiError, apiSend } from '@/lib/session';
import { friendlyError } from '@/lib/access';
import { useClasses, type FlatSection } from '../shared';
import type { StaffMember, Subject, SubjectConflict, Wrapped } from '../types';

/** "Grade 5 A" -> "5 A" (chips stay short); other labels unchanged. */
export function shortSection(label: string): string {
  return label.replace(/^(Grade|Class|Std\.?)\s+/i, '');
}

const key = (sectionId: string, subjectId: string) => `${sectionId}|${subjectId}`;

export function SubjectChips({ member, max = 4 }: { member: StaffMember; max?: number }) {
  const list = member.subjects ?? [];
  const ct = member.classTeacherOf;
  if (!list.length && !ct.length) return <span className="text-slate-400">-</span>;
  const shown = list.slice(0, max);
  return (
    <div className="flex max-w-[22rem] flex-wrap gap-1">
      {ct.map((c) => (
        <span key={c.sectionId} title={`Class teacher of ${c.label}`}>
          <Badge tone="amber">Class teacher, {shortSection(c.label)}</Badge>
        </span>
      ))}
      {shown.map((s) => (
        <Badge key={key(s.sectionId, s.subjectId)} tone="indigo">
          {s.subjectName}, {shortSection(s.sectionLabel)}
        </Badge>
      ))}
      {list.length > max && (
        <span title={list.slice(max).map((s) => `${s.subjectName}, ${shortSection(s.sectionLabel)}`).join('\n')}>
          <Badge tone="gray">+{list.length - max} more</Badge>
        </span>
      )}
    </div>
  );
}

export function AssignSubjectsModal({ teacher, staff, onClose, onSaved }: { teacher: StaffMember; staff: StaffMember[]; onClose: () => void; onSaved: (message: string) => void }) {
  const { sections, loading: secLoading, error: secError } = useClasses();
  const subjects = useApi<Wrapped<Subject[]>>('/school/subjects');
  const [selected, setSelected] = useState<Set<string>>(() => new Set((teacher.subjects ?? []).map((s) => key(s.sectionId, s.subjectId))));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<SubjectConflict[] | null>(null);

  // Who holds each (section, subject) now, from the staff list.
  const holders = useMemo(() => {
    const map = new Map<string, { staffId: string; name: string }>();
    for (const m of staff) for (const s of m.subjects ?? []) if (m.id !== teacher.id) map.set(key(s.sectionId, s.subjectId), { staffId: m.id, name: m.name });
    return map;
  }, [staff, teacher.id]);

  const initial = useMemo(() => new Set((teacher.subjects ?? []).map((s) => key(s.sectionId, s.subjectId))), [teacher.subjects]);
  const added = [...selected].filter((k) => !initial.has(k)).length;
  const removed = [...initial].filter((k) => !selected.has(k)).length;
  const dirty = added + removed > 0;

  function toggle(k: string) {
    setConflicts(null);
    setError(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  async function save(reassign = false) {
    setSaving(true);
    setError(null);
    try {
      const assignments = [...selected].map((k) => {
        const [sectionId, subjectId] = k.split('|');
        return { sectionId, subjectId };
      });
      await apiSend('PUT', `/staff/${teacher.id}/assignments`, { assignments, reassign });
      const moved = reassign && conflicts ? conflicts.length : 0;
      onSaved(
        `${teacher.name} now teaches ${assignments.length} subject${assignments.length === 1 ? '' : 's'}${moved ? ` (${moved} moved from another teacher)` : ''}.`,
      );
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SUBJECT_TAKEN') {
        const list = ((e.details as { conflicts?: SubjectConflict[] } | undefined)?.conflicts ?? []) as SubjectConflict[];
        setConflicts(list);
      } else {
        setError(friendlyError(e));
      }
    } finally {
      setSaving(false);
    }
  }

  const subjectList = subjects.data?.data ?? [];
  const ready = !secLoading && subjects.data;
  const noun = (n: number) => `${n} subject${n === 1 ? '' : 's'}`;

  return (
    <Modal
      open
      size="xl"
      title={`Subjects and classes for ${teacher.name}`}
      description="Tick the subjects this teacher teaches in each class. One teacher per subject in a class."
      onClose={saving ? () => undefined : onClose}
      footer={
        conflicts ? (
          <>
            <Button variant="secondary" onClick={() => setConflicts(null)} disabled={saving}>
              Back
            </Button>
            <Button icon={<ArrowRightLeft aria-hidden />} onClick={() => save(true)} loading={saving}>
              Move {conflicts.length === 1 ? 'this subject' : 'these subjects'} to {teacher.firstName || teacher.name}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => save(false)} loading={saving} disabled={!dirty || !ready}>
              Save assignments
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Notice tone="error">{error}</Notice>}
        {conflicts ? (
          <div className="flex flex-col gap-3" role="alert">
            <Notice tone="warn">
              {conflicts.length === 1 ? 'This subject is' : 'These subjects are'} already taught by another teacher. Moving {conflicts.length === 1 ? 'it' : 'them'} takes{' '}
              {conflicts.length === 1 ? 'it' : 'them'} away from that teacher; their homework stays, but they can no longer set homework or enter marks for {conflicts.length === 1 ? 'it' : 'them'}.
            </Notice>
            <ul className="divide-y divide-line rounded-xl border border-line">
              {conflicts.map((c) => (
                <li key={key(c.section.id, c.subject.id)} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <span className="font-medium">
                    {c.subject.name}, {c.section.label}
                  </span>
                  <span className="text-slate-500 dark:text-slate-400">Taught by {c.teacher.name}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : secError || subjects.error ? (
          <ErrorState message={(secError ?? subjects.error)!} onRetry={subjects.reload} />
        ) : !ready ? (
          <Spinner label="Loading classes and subjects…" />
        ) : sections.length === 0 || subjectList.length === 0 ? (
          <EmptyState title="Nothing to assign yet" description="Add this year's sections and subjects first." />
        ) : (
          <>
            {/* Phones: one list per class. */}
            <div className="flex flex-col gap-4 sm:hidden">
              {sections.map((sec) => (
                <fieldset key={sec.id} className="rounded-xl border border-line">
                  <legend className="ml-3 px-1 text-sm font-semibold">
                    {sec.label}
                    {sec.classTeacher && <span className="ml-1.5 font-normal text-slate-500 dark:text-slate-400">CT: {sec.classTeacher.name}</span>}
                  </legend>
                  <ul className="divide-y divide-line">
                    {subjectList.map((sub) => {
                      const k = key(sec.id, sub.id);
                      const holder = holders.get(k);
                      return (
                        <li key={sub.id}>
                          <label className={cx('flex min-h-11 items-center gap-3 px-3 py-2', selected.has(k) && 'bg-indigo-50/70 dark:bg-indigo-400/10')}>
                            <input
                              type="checkbox"
                              checked={selected.has(k)}
                              onChange={() => toggle(k)}
                              aria-label={`${sub.name}, ${sec.label}${holder ? ` (taught by ${holder.name})` : ''}`}
                              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600"
                            />
                            <span className="min-w-0 flex-1 text-sm">{sub.name}</span>
                            {holder && <span className="max-w-[45%] truncate text-xs text-slate-400 dark:text-slate-500">{holder.name}</span>}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>
              ))}
            </div>
            {/* Tablet and up: sections x subjects grid. */}
            <div className="hidden overflow-x-auto rounded-xl border border-line sm:block">
              <table className="w-full min-w-max border-collapse text-sm">
                <thead>
                  <tr>
                    <th scope="col" className="sticky left-0 z-[2] border-b border-line bg-surface-muted px-4 py-2.5 text-left text-13 font-medium text-slate-500 dark:text-slate-400">
                      Class
                    </th>
                    {subjectList.map((sub) => (
                      <th key={sub.id} scope="col" className="border-b border-l border-line bg-surface-muted px-3 py-2.5 text-center text-13 font-medium text-slate-600 dark:text-slate-300">
                        <span className="block max-w-[7.5rem] whitespace-normal leading-tight">{sub.name}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sections.map((sec) => (
                    <MatrixRow key={sec.id} section={sec} subjects={subjectList} selected={selected} holders={holders} onToggle={toggle} teacherId={teacher.id} />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-13 text-slate-500 dark:text-slate-400" aria-live="polite">
              {selected.size} selected
              {dirty ? `: ${added ? `${noun(added)} added` : ''}${added && removed ? ', ' : ''}${removed ? `${noun(removed)} removed` : ''}` : ''}. A name in grey means another teacher teaches it now.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}

function MatrixRow({
  section,
  subjects,
  selected,
  holders,
  onToggle,
  teacherId,
}: {
  section: FlatSection;
  subjects: Subject[];
  selected: Set<string>;
  holders: Map<string, { staffId: string; name: string }>;
  onToggle: (k: string) => void;
  teacherId: string;
}) {
  const ct = section.classTeacher;
  return (
    <tr className="[&>td]:border-b [&>td]:border-line">
      <th scope="row" className="sticky left-0 z-[1] border-b border-line bg-surface px-4 py-2 text-left align-middle font-medium">
        <span className="block whitespace-nowrap">{section.label}</span>
        {ct && <span className="block whitespace-nowrap text-xs font-normal text-slate-500 dark:text-slate-400">CT: {ct.name}</span>}
      </th>
      {subjects.map((sub) => {
        const k = key(section.id, sub.id);
        const checked = selected.has(k);
        const holder = holders.get(k);
        const taken = holder && holder.staffId !== teacherId;
        return (
          <td key={sub.id} className={cx('border-l border-line px-2 py-1.5 text-center align-middle', checked && 'bg-indigo-50/70 dark:bg-indigo-400/10')}>
            <label className="flex min-h-[2.5rem] cursor-pointer flex-col items-center justify-center gap-0.5">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(k)}
                aria-label={`${sub.name}, ${section.label}${taken ? ` (taught by ${holder.name})` : ''}`}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600"
              />
              {taken && <span className="max-w-[7rem] truncate text-[11px] leading-tight text-slate-400 dark:text-slate-500">{holder.name}</span>}
            </label>
          </td>
        );
      })}
    </tr>
  );
}

/** "Who teaches what" for one section. */
export function WhoTeaches() {
  const { sections, loading, error, reload } = useClasses();
  const [sectionId, setSectionId] = useState('');
  const active = sectionId || sections[0]?.id || '';
  const section = sections.find((s) => s.id === active);
  const res = useApi<Wrapped<Array<{ subject: { id: string; name: string; code: string | null }; teacher: { staffId: string; name: string } | null }>>>(
    active ? `/school/assignments${qs({ sectionId: active })}` : null,
  );
  const rows = res.data?.data ?? [];
  const missing = rows.filter((r) => !r.teacher).length;

  return (
    <Card
      padded={false}
      title="Who teaches what"
      description={section ? `${section.label}${section.classTeacher ? `, class teacher ${section.classTeacher.name}` : ', no class teacher yet'}` : 'Subject teachers of a class'}
      actions={
        <Select aria-label="Class" value={active} onChange={(e) => setSectionId(e.target.value)} className="!w-44" disabled={!sections.length}>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
      }
    >
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : loading && !sections.length ? (
        <Spinner />
      ) : !sections.length ? (
        <EmptyState title="No classes this year" />
      ) : res.error ? (
        <ErrorState message={res.error} onRetry={res.reload} />
      ) : !res.data ? (
        <Spinner label="Loading subject teachers…" />
      ) : (
        <>
          {missing > 0 && (
            <div className="border-b border-line px-4 py-3 sm:px-5">
              <Notice tone="warn">
                {missing} subject{missing === 1 ? ' has' : 's have'} no teacher in {section?.label}. Nobody can set homework or enter marks for {missing === 1 ? 'it' : 'them'} except the office.
              </Notice>
            </div>
          )}
          <Table>
            <thead>
              <tr>
                <Th>Subject</Th>
                <Th>Teacher</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.subject.id}>
                  <Td>
                    <span className="inline-flex items-center gap-2 font-medium">
                      <BookOpen className="h-4 w-4 text-slate-400" aria-hidden />
                      {r.subject.name}
                    </span>
                  </Td>
                  <Td>
                    {r.teacher ? (
                      <span className="inline-flex items-center gap-2">
                        <UserRound className="h-4 w-4 text-slate-400" aria-hidden />
                        {r.teacher.name}
                      </span>
                    ) : (
                      <Badge tone="amber">Not assigned</Badge>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </Card>
  );
}
