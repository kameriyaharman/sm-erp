'use client';

import { useState, type FormEvent } from 'react';
import { Plus, Users } from 'lucide-react';
import { Badge, Button, Card, cx, EmptyState, ErrorState, Input, Modal, Notice, Select, Spinner } from '@/components/ui';
import { useApi } from '@/lib/useApi';
import { apiSend } from '@/lib/session';
import { ConfirmModal, errorText } from '@/features/admin/shared';
import { RowActions } from './RowActions';
import type { AcademicYear, ClassesResponse, SetupClass, SetupSection, StaffChoice, YearsResponse } from './types';

type Dialog =
  | { kind: 'class'; cls?: SetupClass }
  | { kind: 'delete-class'; cls: SetupClass }
  | { kind: 'toggle-class'; cls: SetupClass }
  | { kind: 'section'; cls: SetupClass; section?: SetupSection }
  | { kind: 'delete-section'; cls: SetupClass; section: SetupSection }
  | null;

/** "LKG" -> -1 etc. for the level picker. */
const LEVELS: Array<[number, string]> = [
  [-3, 'Pre-nursery / playgroup'], [-2, 'Nursery'], [-1, 'LKG'], [0, 'UKG'],
  ...Array.from({ length: 12 }, (_, i) => [i + 1, `Class ${i + 1}`] as [number, string]),
];

