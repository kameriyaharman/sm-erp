'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button, Modal, Notice, Select, Spinner } from '@/components/ui';
import { useApi } from '@/lib/useApi';
import { apiSend } from '@/lib/session';
import { formatTime } from '@/lib/format';
import { errorText } from '../shared';
import type { TransportRoute, Wrapped } from '../types';

/** Put a student on a route + stop (PUT /transport/assignments). */
export default function AssignModal({
  student,
  open,
  currentRouteId,
  currentStopName,
  onClose,
  onSaved,
}: {
  student: { id: string; name: string } | null;
  open: boolean;
  currentRouteId?: string | null;
  currentStopName?: string | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const routes = useApi<Wrapped<TransportRoute[]>>(open ? '/transport/routes' : null);
  const [routeId, setRouteId] = useState('');
  const [stopId, setStopId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = useMemo(() => routes.data?.data ?? [], [routes.data]);
  const route = list.find((r) => r.id === routeId);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setRouteId(currentRouteId ?? '');
    setStopId('');
  }, [open, currentRouteId]);

  // Preselect the student's current stop once routes load.
  useEffect(() => {
    if (!open || !route || stopId) return;
    const current = currentStopName ? route.stops.find((s) => s.name === currentStopName) : undefined;
    setStopId(current?.id ?? route.stops[0]?.id ?? '');
  }, [open, route, stopId, currentStopName]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!student || !routeId) {
      setError('Choose a route');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiSend('PUT', '/transport/assignments', { studentId: student.id, routeId, stopId: stopId || undefined });
      const stop = route?.stops.find((s) => s.id === stopId);
      onSaved(`${student.name} now travels on ${route?.name ?? 'the route'}${stop ? `, ${stop.name} stop` : ''}.`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={`School bus${student ? ` · ${student.name}` : ''}`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="assign-form" loading={busy} disabled={!routeId}>
            Save
          </Button>
        </>
      }
    >
      {routes.loading ? (
        <Spinner label="Loading routes…" />
      ) : routes.error ? (
        <Notice tone="error">{routes.error}</Notice>
      ) : list.length === 0 ? (
        <Notice tone="info">No bus routes are set up yet. Add one under Transport first.</Notice>
      ) : (
        <form id="assign-form" onSubmit={submit} className="space-y-4">
          <Select
            label="Route"
            value={routeId}
            onChange={(e) => {
              setRouteId(e.target.value);
              setStopId('');
            }}
            required
          >
            <option value="">Choose a route…</option>
            {list.map((r) => (
              <option key={r.id} value={r.id} disabled={r.status !== 'active'}>
                {r.name} · {r.studentCount}
                {r.capacity ? `/${r.capacity}` : ''} riders{r.status !== 'active' ? ' (inactive)' : ''}
              </option>
            ))}
          </Select>
          <Select label="Stop" value={stopId} onChange={(e) => setStopId(e.target.value)} disabled={!route}>
            {!route && <option value="">Choose a route first</option>}
            {route?.stops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.sequenceNo}. {s.name}
                {s.pickupTime ? ` · pickup ${formatTime(s.pickupTime)}` : ''}
              </option>
            ))}
          </Select>
          {error && <Notice tone="error">{error}</Notice>}
        </form>
      )}
    </Modal>
  );
}
