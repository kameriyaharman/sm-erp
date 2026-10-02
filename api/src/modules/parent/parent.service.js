import { query } from '../../db/pool.js';

/**
 * Parent app home: one entry per child linked to this parent (primary parent or guardian).
 * Shape matches web/src/features/parent/types.ts. Timetable, homework and bus are not in
 * the backend yet, so they come back empty and the app shows its empty states.
 */
export async function getParentHome(auth) {
  const { rows: children } = await query(
    `WITH kids AS (
       SELECT sp.* FROM student_profiles sp
        WHERE sp.deleted_at IS NULL AND sp.status IN ('enrolled', 'suspended') AND sp.tenant_id = $2
          AND (sp.parent_id = $1 OR EXISTS (SELECT 1 FROM student_guardians g WHERE g.student_id = sp.id AND g.guardian_user_id = $1))
     ),
     today AS (SELECT (now() AT TIME ZONE t.timezone)::date AS d FROM tenants t WHERE t.id = $2)
     SELECT k.id, su.first_name, concat_ws(' ', su.first_name, su.last_name) AS name, c.name AS class_name, sec.name AS section_name,
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

  const { rows: [meta] } = await query(
    `SELECT concat_ws(' ', u.first_name, u.last_name) AS parent_name, t.name AS school_name
       FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1`,
    [auth.userId],
  );

  return {
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
      timetable: {},
      homework: [],
      bus: null,
    })),
  };
}
