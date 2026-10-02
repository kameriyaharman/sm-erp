import { query } from '../../db/pool.js';

const ROUTE_SELECT = `
  SELECT r.id, r.tenant_id, r.branch_id, r.name, r.vehicle_number, r.driver_name, r.driver_phone, r.attendant_name,
         r.capacity, r.status,
         (SELECT count(*)::int FROM student_transport x WHERE x.route_id = r.id) AS student_count
    FROM transport_routes r`;

export async function listRoutes(scope) {
  const { rows } = await query(
    `${ROUTE_SELECT}
      WHERE r.deleted_at IS NULL AND ($1::uuid IS NULL OR r.tenant_id = $1) AND ($2::uuid[] IS NULL OR r.branch_id = ANY ($2))
      ORDER BY r.name`,
    [scope.tenantId, scope.branchIds],
  );
  return rows;
}

export async function getRoute(db, id, { forUpdate = false } = {}) {
  const { rows } = await db.query(`${ROUTE_SELECT} WHERE r.id = $1 AND r.deleted_at IS NULL ${forUpdate ? 'FOR UPDATE OF r' : ''}`, [id]);
  return rows[0] ?? null;
}

export async function stopsOf(db, routeIds) {
  const { rows } = await db.query(
    `SELECT st.id, st.route_id, st.name, st.sequence_no, to_char(st.pickup_time, 'HH24:MI') AS pickup_time,
            to_char(st.drop_time, 'HH24:MI') AS drop_time,
            (SELECT count(*)::int FROM student_transport x WHERE x.stop_id = st.id) AS student_count
       FROM transport_stops st
      WHERE st.route_id = ANY ($1)
      ORDER BY st.route_id, st.sequence_no`,
    [routeIds],
  );
  return rows;
}

export async function insertRoute(db, r) {
  const { rows } = await db.query(
    `INSERT INTO transport_routes (tenant_id, branch_id, name, vehicle_number, driver_name, driver_phone, attendant_name, capacity)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [r.tenantId, r.branchId, r.name, r.vehicleNumber, r.driverName, r.driverPhone, r.attendantName ?? null, r.capacity ?? null],
  );
  return rows[0].id;
}

export async function updateRoute(db, id, patch) {
  const map = { name: 'name', vehicleNumber: 'vehicle_number', driverName: 'driver_name', driverPhone: 'driver_phone',
    attendantName: 'attendant_name', capacity: 'capacity', status: 'status' };
  const entries = Object.entries(patch).filter(([k, v]) => map[k] && v !== undefined);
  if (!entries.length) return;
  const sets = entries.map(([k], i) => `${map[k]} = $${i + 2}${k === 'status' ? '::record_status' : ''}`);
  await db.query(`UPDATE transport_routes SET ${sets.join(', ')} WHERE id = $1`, [id, ...entries.map(([, v]) => v)]);
}

export async function insertStops(db, route, stops) {
  if (!stops.length) return;
  await db.query(
    `INSERT INTO transport_stops (tenant_id, branch_id, route_id, name, sequence_no, pickup_time, drop_time)
     SELECT $1, $2, $3, x.name, x.seq, x.pickup, x.drop_time
       FROM unnest($4::text[], $5::smallint[], $6::time[], $7::time[]) AS x(name, seq, pickup, drop_time)`,
    [route.tenantId, route.branchId, route.id, stops.map((s) => s.name), stops.map((s) => s.sequenceNo),
      stops.map((s) => s.pickupTime), stops.map((s) => s.dropTime)],
  );
}

export async function updateStop(db, id, s) {
  await db.query(`UPDATE transport_stops SET name = $2, sequence_no = $3, pickup_time = $4, drop_time = $5 WHERE id = $1`,
    [id, s.name, s.sequenceNo, s.pickupTime, s.dropTime]);
}

export async function deleteStops(db, ids) {
  if (ids.length) await db.query(`DELETE FROM transport_stops WHERE id = ANY ($1)`, [ids]);
}

export async function routeStudents(db, routeId) {
  const { rows } = await db.query(
    `SELECT sp.id AS student_id, concat_ws(' ', u.first_name, u.last_name) AS name, sp.admission_number,
            NULLIF(concat_ws(' ', c.name, s.name), '') AS class_label, st.id AS stop_id, st.name AS stop_name
       FROM student_transport x
       JOIN student_profiles sp ON sp.id = x.student_id AND sp.deleted_at IS NULL
       JOIN users u             ON u.id = sp.user_id
       JOIN transport_stops st  ON st.id = x.stop_id
       LEFT JOIN classes c      ON c.id = sp.class_id
       LEFT JOIN sections s     ON s.id = sp.section_id
      WHERE x.route_id = $1
      ORDER BY st.sequence_no, name`,
    [routeId],
  );
  return rows;
}

export async function getStudentForTransport(db, studentId) {
  const { rows } = await db.query(
    `SELECT sp.id, sp.tenant_id, sp.branch_id, x.route_id AS current_route_id
       FROM student_profiles sp
       LEFT JOIN student_transport x ON x.student_id = sp.id
      WHERE sp.id = $1 AND sp.deleted_at IS NULL
      FOR UPDATE OF sp`,
    [studentId],
  );
  return rows[0] ?? null;
}

export async function upsertAssignment(db, a) {
  await db.query(
    `INSERT INTO student_transport (student_id, tenant_id, branch_id, route_id, stop_id, assigned_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (student_id) DO UPDATE SET route_id = EXCLUDED.route_id, stop_id = EXCLUDED.stop_id, assigned_by = EXCLUDED.assigned_by`,
    [a.studentId, a.tenantId, a.branchId, a.routeId, a.stopId, a.assignedBy],
  );
}

export async function removeAssignment(db, studentId) {
  await db.query(`DELETE FROM student_transport WHERE student_id = $1`, [studentId]);
}

/** Route + stop of a student (parent app / parent home). */
export async function studentRoute(db, studentId) {
  const { rows } = await db.query(
    `SELECT r.id AS route_id, r.name AS route_name, r.vehicle_number, r.driver_name, r.driver_phone, r.attendant_name,
            st.id AS stop_id, st.name AS stop_name, to_char(st.pickup_time, 'HH24:MI') AS pickup_time,
            to_char(st.drop_time, 'HH24:MI') AS drop_time, x.updated_at
       FROM student_transport x
       JOIN transport_routes r ON r.id = x.route_id AND r.deleted_at IS NULL
       JOIN transport_stops st ON st.id = x.stop_id
      WHERE x.student_id = $1`,
    [studentId],
  );
  return rows[0] ?? null;
}