export default function ClassesTab({ onMessage }: { onMessage: (text: string) => void }) {
  const years = useApi<YearsResponse>('/setup/academic-years');
  const [yearId, setYearId] = useState('');
  const { data, error, loading, reload } = useApi<ClassesResponse>(`/setup/classes${yearId ? `?yearId=${yearId}` : ''}`);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const close = () => {
    setDialog(null);
    setDialogError(null);
  };
  async function run(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setDialogError(null);
    try {
      await fn();
      close();
      onMessage(message);
      reload();
    } catch (err) {
      setDialogError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <Spinner label="Loading classes…" />;
  if (error || !data) return <ErrorState message={error ?? 'Could not load the classes'} onRetry={reload} />;
  const year = data.meta.academicYear;
  const inactive = data.data.filter((c) => c.status === 'inactive').length;
  const classes = data.data.filter((c) => showInactive || c.status === 'active');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <Select label="Sections of" value={yearId || year?.id || ''} onChange={(e) => setYearId(e.target.value)} className="w-44">
            {(years.data?.data ?? []).map((y: AcademicYear) => (
              <option key={y.id} value={y.id}>
                {y.name}
                {y.isCurrent ? ' (current)' : ''}
              </option>
            ))}
          </Select>
          {inactive > 0 && (
            <label className="flex h-10 items-center gap-2 text-sm sm:h-9">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="h-4 w-4 accent-indigo-600" />
              Show {inactive} inactive
            </label>
          )}
        </div>
        <Button icon={<Plus aria-hidden />} onClick={() => setDialog({ kind: 'class' })}>
          Add class
        </Button>
      </div>

      {!year && <Notice tone="warn">Create an academic year first (Years &amp; terms); sections belong to a year.</Notice>}

      {classes.length === 0 ? (
        <Card>
          <EmptyState title="No classes yet" description="Add your classes (Nursery to Class 12) and then their sections." action={<Button onClick={() => setDialog({ kind: 'class' })}>Add class</Button>} />
        </Card>
      ) : (
        <ul className="space-y-3">
          {classes.map((c) => (
            <li key={c.id} className={cx('rounded-xl border border-line bg-surface', c.status === 'inactive' && 'opacity-70')}>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-slate-900 dark:text-white">
                    {c.name}
                    {c.code && <span className="text-13 font-normal text-slate-500">({c.code})</span>}
                    {c.status === 'inactive' && <Badge>Inactive</Badge>}
                  </p>
                  <p className="text-13 text-slate-500 dark:text-slate-400">
                    {c.numericLevel !== null ? `${LEVELS.find(([n]) => n === c.numericLevel)?.[1] ?? `Level ${c.numericLevel}`} · ` : ''}
                    {c.sections.length} section{c.sections.length === 1 ? '' : 's'} · {c.studentCount} student{c.studentCount === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {c.status === 'active' && year && (
                    <Button size="sm" variant="secondary" icon={<Plus aria-hidden />} onClick={() => setDialog({ kind: 'section', cls: c })}>
                      Section
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'toggle-class', cls: c })}>
                    {c.status === 'active' ? 'Deactivate' : 'Activate'}
                  </Button>
                  <RowActions label={c.name} onEdit={() => setDialog({ kind: 'class', cls: c })} onDelete={() => setDialog({ kind: 'delete-class', cls: c })} />
                </div>
              </div>
              {c.sections.length > 0 && (
                <ul className="grid gap-2 border-t border-line p-3 sm:grid-cols-2 sm:p-4 xl:grid-cols-3">
                  {c.sections.map((s) => {
                    const pct = s.capacity ? Math.min(100, Math.round((s.studentCount / s.capacity) * 100)) : null;
                    return (
                      <li key={s.id} className="flex items-start justify-between gap-2 rounded-lg border border-line bg-surface-muted/50 px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="font-semibold">
                            {c.name} {s.name}
                            {s.roomNumber && <span className="ml-1.5 text-xs font-normal text-slate-500">Room {s.roomNumber}</span>}
                          </p>
                          <p className="flex items-center gap-1 text-13 text-slate-500 dark:text-slate-400">
                            <Users className="h-3.5 w-3.5" aria-hidden />
                            <span className="tabular-nums">
                              {s.studentCount}
                              {s.capacity ? ` / ${s.capacity}` : ''}
                            </span>
                            {pct !== null && pct >= 100 && <Badge tone="amber">Full</Badge>}
                          </p>
                          <p className="truncate text-13 text-slate-600 dark:text-slate-300">{s.classTeacher ? `Class teacher: ${s.classTeacher.name}` : <span className="text-slate-400">No class teacher</span>}</p>
                        </div>
                        <RowActions
                          label={`${c.name} ${s.name}`}
                          onEdit={() => setDialog({ kind: 'section', cls: c, section: s })}
                          onDelete={() => setDialog({ kind: 'delete-section', cls: c, section: s })}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
              {c.sections.length === 0 && c.status === 'active' && year && (
                <p className="border-t border-line px-4 py-3 text-13 text-slate-500 dark:text-slate-400 sm:px-5">No sections in {year.name}. Students can only be admitted into a section.</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {dialog?.kind === 'class' && (
        <ClassModal
          cls={dialog.cls}
          busy={busy}
          error={dialogError}
          onClose={close}
          onSave={(body) =>
            dialog.cls
              ? run(() => apiSend('PATCH', `/setup/classes/${dialog.cls!.id}`, body), `${body.name} saved.`)
              : run(() => apiSend('POST', '/setup/classes', body), `${body.name} added. Now add its sections.`)
          }
        />
      )}
      {dialog?.kind === 'section' && (
        <SectionModal
          cls={dialog.cls}
          section={dialog.section}
          staff={data.meta.staff}
          yearName={year?.name ?? ''}
          busy={busy}
          error={dialogError}
          onClose={close}
          onSave={(body) =>
            dialog.section
              ? run(() => apiSend('PATCH', `/setup/sections/${dialog.section!.id}`, body), `${dialog.cls.name} ${body.name} saved.`)
              : run(() => apiSend('POST', '/setup/sections', { ...body, classId: dialog.cls.id, academicYearId: year?.id }), `Section ${dialog.cls.name} ${body.name.toUpperCase()} added.`)
          }
        />
      )}
      {dialog?.kind === 'delete-class' && (
        <ConfirmModal open title={`Delete ${dialog.cls.name}?`} confirmLabel="Delete class" busy={busy} error={dialogError} onClose={close} onConfirm={() => run(() => apiSend('DELETE', `/setup/classes/${dialog.cls.id}`), `${dialog.cls.name} deleted.`)}>
          <p>Only a class that was never used can be deleted (no students, fees, exams or attendance). Otherwise deactivate it.</p>
        </ConfirmModal>
      )}
      {dialog?.kind === 'toggle-class' && (
        <ConfirmModal
          open
          tone="primary"
          title={dialog.cls.status === 'active' ? `Deactivate ${dialog.cls.name}?` : `Activate ${dialog.cls.name}?`}
          confirmLabel={dialog.cls.status === 'active' ? 'Deactivate' : 'Activate'}
          busy={busy}
          error={dialogError}
          onClose={close}
          onConfirm={() => run(() => apiSend('PATCH', `/setup/classes/${dialog.cls.id}`, { status: dialog.cls.status === 'active' ? 'inactive' : 'active' }), `${dialog.cls.name} ${dialog.cls.status === 'active' ? 'deactivated' : 'activated'}.`)}
        >
          <p>{dialog.cls.status === 'active' ? 'It disappears from admission and other class lists. Its history (marks, fees, certificates) is kept.' : 'It appears in class lists again.'}</p>
        </ConfirmModal>
      )}
      {dialog?.kind === 'delete-section' && (
        <ConfirmModal
          open
          title={`Delete ${dialog.cls.name} ${dialog.section.name}?`}
          confirmLabel="Delete section"
          busy={busy}
          error={dialogError}
          onClose={close}
          onConfirm={() => run(() => apiSend('DELETE', `/setup/sections/${dialog.section.id}`), `${dialog.cls.name} ${dialog.section.name} deleted.`)}
        >
          <p>A section with students, attendance, homework or report cards cannot be deleted. Its timetable and teacher assignments are removed with it.</p>
        </ConfirmModal>
      )}
    </div>
  );
}

function ClassModal({ cls, busy, error, onClose, onSave }: { cls?: SetupClass; busy: boolean; error: string | null; onClose: () => void; onSave: (b: { name: string; code: string | null; numericLevel: number | null; displayOrder?: number }) => void }) {
  const [name, setName] = useState(cls?.name ?? '');
  const [code, setCode] = useState(cls?.code ?? '');
  const [level, setLevel] = useState(cls?.numericLevel === null || cls?.numericLevel === undefined ? '' : String(cls.numericLevel));
  const [order, setOrder] = useState(cls ? String(cls.displayOrder) : '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  function submit(e: FormEvent) {
    e.preventDefault();
    const x: Record<string, string> = {};
    if (!name.trim()) x.name = 'Enter the class name';
    if (code && !/^[A-Za-z0-9-]{1,20}$/.test(code.trim())) x.code = 'Letters, digits or -';
    if (order && !/^\d{1,3}$/.test(order)) x.displayOrder = 'A number';
    setErrors(x);
    if (Object.keys(x).length) return;
    onSave({ name: name.trim(), code: code.trim() || null, numericLevel: level === '' ? null : Number(level), ...(order && { displayOrder: Number(order) }) });
  }
  return (
    <Modal
      open
      size="sm"
      title={cls ? `Edit ${cls.name}` : 'Add class'}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="class-form" loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <form id="class-form" onSubmit={submit} noValidate className="space-y-4">
        <Input label="Class name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} placeholder="e.g. Grade 8, Class VIII, LKG" />
        <Select label="Level" value={level} onChange={(e) => setLevel(e.target.value)} hint="Used to promote students to the next class">
          <option value="">Not set</option>
          {LEVELS.map(([n, label]) => (
            <option key={n} value={n}>
              {label}
            </option>
          ))}
        </Select>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Short code" value={code} onChange={(e) => setCode(e.target.value)} error={errors.code} placeholder="e.g. VIII" />
          <Input label="Order in lists" inputMode="numeric" value={order} onChange={(e) => setOrder(e.target.value)} error={errors.displayOrder} placeholder="Auto" />
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </Modal>
  );
}

function SectionModal({
  cls,
  section,
  staff,
  yearName,
  busy,
  error,
  onClose,
  onSave,
}: {
  cls: SetupClass;
  section?: SetupSection;
  staff: StaffChoice[];
  yearName: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (b: { name: string; capacity: number | null; roomNumber: string | null; classTeacherStaffId: string | null }) => void;
}) {
  const nextLetter = String.fromCharCode(65 + cls.sections.length);
  const [name, setName] = useState(section?.name ?? (cls.sections.length < 26 ? nextLetter : ''));
  const [capacity, setCapacity] = useState(section?.capacity ? String(section.capacity) : '40');
  const [room, setRoom] = useState(section?.roomNumber ?? '');
  const [teacher, setTeacher] = useState(section?.classTeacher?.staffId ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  function submit(e: FormEvent) {
    e.preventDefault();
    const x: Record<string, string> = {};
    if (!name.trim() || name.trim().length > 20) x.name = 'Enter a section name (e.g. A)';
    const cap = capacity ? Number(capacity) : null;
    if (capacity && (!Number.isInteger(cap) || cap! < 1 || cap! > 200)) x.capacity = 'Between 1 and 200';
    else if (cap && section && cap < section.studentCount) x.capacity = `It already has ${section.studentCount} students`;
    setErrors(x);
    if (Object.keys(x).length) return;
    onSave({ name: name.trim(), capacity: cap, roomNumber: room.trim() || null, classTeacherStaffId: teacher || null });
  }
  return (
    <Modal
      open
      size="sm"
      title={section ? `Edit ${cls.name} ${section.name}` : `Add a section to ${cls.name}`}
      description={yearName ? `Academic year ${yearName}` : undefined}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="section-form" loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <form id="section-form" onSubmit={submit} noValidate className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Input label="Section" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} placeholder="A" />
          <Input label="Capacity" inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value.replace(/\D/g, ''))} error={errors.capacity} />
        </div>
        <Input label="Room" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="e.g. 204" />
        <Select label="Class teacher" value={teacher} onChange={(e) => setTeacher(e.target.value)} hint="Takes attendance and writes report-card remarks">
          <option value="">No class teacher yet</option>
          {staff.map((s) => (
            <option key={s.staffId} value={s.staffId}>
              {s.name}
              {s.designation ? ` (${s.designation})` : ''}
            </option>
          ))}
        </Select>
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </Modal>
  );
}
