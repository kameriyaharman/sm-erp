import { query } from '../../db/pool.js';

// Whitelisted ORDER BY clauses — user input selects a key, never SQL text.
const SORTS = {
  amount: 'd.total_due DESC, d.oldest_due_date ASC',
  days: 'd.oldest_due_date ASC, d.total_due DESC',
};

/**
 * Students with open invoices whose due date has passed.
 * The `dues` CTE matches the partial index `ix_invoices_outstanding_branch`
 * (status IN ('unpaid','partially_paid')), so it scans only open invoices.
 * Money columns are returned as strings to keep numeric(12,2) precision.
 */
export async function listDefaulters({ scope, filters }) {
  const { asOf, minDaysOverdue, minAmount, classId, sectionId, search, sort, page, limit } = filters;
  const like = search ? `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;

  const params = [
    scope.tenantId,       // $1
    scope.branchIds,      // $2
    asOf ?? null,         // $3
    minDaysOverdue,       // $4
    minAmount,            // $5
    classId ?? null,      // $6
    sectionId ?? null,    // $7
    limit,                // $8
    (page - 1) * limit,   // $9
    like,                 // $10
  ];

  const { rows } = await query(
    `WITH params AS (
       SELECT COALESCE($3::date, CURRENT_DATE) AS as_of
     ),
     dues AS (
       SELECT i.student_id,
              i.branch_id,
              count(*)              AS open_invoices,
              sum(i.balance_amount) AS total_due,
              min(i.due_date)       AS oldest_due_date
         FROM fee_invoices i, params p
        WHERE i.status IN ('unpaid', 'partially_paid')
          AND i.due_date < p.as_of - $4::int
          AND ($1::uuid   IS NULL OR i.tenant_id = $1)
          AND ($2::uuid[] IS NULL OR i.branch_id = ANY ($2))
        GROUP BY i.student_id, i.branch_id
       HAVING sum(i.balance_amount) > 0
          AND sum(i.balance_amount) >= $5::numeric
     )
     SELECT d.student_id,
            d.branch_id,
            sp.admission_number,
            sp.roll_number,
            concat_ws(' ', u.first_name, u.last_name)  AS student_name,
            c.id    AS class_id,
            c.name  AS class_name,
            s.id    AS section_id,
            s.name  AS section_name,
            concat_ws(' ', pu.first_name, pu.last_name) AS parent_name,
            pu.phone AS parent_phone,
            pu.email AS parent_email,
            d.open_invoices::int                       AS open_invoices,
            d.total_due::text                          AS total_due,
            d.oldest_due_date,
            (p.as_of - d.oldest_due_date)              AS days_overdue,
            count(*) OVER ()                           AS total_count,
            (sum(d.total_due) OVER ())::text           AS grand_total
       FROM dues d
       CROSS JOIN params p
       JOIN student_profiles sp ON sp.id = d.student_id
       JOIN users u             ON u.id  = sp.user_id
       LEFT JOIN classes c      ON c.id  = sp.class_id
       LEFT JOIN sections s     ON s.id  = sp.section_id
       LEFT JOIN users pu       ON pu.id = sp.parent_id
      WHERE ($6::uuid IS NULL OR sp.class_id = $6)
        AND ($7::uuid IS NULL OR sp.section_id = $7)
        AND ($10::text IS NULL
             OR concat_ws(' ', u.first_name, u.last_name) ILIKE $10 OR sp.admission_number ILIKE $10
             OR concat_ws(' ', pu.first_name, pu.last_name) ILIKE $10 OR pu.phone ILIKE $10)
      ORDER BY ${SORTS[sort]}
      LIMIT $8 OFFSET $9`,
    params,
  );

  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
  const grandTotal = rows.length > 0 ? rows[0].grand_total : '0.00';
  const asOfDate = asOf ?? new Date().toISOString().slice(0, 10);

  return {
    data: rows.map((row) => ({
      studentId: row.student_id,
      branchId: row.branch_id,
      admissionNumber: row.admission_number,
      rollNumber: row.roll_number,
      studentName: row.student_name,
      class: row.class_id ? { id: row.class_id, name: row.class_name } : null,
      section: row.section_id ? { id: row.section_id, name: row.section_name } : null,
      parent: row.parent_name ? { name: row.parent_name, phone: row.parent_phone, email: row.parent_email } : null,
      openInvoices: row.open_invoices,
      totalDue: row.total_due,
      oldestDueDate: row.oldest_due_date,
      daysOverdue: row.days_overdue,
    })),
    meta: {
      asOf: asOfDate,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      totalOutstanding: grandTotal,
    },
  };
}
