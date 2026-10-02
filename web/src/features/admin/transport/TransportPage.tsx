'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, Bus, Pencil, Plus, Trash2, UserPlus, Users } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, Notice, Page, PageHeader, Spinner, Table, Td, Th } from '@/components/ui';
import { useApi } from '@/lib/useApi';
import { apiSend } from '@/lib/session';
import { formatTime } from '@/lib/format';
import { ConfirmModal, PhoneLink, ProgressBar, StudentPicker, errorText, fieldErrors, useFlash } from '../shared';
import AssignModal from './AssignModal';
import type { RouteRider, StudentRow, TransportRoute, Wrapped } from '../types';

export default function TransportPage() {
  const { data, error, loading, reload } = useApi<Wrapped<TransportRoute[]>>('/transport/routes');
  const flash = useFlash();
  const [editing, setEditing] = useState<TransportRoute | 'new' | null>(null);
  const [riders, setRiders] = useState<TransportRoute | null>(null);
  const routes = data?.data ?? [];
  const totalRiders = routes.reduce((s, r) => s + r.studentCount, 0);

  return (
    <Page wide>
      <PageHeader
        title="Transport"
        description={data ? `${routes.length} route${routes.length === 1 ? '' : 's'}, ${totalRiders} students on the bus` : 'Bus routes, stops and riders'}
        actions={
          <Button icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setEditing('new')}>
            Add route
          </Button>
        }
      />
      {flash.node}
      {loading && !data ? (
        <Spinner label="Loading routes…" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : routes.length === 0 ? (
        <Card>
          <EmptyState icon={<Bus className="h-7 w-7" aria-hidden />} title="No bus routes yet" description="Add a route with its stops, then assign students to it." action={<Button onClick={() => setEditing('new')}>Add route</Button>} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {routes.map((r) => (
            <RouteCard key={r.id} route={r} onEdit={() => setEditing(r)} onRiders={() => setRiders(r)} />
          ))}
        </div>
      )}

      <RouteModal
        route={editing === 'new' ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={(msg) => {
          setEditing(null);
          flash.show('success', msg);
          reload();
        }}
      />
      {riders && (
        <RidersModal
          route={riders}
          onClose={() => setRiders(null)}
          onChanged={(msg) => {
            flash.show('success', msg);
            reload();
          }}
        />
      )}
    </Page>
  );
}

function RouteCard({ route: r, onEdit, onRiders }: { route: TransportRoute; onEdit: () => void; onRiders: () => void }) {
  const full = r.capacity ? r.studentCount >= r.capacity : false;
  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">
            {r.name}
            {r.status !== 'active' && <Badge>Inactive</Badge>}
          </h2>
          <p className="mt-0.5 text-sm tabular-nums text-slate-500 dark:text-slate-400">{r.vehicleNumber}</p>
        </div>
        <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" aria-hidden />} onClick={onEdit} aria-label={`Edit ${r.name}`}>
          Edit
        </Button>
      </header>
      <div className="grid grid-cols-1 gap-4 px-5 py-4 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Driver</p>
          <p className="font-medium">{r.driverName}</p>
          <PhoneLink phone={r.driverPhone} className="text-sm" />
          {r.attendantName && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Attendant: {r.attendantName}</p>}
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Seats used</p>
          <p className="font-medium tabular-nums">
            {r.studentCount}
            {r.capacity ? ` of ${r.capacity}` : ' riders'}
            {full && (
              <span className="ml-2">
                <Badge tone="red">Full</Badge>
              </span>
            )}
          </p>
          {r.capacity ? <ProgressBar value={r.studentCount} max={r.capacity} tone={full ? 'red' : r.studentCount / r.capacity > 0.85 ? 'amber' : 'indigo'} label="Seats used" /> : null}
        </div>
      </div>
      <ol className="relative mx-5 mb-4 border-l-2 border-slate-200 dark:border-slate-700" aria-label="Stops">
        {r.stops.map((s) => (
          <li key={s.id} className="relative mb-3 ml-4 last:mb-0">
            <span className="absolute -left-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-indigo-500 dark:border-slate-900" aria-hidden />
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="text-sm font-medium">
                {s.sequenceNo}. {s.name}
              </p>
              <p className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                Pickup {formatTime(s.pickupTime) || '-'} · Drop {formatTime(s.dropTime) || '-'}
                <span className="ml-2 inline-flex items-center gap-0.5">
                  <Users className="h-3 w-3" aria-hidden />
                  {s.studentCount}
                </span>
              </p>
            </div>
          </li>
        ))}
      </ol>
      <footer className="mt-auto border-t border-slate-100 px-5 py-3 dark:border-slate-800">
        <Button size="sm" variant="secondary" icon={<Users className="h-3.5 w-3.5" aria-hidden />} onClick={onRiders}>
          Students ({r.studentCount})
        </Button>
      </footer>
    </section>
  );
}

