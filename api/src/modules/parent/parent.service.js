import { query } from '../../db/pool.js';
import { emptyWeek } from '../shared/school-ops.helpers.js';
import { periodLabel } from '../timetable/timetable.service.js';
import { attachmentsFor } from '../homework/homework.repository.js';
import { attachmentUrl } from '../homework/homework.service.js';

/**
 * Parent app home: one entry per child linked to this parent (primary parent or guardian).
 * Shape matches web/src/features/parent/types.ts (timetable / homework / bus included).
 */
export async function getParentHome(auth) {
  const { rows: children } = await query(
    `WITH kids AS (
       SELECT sp.* FROM student_profiles sp
        WHERE sp.deleted_at IS NULL AND sp.status IN ('enrolled', 'suspended') AND sp.tenant_id = $2
          AND (sp.parent_id = $1 OR EXISTS (SELECT 1 FROM student_guardians g WHERE g.student_id = sp.id AND g.guardian_user_id = $1)
               OR sp.user_id = $1)   -- a student signed in to the portal: only themself
     ),
     today AS (SELECT (now() AT TIME ZONE t.timezone)::date AS d FROM tenants t WHERE t.id = $2)
     SELECT k.id, k.section_id, su.first_name, concat_ws(' ', su.first_name, su.last_name) AS name, c.name AS class_name, sec.name AS section_name,
            k.roll_number, b.phone AS branch_phone,
            concat_ws(' ', tu.first_name, tu.last_name) AS teacher_name, tu.phone AS teacher_phone,
            -- fees: open invoice balances + instalments not yet invoiced (this year)
            (COALESCE((SELECT sum(i.balance_amount) FROM fee_invoices i WHERE i.student_id = k.id AND i.status IN ('unpaid', 'partially_paid')), 0)
             + COALESCE((SELECT sum(a.net_amount) FROM student_fee_allocations a
                          WHERE a.student_id = k.id AND a.academic_year_id = k.academic_year_id AND a.is_active
                            AND NOT EXISTS (SELECT 1 FROM fee_invoice_items it WHERE it.allocation_id = a.id)), 0))::text AS total_due,
            COALESCE((SELECT sum(i.balance_amount) FROM fee_invoices i, today
                       WHERE i.student_id = k.id AND i.status IN ('unpaid', 'partially_paid') AND i.due_date < today.d), 0)::text AS overdue,
            LEAST((SELECT min(i.due_date) FROM fee_invoices i, today WHERE i.student_id = k.id AND i.status IN ('unpaid', 'partially_paid') AND i.due_date >= today.d),
                  (SELECT min(a.due_date) FROM student_fee_allocations a, today
                    WHERE a.student_id = k.id AND a.academic_year_id = k.academic_year_id AND a.is_active AND a.due_date >= today.d
                      AND NOT EXISTS (SELECT 1 FROM fee_invoice_items it WHERE it.allocation_id = a.id))) AS next_due_date,
            (SELECT min(i.due_date) FROM fee_invoices i, today WHERE i.student_id = k.id AND i.status IN ('unpaid', 'partially_paid') AND i.due_date < today.d) AS oldest_overdue,
            (SELECT d FROM today) AS today,
            att.status AS attendance_status, att.updated_at AS attendance_marked_at,
            rc.term_name, rc.is_final, rc.published_at, rc.percentage::float8 AS rc_percentage, rc.overall_grade
       FROM kids k
       JOIN users su           ON su.id = k.user_id
       JOIN branches b         ON b.id = k.branch_id
       LEFT JOIN classes c     ON c.id = k.class_id
       LEFT JOIN sections sec  ON sec.id = k.section_id
       LEFT JOIN staff_profiles sf ON sf.id = sec.class_teacher_id
       LEFT JOIN users tu      ON tu.id = sf.user_id
       LEFT JOIN LATERAL (SELECT a.status, a.updated_at FROM student_attendance a, today
                           WHERE a.student_id = k.id AND a.attendance_date = today.d) att ON true
       LEFT JOIN LATERAL (SELECT r.is_final, r.published_at, r.percentage, r.overall_grade, t.name AS term_name
                            FROM report_cards r LEFT JOIN academic_terms t ON t.id = r.term_id
                           WHERE r.student_id = k.id AND r.status = 'published'
                           ORDER BY r.published_at DESC LIMIT 1) rc ON true
      ORDER BY c.numeric_level NULLS LAST, name`,
    [auth.userId, auth.tenantId],
  );

  const sectionIds = [...new Set(children.map((c) => c.section_id).filter(Boolean))];
  const [timetables, homework, buses] = await Promise.all([
    timetablesFor(sectionIds),
    latestHomeworkFor(sectionIds),
    busesFor(children.map((c) => c.id)),
  ]);

  const { rows: [meta] } = await query(
    `SELECT concat_ws(' ', u.first_name, u.last_name) AS parent_name, t.name AS school_name
       FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1`,
    [auth.userId],
  );

  return {
    viewer: auth.role === 'student' ? 'student' : 'parent',
    parentName: meta?.parent_name ?? '',
    schoolName: meta?.school_name ?? '',
    schoolPhone: children[0]?.branch_phone ?? null,
    children: children.map((c) => ({
      child: {
        id: c.id,
        name: c.name,
        firstName: c.first_name,
        className: c.class_name ?? '',
        sectionName: c.section_name ?? '',
        rollNumber: c.roll_number,
        classTeacher: c.teacher_name ? { name: c.teacher_name, phone: c.teacher_phone } : null,
      },
      fee: { totalDue: c.total_due, overdue: c.overdue, nextDueDate: c.next_due_date, oldestOverdueDate: c.oldest_overdue },
      attendance: { date: c.today, status: c.attendance_status ?? 'not_marked', markedAt: c.attendance_marked_at },
      reportCard: c.published_at
        ? { label: c.is_final ? 'Annual' : c.term_name ?? 'Report card', publishedAt: c.published_at, percentage: c.rc_percentage, grade: c.overall_grade, isNew: false }
        : null,
      timetable: timetables.get(c.section_id) ?? emptyWeek(),
      homework: homework.get(c.section_id) ?? [],
      bus: buses.get(c.id) ?? null,
    })),
  };
}

