'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Card, EmptyState, ErrorState, Input, Notice, Page, Select, Spinner, Table, Td, Th, cx } from '@/components/ui';
import { useApi } from '@/lib/useApi';
import { apiSend, currentUser } from '@/lib/session';
import { hasModule, useEntitlements } from '@/lib/entitlements';
import { formatDate } from '@/lib/format';
import { ConfirmModal, errorText, useFlash } from '@/features/admin/shared';
import { BranchPicker, SaveBar, SettingsHeader, SwitchRow, to12h } from './bits';
import type { AttendancePolicy, CalendarValue, SectionData } from './types';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Settings -> Attendance & holidays. Whole-school values, with optional per-branch overrides
 * (campuses with different timings or holidays).
 */
export default function AttendanceSettingsPage() {
  const me = currentUser();
  const entitlements = useEntitlements();
  const [branchId, setBranchId] = useState<string | null | undefined>(undefined);
  const q = branchId ? `?branchId=${branchId}` : '';
  const policy = useApi<{ data: SectionData<AttendancePolicy> }>(branchId === undefined ? null : `/settings/sections/attendance${q}`);
  const calendar = useApi<{ data: SectionData<CalendarValue> }>(branchId === undefined ? null : `/settings/sections/calendar${q}`);
  const flash = useFlash();

  // First load decides the starting level: owner = whole school, branch admin = own branch.
  const probe = useApi<{ data: SectionData<AttendancePolicy> }>(branchId === undefined ? '/settings/sections/attendance' : null);
  useEffect(() => {
    if (branchId !== undefined || !probe.data) return;
    setBranchId(probe.data.data.canEditSchool ? null : probe.data.data.branchId ?? me?.branchId ?? null);
  }, [probe.data, branchId, me?.branchId]);

  const p = policy.data?.data;
  const c = calendar.data?.data;
  const [pv, setPv] = useState<AttendancePolicy | null>(null);
  const [cv, setCv] = useState<CalendarValue | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => setPv(p ? structuredClone(p.value) : null), [p]);
  useEffect(() => setCv(c ? structuredClone(c.value) : null), [c]);

  const dirty = Boolean(p && c && pv && cv && (JSON.stringify(pv) !== JSON.stringify(p.value) || JSON.stringify(cv) !== JSON.stringify(c.value)));
  const deviceModule = hasModule(entitlements, 'device_attendance');
  const branches = p?.branches ?? probe.data?.data.branches ?? [];
  const canEditSchool = p?.canEditSchool ?? probe.data?.data.canEditSchool ?? false;
  const branchOverride = Boolean(branchId && (p?.own || c?.own));

  async function save() {
    if (!p || !c || !pv || !cv) return;
    setBusy(true);
    try {
      if (JSON.stringify(pv) !== JSON.stringify(p.value)) await apiSend('PUT', '/settings/sections/attendance', { branchId, value: pv, version: p.version });
      if (JSON.stringify(cv) !== JSON.stringify(c.value)) await apiSend('PUT', '/settings/sections/calendar', { branchId, value: cv, version: c.version });
      await Promise.all([policy.reload(), calendar.reload()]);
      flash.show('success', 'Saved. Registers, devices and alerts use the new settings within a minute.');
    } catch (err) {
      flash.show('error', errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function resetBranch() {
    setBusy(true);
    try {
      await Promise.all([apiSend('DELETE', `/settings/sections/attendance${q}`), apiSend('DELETE', `/settings/sections/calendar${q}`)]);
      setConfirmReset(false);
      await Promise.all([policy.reload(), calendar.reload()]);
      flash.show('success', 'This branch now follows the whole-school settings.');
    } catch (err) {
      flash.show('error', errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const error = policy.error ?? calendar.error ?? probe.error;
  const setDevice = (patch: Partial<AttendancePolicy['device']>) => setPv((v) => (v ? { ...v, device: { ...v.device, ...patch } } : v));

  return (
    <Page>
      <SettingsHeader title="Attendance & holidays" description="Who may change a register and how far back, the school calendar, and timings for gate devices." />
      {flash.node}
      {error ? (
        <Card>
          <ErrorState message={error} onRetry={() => (policy.reload(), calendar.reload())} />
        </Card>
      ) : !pv || !cv || !p ? (
        <Spinner label="Loading" />
      ) : (
        <>
          <BranchPicker branches={branches} value={branchId ?? null} onChange={setBranchId} allowSchool={canEditSchool} />
          {branchId && (
            <div className="mb-5">
              <Notice>
                {branchOverride ? 'This branch has its own settings.' : 'This branch follows the whole-school settings. Changing anything here gives it its own.'}
                {branchOverride && canEditSchool && (
                  <button type="button" className="ml-2 font-medium underline" onClick={() => setConfirmReset(true)}>
                    Follow whole school again
                  </button>
                )}
              </Notice>
            </div>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Registers" description="Applies to the class teacher's daily register.">
              <div className="flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Select
                    label="Teachers can change"
                    value={pv.backdateDays.teacher}
                    disabled={!p.canEdit}
                    onChange={(e) => setPv({ ...pv, backdateDays: { ...pv.backdateDays, teacher: Number(e.target.value) } })}
                  >
                    <option value={0}>Today only</option>
                    {[1, 2, 3, 5, 7].map((n) => (
                      <option key={n} value={n}>
                        Today and {n} day{n === 1 ? '' : 's'} back
                      </option>
                    ))}
                  </Select>
                  <Input
                    label="Office can change (days back)"
                    type="number"
                    min={0}
                    max={90}
                    value={pv.backdateDays.branch_admin}
                    disabled={!p.canEdit}
                    onChange={(e) => setPv({ ...pv, backdateDays: { ...pv.backdateDays, branch_admin: Math.max(0, Math.min(90, Number(e.target.value) || 0)) } })}
                  />
                </div>
                <SwitchRow
                  title="No register on holidays"
                  text="Teachers can't mark attendance on a holiday or weekly off. The office still can (e.g. a working Saturday)."
                  checked={pv.blockTeachersOnHolidays}
                  disabled={!p.canEdit}
                  onChange={(v) => setPv({ ...pv, blockTeachersOnHolidays: v })}
                />
                <Input
                  label="Minimum attendance (%)"
                  type="number"
                  min={0}
                  max={100}
                  value={pv.minPercentage}
                  disabled={!p.canEdit}
                  onChange={(e) => setPv({ ...pv, minPercentage: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                  hint="Students below this are highlighted in attendance history."
                />
              </div>
            </Card>

            <Card title="Weekly offs and holidays" description="No absence alerts, device cut-off or teacher registers on these days.">
              <div className="flex flex-col gap-4">
                <div>
                  <p className="mb-1.5 text-13 font-medium text-slate-700 dark:text-slate-300">Weekly off</p>
                  <div className="flex flex-wrap gap-1.5">
                    {DAYS.map((day, i) => {
                      const on = cv.weeklyOffs.includes(i);
                      return (
                        <button
                          key={day}
                          type="button"
                          aria-pressed={on}
                          disabled={!p.canEdit}
                          onClick={() => setCv({ ...cv, weeklyOffs: on ? cv.weeklyOffs.filter((x) => x !== i) : [...cv.weeklyOffs, i].sort() })}
                          className={cx(
                            'h-9 w-12 rounded-lg border text-13 font-medium transition-colors disabled:opacity-60',
                            on ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-line-strong bg-surface text-slate-700 hover:border-slate-400 dark:text-slate-200',
                          )}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <Holidays value={cv.holidays} disabled={!p.canEdit} onChange={(holidays) => setCv({ ...cv, holidays })} />
              </div>
            </Card>

            {deviceModule && (
              <Card
                title="Gate devices"
                description={
                  <>
                    RFID, biometric, face and QR attendance.{' '}
                    <Link href="/settings/devices" className="font-medium text-indigo-700 hover:underline dark:text-indigo-300">
                      Manage devices
                    </Link>
                  </>
                }
                className="lg:col-span-2"
              >
                <div className="grid gap-4 sm:grid-cols-3">
                  <Input label="Punches count from" type="time" value={pv.device.checkInFrom} disabled={!p.canEdit} onChange={(e) => setDevice({ checkInFrom: e.target.value })} hint="Earlier punches are ignored." />
                  <Input label="Late after" type="time" value={pv.device.lateAfter} disabled={!p.canEdit} onChange={(e) => setDevice({ lateAfter: e.target.value })} hint={`Arriving after ${to12h(pv.device.lateAfter)} = late.`} />
                  <Input label="Cut-off" type="time" value={pv.device.cutoff} disabled={!p.canEdit} onChange={(e) => setDevice({ cutoff: e.target.value })} hint="Later punches don't count as arrival." />
                  <Input label="Staff late after" type="time" value={pv.device.staffLateAfter} disabled={!p.canEdit} onChange={(e) => setDevice({ staffLateAfter: e.target.value })} />
                  <Input
                    label="Staff check-out after (minutes)"
                    type="number"
                    min={1}
                    max={240}
                    value={pv.device.minGapMinutes}
                    disabled={!p.canEdit}
                    onChange={(e) => setDevice({ minGapMinutes: Math.max(1, Math.min(240, Number(e.target.value) || 1)) })}
                    hint="A second punch sooner than this is ignored."
                  />
                </div>
                <div className="mt-4">
                  <SwitchRow
                    title="Mark absent at the cut-off"
                    text={`At ${to12h(pv.device.cutoff)}, in classes where the devices are in use and the register isn't taken yet, students without a punch are marked absent and parents get the absence message.`}
                    checked={pv.device.autoAbsentAtCutoff}
                    disabled={!p.canEdit}
                    onChange={(v) => setDevice({ autoAbsentAtCutoff: v })}
                  />
                </div>
              </Card>
            )}
          </div>

          <SaveBar dirty={dirty} busy={busy} onSave={save} onReset={() => (setPv(structuredClone(p.value)), setCv(structuredClone(c!.value)))} />
          <ConfirmModal open={confirmReset} title="Follow the whole-school settings?" confirmLabel="Remove branch settings" busy={busy} onConfirm={resetBranch} onClose={() => setConfirmReset(false)}>
            <p>This branch&apos;s own attendance settings and holiday list are removed; the whole-school ones apply.</p>
          </ConfirmModal>
        </>
      )}
    </Page>
  );
}

function Holidays({ value, onChange, disabled }: { value: CalendarValue['holidays']; onChange: (v: CalendarValue['holidays']) => void; disabled: boolean }) {
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const sorted = useMemo(() => [...value].sort((a, b) => a.date.localeCompare(b.date)), [value]);
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = sorted.filter((h) => h.date >= today);
  const past = sorted.length - upcoming.length;
  const taken = value.some((h) => h.date === date);

  return (
    <div>
      <p className="mb-1.5 text-13 font-medium text-slate-700 dark:text-slate-300">Holidays</p>
      {!disabled && (
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Diwali" maxLength={80} className="min-w-[10rem] flex-1" />
          <Button
            variant="secondary"
            icon={<Plus aria-hidden />}
            disabled={!date || !name.trim() || taken}
            onClick={() => {
              onChange([...value, { date, name: name.trim() }]);
              setDate('');
              setName('');
            }}
          >
            Add
          </Button>
        </div>
      )}
      {taken && <p className="-mt-2 mb-2 text-xs text-amber-700">That date is already in the list.</p>}
      {sorted.length === 0 ? (
        <EmptyState title="No holidays yet" description="Add the school holidays for the year." />
      ) : (
        <div className="rounded-lg border border-line">
          <Table className="max-h-72">
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Holiday</Th>
                <Th align="right">
                  <span className="sr-only">Remove</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((h) => (
                <tr key={h.date}>
                  <Td className="whitespace-nowrap tabular-nums">{formatDate(h.date)}</Td>
                  <Td>{h.name}</Td>
                  <Td align="right">
                    {!disabled && (
                      <Button size="sm" variant="ghost" aria-label={`Remove ${h.name}`} icon={<Trash2 aria-hidden />} onClick={() => onChange(value.filter((x) => x.date !== h.date))} />
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {past > 0 && <p className="border-t border-line px-4 py-2 text-xs text-slate-500">{past} past holiday{past === 1 ? '' : 's'} hidden.</p>}
        </div>
      )}
    </div>
  );
}

