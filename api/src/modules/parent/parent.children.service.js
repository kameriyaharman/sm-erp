import { pool } from '../../db/pool.js';
import { resolveGateway } from '../payments/gateway.js';
import { fromPaise } from '../../utils/money.js';
import { getUnbilledAllocations, resolveAcademicYear } from '../fees/fees.repository.js';
import { studentFeeTotals, attendanceCounts } from '../students/students.repository.js';
import { pageOfHomework } from '../homework/homework.service.js';
import { sectionTimetable } from '../timetable/timetable.service.js';
import { studentRoute } from '../transport/transport.repository.js';
import { loadChildForParent } from '../shared/access.js';
import { attendanceStats, emptyWeek, monthRange } from '../shared/school-ops.helpers.js';

/**
 * Parent app, one child at a time. Every function first resolves the child through
 * loadChildForParent, so another family's student id is a 404.
 */

export async function childFees(auth, studentId) {
  const child = await loadChildForParent(pool, auth, studentId);
  const year = await resolveAcademicYear(pool, { branchId: child.branch_id });

  const [totals, invoices, upcoming, receipts, gateway] = await Promise.all([
    studentFeeTotals(pool, child.id),
    pool.query(
      `SELECT i.id, i.invoice_number, i.period_label, i.issue_date, i.due_date, i.net_amount::text AS net_amount,
              i.paid_amount::text AS paid_amount, i.balance_amount::text AS balance_amount, i.status,
              (i.status IN ('unpaid', 'partially_paid') AND i.due_date < CURRENT_DATE) AS overdue,
              COALESCE((SELECT json_agg(json_build_object('feeHead', fh.name, 'description', it.description, 'amount', it.net_amount::text)
                                        ORDER BY fh.display_order, fh.name, it.created_at)
                          FROM fee_invoice_items it JOIN fee_heads fh ON fh.id = it.fee_head_id
                         WHERE it.invoice_id = i.id), '[]'::json) AS items
         FROM fee_invoices i
        WHERE i.student_id = $1 AND i.status <> 'cancelled'
        ORDER BY i.due_date DESC, i.issue_date DESC, i.invoice_number DESC`,
      [child.id],
    ).then((r) => r.rows),
    year ? getUnbilledAllocations(pool, { studentId: child.id, academicYearId: year.id }) : [],
    pool.query(
      `SELECT id, receipt_number, received_at, amount::text AS amount, payment_mode, status, cancelled_at, cancel_reason
         FROM fee_receipts WHERE student_id = $1 ORDER BY received_at DESC`,
      [child.id],
    ).then((r) => r.rows),
    resolveGateway(pool, { tenantId: child.tenant_id, branchId: child.branch_id }),
  ]);

  return {
    child: { id: child.id, name: child.name, className: child.class_name ?? '', sectionName: child.section_name ?? '' },
    totals,
    invoices: invoices.map((i) => ({
      id: i.id,
      invoiceNumber: i.invoice_number,
      periodLabel: i.period_label,
      issueDate: i.issue_date,
      dueDate: i.due_date,
      netAmount: i.net_amount,
      paidAmount: i.paid_amount,
      balanceAmount: i.balance_amount,
      status: i.status,
      overdue: i.overdue,
      items: i.items,
    })),
    // id = the allocation, for "Pay in advance" (POST .../fees/advance-bill).
    upcoming: upcoming.map((a) => ({ id: a.id, feeHead: a.fee_head, installmentNo: a.installment_no, dueDate: a.due_date, netAmount: a.net_amount })),
    receipts: receipts.map((r) => ({
      id: r.id, receiptNumber: r.receipt_number, receivedAt: r.received_at, amount: r.amount, paymentMode: r.payment_mode,
      status: r.status, cancelledAt: r.cancelled_at, cancelReason: r.cancel_reason,
    })),
    // The school's own Razorpay account (Settings -> Online payments). mode 'test' = no real money.
    onlinePayment: gateway.enabled
      ? { enabled: true, mode: gateway.mode, keyId: gateway.keyId, allowPartial: gateway.allowPartial, minAmount: fromPaise(gateway.minAmountPaise) }
      : { enabled: false, mode: null, keyId: null, allowPartial: false, minAmount: null },
  };
}

export async function childAttendance(auth, studentId, { month }) {
  const child = await loadChildForParent(pool, auth, studentId);
  const { rows: [meta] } = await pool.query(
    `SELECT to_char((now() AT TIME ZONE t.timezone)::date, 'YYYY-MM') AS this_month,
            COALESCE($2::uuid, (SELECT id FROM academic_years WHERE branch_id = $3 AND is_current)) AS year_id
       FROM tenants t WHERE t.id = $1`,
    [child.tenant_id, child.academic_year_id, child.branch_id],
  );
  const m = month ?? meta.this_month;
  const { from, to } = monthRange(m);
  const [days, monthCounts, yearCounts] = await Promise.all([
    pool.query(
      `SELECT attendance_date AS date, status FROM student_attendance
        WHERE student_id = $1 AND attendance_date BETWEEN $2 AND $3 ORDER BY attendance_date`,
      [child.id, from, to],
    ).then((r) => r.rows),
    attendanceCounts(pool, child.id, null, { from, to }),
    meta.year_id ? attendanceCounts(pool, child.id, meta.year_id) : {},
  ]);
  return { month: m, days, summary: attendanceStats(monthCounts), year: attendanceStats(yearCounts) };
}

export async function childHomework(auth, studentId, { page, limit }) {
  const child = await loadChildForParent(pool, auth, studentId);
  if (!child.section_id) return { data: [], meta: { page, limit, total: 0, totalPages: 0 } };
  return pageOfHomework({ scope: { tenantId: child.tenant_id, branchIds: [child.branch_id] }, sectionId: child.section_id, page, limit });
}

export async function childTimetable(auth, studentId) {
  const child = await loadChildForParent(pool, auth, studentId);
  if (!child.section_id) return { section: null, days: emptyWeek() };
  return sectionTimetable({ id: child.section_id, class_name: child.class_name, name: child.section_name });
}

export async function childTransport(auth, studentId) {
  const child = await loadChildForParent(pool, auth, studentId);
  const r = await studentRoute(pool, child.id);
  if (!r) return null;
  const { rows: stops } = await pool.query(
    `SELECT id, name, to_char(pickup_time, 'HH24:MI') AS pickup_time, to_char(drop_time, 'HH24:MI') AS drop_time
       FROM transport_stops WHERE route_id = $1 ORDER BY sequence_no`,
    [r.route_id],
  );
  return {
    route: { name: r.route_name, vehicleNumber: r.vehicle_number, driverName: r.driver_name, driverPhone: r.driver_phone, attendantName: r.attendant_name },
    stop: { name: r.stop_name, pickupTime: r.pickup_time, dropTime: r.drop_time },
    stops: stops.map((s) => ({ name: s.name, pickupTime: s.pickup_time, dropTime: s.drop_time, isMine: s.id === r.stop_id })),
  };
}