interface StopDraft {
  key: string;
  name: string;
  pickupTime: string;
  dropTime: string;
}
const newKey = () => Math.random().toString(36).slice(2);

function RouteModal({ route, open, onClose, onSaved }: { route: TransportRoute | null; open: boolean; onClose: () => void; onSaved: (msg: string) => void }) {
  const [form, setForm] = useState({ name: '', vehicleNumber: '', driverName: '', driverPhone: '', attendantName: '', capacity: '', active: true });
  const [stops, setStops] = useState<StopDraft[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setError(null);
    setForm({
      name: route?.name ?? '',
      vehicleNumber: route?.vehicleNumber ?? '',
      driverName: route?.driverName ?? '',
      driverPhone: route?.driverPhone ?? '',
      attendantName: route?.attendantName ?? '',
      capacity: route?.capacity ? String(route.capacity) : '40',
      active: route ? route.status === 'active' : true,
    });
    setStops(route ? route.stops.map((s) => ({ key: s.id, name: s.name, pickupTime: s.pickupTime?.slice(0, 5) ?? '', dropTime: s.dropTime?.slice(0, 5) ?? '' })) : [{ key: newKey(), name: '', pickupTime: '07:00', dropTime: '14:30' }]);
  }, [open, route]);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setStop = (i: number, patch: Partial<StopDraft>) => setStops((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) =>
    setStops((prev) => {
      const next = [...prev];
      const [x] = next.splice(i, 1);
      next.splice(i + d, 0, x);
      return next;
    });
  const addStop = () => {
    const last = stops.at(-1);
    setStops((prev) => [...prev, { key: newKey(), name: '', pickupTime: last?.pickupTime ?? '07:00', dropTime: last?.dropTime ?? '14:30' }]);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (form.name.trim().length < 2) local.name = 'Name the route';
    if (form.vehicleNumber.trim().length < 4) local.vehicleNumber = 'Enter the vehicle number';
    if (form.driverName.trim().length < 2) local.driverName = "Enter the driver's name";
    if (form.driverPhone.replace(/\D/g, '').length < 10) local.driverPhone = 'Enter a 10-digit mobile';
    const cap = form.capacity.trim() ? Number(form.capacity) : null;
    if (cap !== null && (!Number.isInteger(cap) || cap < 1 || cap > 200)) local.capacity = '1 to 200 seats';
    if (stops.length === 0) local.stops = 'Add at least one stop';
    const names = new Set<string>();
    stops.forEach((s, i) => {
      if (s.name.trim().length < 2) local[`stop${i}`] = 'Name the stop';
      else if (names.has(s.name.trim().toLowerCase())) local[`stop${i}`] = 'Stop listed twice';
      names.add(s.name.trim().toLowerCase());
      if (!s.pickupTime || !s.dropTime) local[`stop${i}`] = local[`stop${i}`] ?? 'Enter pickup and drop times';
    });
    if (route && cap !== null && cap < route.studentCount) local.capacity = `${route.studentCount} students already ride this bus`;
    setErrors(local);
    if (Object.keys(local).length) return;

    const body = {
      name: form.name.trim(),
      vehicleNumber: form.vehicleNumber.trim(),
      driverName: form.driverName.trim(),
      driverPhone: form.driverPhone.trim(),
      attendantName: form.attendantName.trim() || (route ? null : undefined),
      capacity: cap,
      stops: stops.map((s) => ({ name: s.name.trim(), pickupTime: s.pickupTime, dropTime: s.dropTime })),
      ...(route ? { status: form.active ? 'active' : 'inactive' } : {}),
    };
    setBusy(true);
    setError(null);
    try {
      if (route) await apiSend('PATCH', `/transport/routes/${route.id}`, body);
      else await apiSend('POST', '/transport/routes', body);
      onSaved(route ? `${body.name} updated.` : `${body.name} added with ${body.stops.length} stop${body.stops.length === 1 ? '' : 's'}.`);
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={route ? `Edit ${route.name}` : 'Add bus route'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="route-form" loading={busy}>
            {route ? 'Save route' : 'Add route'}
          </Button>
        </>
      }
    >
      <form id="route-form" onSubmit={submit} noValidate className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Route name" value={form.name} onChange={set('name')} error={errors.name} placeholder="e.g. Route 3 - Dwarka Sector 6" required />
          <Input label="Vehicle number" value={form.vehicleNumber} onChange={set('vehicleNumber')} error={errors.vehicleNumber} placeholder="DL 1P C 4521" required />
          <Input label="Driver name" value={form.driverName} onChange={set('driverName')} error={errors.driverName} required />
          <Input label="Driver mobile" type="tel" value={form.driverPhone} onChange={set('driverPhone')} error={errors.driverPhone} required />
          <Input label="Attendant" value={form.attendantName} onChange={set('attendantName')} error={errors.attendantName} placeholder="Optional" />
          <Input label="Seats" inputMode="numeric" value={form.capacity} onChange={set('capacity')} error={errors.capacity} />
        </div>
        {route && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} className="h-4 w-4 rounded border-slate-300" />
            Route is running (untick to stop new assignments)
          </label>
        )}
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">Stops, in order</legend>
          {route && <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">Stops are matched by name. A stop with students on it can be renamed only after moving them.</p>}
          <ol className="space-y-2">
            {stops.map((s, i) => (
              <li key={s.key} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <div className="flex flex-wrap items-end gap-2">
                  <span className="mb-2 w-6 text-sm font-semibold tabular-nums text-slate-500">{i + 1}.</span>
                  <Input label="Stop name" value={s.name} onChange={(e) => setStop(i, { name: e.target.value })} className="min-w-[12rem] flex-1" aria-invalid={!!errors[`stop${i}`]} />
                  <Input label="Pickup" type="time" value={s.pickupTime} onChange={(e) => setStop(i, { pickupTime: e.target.value })} className="w-32" />
                  <Input label="Drop" type="time" value={s.dropTime} onChange={(e) => setStop(i, { dropTime: e.target.value })} className="w-32" />
                  <div className="mb-0.5 flex gap-1">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move stop up" className="rounded-md p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800">
                      <ArrowUp className="h-4 w-4" aria-hidden />
                    </button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === stops.length - 1} aria-label="Move stop down" className="rounded-md p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800">
                      <ArrowDown className="h-4 w-4" aria-hidden />
                    </button>
                    <button type="button" onClick={() => setStops((prev) => prev.filter((_, j) => j !== i))} disabled={stops.length === 1} aria-label="Remove stop" className="rounded-md p-2 text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 dark:hover:bg-red-500/10">
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                </div>
                {errors[`stop${i}`] && <p className="ml-8 mt-1 text-xs text-red-600 dark:text-red-400">{errors[`stop${i}`]}</p>}
              </li>
            ))}
          </ol>
          {errors.stops && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.stops}</p>}
          <Button variant="secondary" size="sm" className="mt-2" icon={<Plus className="h-3.5 w-3.5" aria-hidden />} onClick={addStop}>
            Add stop
          </Button>
        </fieldset>
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </Modal>
  );
}

