import { pool, withTransaction } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { logger } from '../../utils/logger.js';
import { assertStaffAccess, conflict, resolveWriteBranch, staffScope, unprocessable } from '../shared/access.js';
import * as repo from './transport.repository.js';

function mapRoute(r, stops) {
  return {
    id: r.id,
    name: r.name,
    vehicleNumber: r.vehicle_number,
    driverName: r.driver_name,
    driverPhone: r.driver_phone,
    attendantName: r.attendant_name,
    capacity: r.capacity,
    studentCount: r.student_count,
    status: r.status,
    stops: stops
      .filter((s) => s.route_id === r.id)
      .map((s) => ({ id: s.id, name: s.name, sequenceNo: s.sequence_no, pickupTime: s.pickup_time, dropTime: s.drop_time, studentCount: s.student_count })),
  };
}

async function routeWithStops(db, id) {
  const route = await repo.getRoute(db, id);
  return mapRoute(route, await repo.stopsOf(db, [id]));
}

async function loadRoute(db, auth, id, opts) {
  const route = await repo.getRoute(db, id, opts);
  assertStaffAccess(auth, route, 'Route not found', 'ROUTE_NOT_FOUND');
  return route;
}

export async function listRoutes(auth, { branchId }) {
  const routes = await repo.listRoutes(await staffScope(auth, { branchId }));
  const stops = routes.length ? await repo.stopsOf(pool, routes.map((r) => r.id)) : [];
  return routes.map((r) => mapRoute(r, stops));
}

export async function createRoute(auth, input) {
  const { tenantId, branchId } = await resolveWriteBranch(auth, input.branchId);
  const id = await withTransaction(async (db) => {
    const routeId = await repo.insertRoute(db, { ...input, tenantId, branchId });
    await repo.insertStops(db, { id: routeId, tenantId, branchId }, input.stops.map((s, i) => ({ ...s, sequenceNo: i + 1 })));
    return routeId;
  });
  logger.info('Transport route created', { routeId: id, stops: input.stops.length, by: auth.userId });
  return routeWithStops(pool, id);
}

/**
 * Updates route details. `stops` replaces the list in the given order: stops are matched to
 * existing ones by name (kept, so assigned students stay on them); an existing stop left
 * out is removed only if no student is assigned to it (409 otherwise).
 */
export async function updateRoute(auth, id, patch) {
  await withTransaction(async (db) => {
    const route = await loadRoute(db, auth, id, { forUpdate: true });
    if (patch.capacity != null && patch.capacity < route.student_count) {
      throw unprocessable('CAPACITY_TOO_LOW', `${route.student_count} students already use this route`);
    }
    await repo.updateRoute(db, id, patch);

    if (patch.stops) {
      const existing = await repo.stopsOf(db, [id]);
      const byName = new Map(existing.map((s) => [s.name.toLowerCase(), s]));
      const wanted = patch.stops.map((s, i) => ({ ...s, sequenceNo: i + 1, match: byName.get(s.name.toLowerCase()) }));
      const keep = new Set(wanted.filter((w) => w.match).map((w) => w.match.id));
      const dropped = existing.filter((s) => !keep.has(s.id));
      const inUse = dropped.filter((s) => s.student_count > 0);
      if (inUse.length) {
        throw conflict('STOP_IN_USE', `Move the students off ${inUse.map((s) => s.name).join(', ')} before removing ${inUse.length === 1 ? 'it' : 'them'}`, {
          stops: inUse.map((s) => ({ id: s.id, name: s.name, studentCount: s.student_count })),
        });
      }
      await repo.deleteStops(db, dropped.map((s) => s.id));
      for (const w of wanted.filter((x) => x.match)) await repo.updateStop(db, w.match.id, w);
      await repo.insertStops(db, { id, tenantId: route.tenant_id, branchId: route.branch_id }, wanted.filter((w) => !w.match));
    }
  });
  return routeWithStops(pool, id);
}

export async function listRouteStudents(auth, id) {
  await loadRoute(pool, auth, id);
  const rows = await repo.routeStudents(pool, id);
  return rows.map((r) => ({
    studentId: r.student_id,
    name: r.name,
    admissionNumber: r.admission_number,
    classLabel: r.class_label,
    stop: { id: r.stop_id, name: r.stop_name },
  }));
}

/** Puts a student on a route / stop (first stop when stopId is omitted), or removes them (routeId null). */
export async function assignStudent(auth, { studentId, routeId, stopId }) {
  return withTransaction(async (db) => {
    const student = await repo.getStudentForTransport(db, studentId);
    assertStaffAccess(auth, student, 'Student not found', 'STUDENT_NOT_FOUND');

    if (routeId === null) {
      if (stopId) throw AppError.badRequest('Validation failed', { body: { stopId: ['Leave stopId out when removing transport'] } }, 'VALIDATION_ERROR');
      await repo.removeAssignment(db, studentId);
      return { studentId, routeId: null, stopId: null };
    }

    const route = await repo.getRoute(db, routeId, { forUpdate: true });
    if (!route || route.branch_id !== student.branch_id) throw AppError.notFound('Route not found', 'ROUTE_NOT_FOUND');
    if (route.status !== 'active') throw unprocessable('ROUTE_INACTIVE', 'This route is not running');

    const stops = await repo.stopsOf(db, [routeId]);
    const stop = stopId ? stops.find((s) => s.id === stopId) : stops[0];
    if (!stop) throw unprocessable('STOP_NOT_ON_ROUTE', stopId ? 'That stop is not on this route' : 'This route has no stops');

    const joining = student.current_route_id !== routeId;
    if (joining && route.capacity != null && route.student_count >= route.capacity) {
      throw conflict('ROUTE_FULL', `${route.name} is full (${route.capacity} seats)`);
    }
    await repo.upsertAssignment(db, {
      studentId, tenantId: student.tenant_id, branchId: student.branch_id, routeId, stopId: stop.id, assignedBy: auth.userId,
    });
    return { studentId, routeId, stopId: stop.id };
  });
}