/** Section id -> { 1: Period[], ..., 6: Period[] } (Period as in types.ts; subject = display label). */
async function timetablesFor(sectionIds) {
  const out = new Map();
  if (sectionIds.length === 0) return out;
  const { rows } = await query(
    `SELECT tp.id, tp.section_id, tp.weekday, to_char(tp.start_time, 'HH24:MI') AS start, to_char(tp.end_time, 'HH24:MI') AS "end",
            tp.kind, tp.label, tp.room, sub.name AS subject_name, NULLIF(concat_ws(' ', u.first_name, u.last_name), '') AS teacher_name
       FROM timetable_periods tp
       LEFT JOIN subjects sub      ON sub.id = tp.subject_id
       LEFT JOIN staff_profiles sf ON sf.id = tp.teacher_staff_id
       LEFT JOIN users u           ON u.id = sf.user_id
      WHERE tp.section_id = ANY ($1)
      ORDER BY tp.weekday, tp.start_time, tp.period_no`,
    [sectionIds],
  );
  for (const p of rows) {
    if (!out.has(p.section_id)) out.set(p.section_id, emptyWeek());
    out.get(p.section_id)[p.weekday].push({
      id: p.id,
      start: p.start,
      end: p.end,
      kind: p.kind,
      subject: periodLabel(p),
      ...(p.teacher_name && { teacher: p.teacher_name }),
      ...(p.room && { room: p.room }),
    });
  }
  return out;
}

/** Section id -> latest 5 homework items (HomeworkItem). */
async function latestHomeworkFor(sectionIds) {
  const out = new Map();
  if (sectionIds.length === 0) return out;
  const { rows } = await query(
    `SELECT x.* FROM unnest($1::uuid[]) AS sec(id)
       CROSS JOIN LATERAL (
         SELECT h.id, h.section_id, h.title, h.details, h.assigned_at, h.due_date, sub.name AS subject_name,
                concat_ws(' ', u.first_name, u.last_name) AS teacher_name
           FROM homework h
           LEFT JOIN subjects sub ON sub.id = h.subject_id
           LEFT JOIN users u      ON u.id = h.created_by
          WHERE h.section_id = sec.id AND h.deleted_at IS NULL
          ORDER BY h.assigned_at DESC
          LIMIT 5) x
      ORDER BY x.assigned_at DESC`,
    [sectionIds],
  );
  const files = await attachmentsFor(null, rows.map((h) => h.id));
  for (const h of rows) {
    if (!out.has(h.section_id)) out.set(h.section_id, []);
    out.get(h.section_id).push({
      id: h.id,
      subject: h.subject_name ?? 'General',
      title: h.title,
      ...(h.details && { details: h.details }),
      teacher: h.teacher_name || '',
      assignedAt: h.assigned_at,
      dueDate: h.due_date,
      attachments: (files.get(h.id) ?? []).map((a) => ({
        name: a.file_name,
        url: attachmentUrl(a.id),
        sizeKb: Math.max(1, Math.round(a.size_bytes / 1024)),
      })),
    });
  }
  return out;
}

/** Student id -> bus card. No live tracking yet, so the state is always "not_running". */
async function busesFor(studentIds) {
  const out = new Map();
  if (studentIds.length === 0) return out;
  const { rows } = await query(
    `SELECT x.student_id, r.name AS route_name, st.name AS stop_name, to_char(st.pickup_time, 'HH24:MI') AS pickup_time,
            to_char(st.drop_time, 'HH24:MI') AS drop_time, r.driver_name, r.driver_phone, r.vehicle_number
       FROM student_transport x
       JOIN transport_routes r ON r.id = x.route_id AND r.deleted_at IS NULL
       JOIN transport_stops st ON st.id = x.stop_id
      WHERE x.student_id = ANY ($1)`,
    [studentIds],
  );
  const now = new Date().toISOString();
  for (const b of rows) {
    out.set(b.student_id, {
      routeName: b.route_name,
      stopName: b.stop_name,
      state: 'not_running',
      etaMinutes: null,
      updatedAt: now,
      pickupTime: b.pickup_time,
      dropTime: b.drop_time,
      driverName: b.driver_name,
      driverPhone: b.driver_phone,
      vehicleNumber: b.vehicle_number,
    });
  }
  return out;
}