function RidersModal({ route, onClose, onChanged }: { route: TransportRoute; onClose: () => void; onChanged: (msg: string) => void }) {
  const { data, error, loading, reload } = useApi<Wrapped<RouteRider[]>>(`/transport/routes/${route.id}/students`);
  const [assign, setAssign] = useState<{ id: string; name: string; routeId: string | null; stopName: string | null } | null>(null);
  const [picking, setPicking] = useState(false);
  const [removing, setRemoving] = useState<RouteRider | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const riders = data?.data ?? [];

  async function remove() {
    if (!removing) return;
    setBusy(true);
    setRemoveError(null);
    try {
      await apiSend('PUT', '/transport/assignments', { studentId: removing.studentId, routeId: null });
      const msg = `${removing.name} removed from ${route.name}.`;
      setNotice(msg);
      onChanged(msg);
      setRemoving(null);
      reload();
    } catch (err) {
      setRemoveError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Modal open={!assign && !removing && !picking} onClose={onClose} title={`${route.name} · students`} size="lg">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {riders.length} rider{riders.length === 1 ? '' : 's'}
            {route.capacity ? ` of ${route.capacity} seats` : ''}
          </p>
          <Button size="sm" icon={<UserPlus className="h-3.5 w-3.5" aria-hidden />} onClick={() => setPicking(true)} disabled={route.status !== 'active'}>
            Add student
          </Button>
        </div>
        {notice && (
          <div className="mb-3">
            <Notice tone="success">{notice}</Notice>
          </div>
        )}
        {loading && !data ? (
          <Spinner />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : riders.length === 0 ? (
          <EmptyState title="Nobody on this route yet" description="Add students and choose their stop." />
        ) : (
          <Table className="-mx-5">
            <thead>
              <tr>
                <Th>Student</Th>
                <Th>Class</Th>
                <Th>Stop</Th>
                <Th align="right">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {riders.map((s) => (
                <tr key={s.studentId}>
                  <Td>
                    <Link href={`/students/${s.studentId}`} className="whitespace-nowrap font-medium hover:underline">
                      {s.name}
                    </Link>
                    <p className="text-xs tabular-nums text-slate-500">{s.admissionNumber}</p>
                  </Td>
                  <Td className="whitespace-nowrap">{s.classLabel ?? '-'}</Td>
                  <Td className="whitespace-nowrap">{s.stop?.name ?? '-'}</Td>
                  <Td align="right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="secondary" onClick={() => setAssign({ id: s.studentId, name: s.name, routeId: route.id, stopName: s.stop?.name ?? null })}>
                        Change
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setRemoveError(null);
                          setRemoving(s);
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Modal>
      <Modal open={picking} onClose={() => setPicking(false)} title={`Add a student to ${route.name}`}>
        <StudentPicker
          onPick={(s: StudentRow) => {
            setPicking(false);
            setAssign({ id: s.id, name: s.name, routeId: route.id, stopName: null });
          }}
        />
      </Modal>
      <AssignModal
        student={assign ? { id: assign.id, name: assign.name } : null}
        open={!!assign}
        currentRouteId={assign?.routeId}
        currentStopName={assign?.stopName}
        onClose={() => setAssign(null)}
        onSaved={(msg) => {
          setAssign(null);
          setNotice(msg);
          onChanged(msg);
          reload();
        }}
      />
      <ConfirmModal open={!!removing} title="Remove from route?" confirmLabel="Remove" busy={busy} error={removeError} onConfirm={remove} onClose={() => setRemoving(null)}>
        <p>
          {removing?.name} will no longer travel on {route.name}.
        </p>
      </ConfirmModal>
    </>
  );
}
