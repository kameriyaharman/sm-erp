#!/usr/bin/env node
/**
 * Demo school for trying the ERP: one school, two classes, ~27 students, fees with
 * payments and dues, and attendance history. Logins (all with DEMO_PASSWORD):
 *
 *   School code: demo
 *   owner@demo.school     super admin (whole school group)
 *   admin@demo.school     branch admin  -> dashboard, fee collection
 *   teacher@demo.school   class teacher of Grade 5 A -> attendance
 *   parent@demo.school    parent of two children -> parent app
 *
 * Runs only when SEED_DEMO=true, and only once (skips if tenant "demo" exists).
 * Uses the real services for invoices and payments, so numbering, ledgers and
 * receipts are exactly what the app itself would create.
 */
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { env } from '../src/config/env.js';
import { pool, withTransaction } from '../src/db/pool.js';
import { logger } from '../src/utils/logger.js';
import { collectPayment, createInvoice } from '../src/modules/fees/fees.service.js';

if (process.env.SEED_DEMO !== 'true') {
  logger.info('Demo seed skipped (SEED_DEMO is not "true")');
  process.exit(0);
}
const password = process.env.DEMO_PASSWORD ?? '';
if (password.length < 10) {
  logger.error('DEMO_PASSWORD must be set (at least 10 characters) to create demo logins');
  process.exit(1);
}

const existing = await pool.query(`SELECT id FROM tenants WHERE code = 'demo'`);
if (existing.rowCount > 0) {
  logger.info('Demo school already exists; nothing to do');
  await pool.end();
  process.exit(0);
}

const hash = await bcrypt.hash(password, 12);
const unusable = await bcrypt.hash(randomUUID(), 12); // other parents/students can't log in
const id = () => randomUUID();
const T = id();
const B = id();
const Y = id();
const C5 = id();
const C6 = id();
const S5 = id();
const S6 = id();
const OWNER = id();
const ADMIN = id();
const TEACHER = id();
const TEACHER2 = id();
const PARENT = id();
const STAFF1 = id();
const STAFF2 = id();

const FIRST = [
  'Aarav',
  'Vivaan',
  'Aditya',
  'Ananya',
  'Diya',
  'Ishaan',
  'Kavya',
  'Reyansh',
  'Saanvi',
  'Arjun',
  'Myra',
  'Kabir',
  'Anika',
  'Vihaan',
  'Aadhya',
  'Rohan',
  'Ira',
  'Krish',
  'Tara',
  'Dev',
  'Nisha',
  'Yash',
  'Meher',
  'Atharv',
  'Riya',
  'Shaurya',
  'Pari',
];
const LAST = [
  'Sharma',
  'Verma',
  'Gupta',
  'Iyer',
  'Nair',
  'Reddy',
  'Kapoor',
  'Malhotra',
  'Joshi',
  'Mehta',
  'Chatterjee',
  'Singh',
  'Bhatia',
  'Rao',
  'Khan',
];
const PARENT_FIRST = [
  'Rakesh',
  'Sunita',
  'Vijay',
  'Meera',
  'Amit',
  'Pooja',
  'Sanjay',
  'Kavita',
  'Rahul',
  'Neha',
  'Deepak',
  'Anjali',
  'Manoj',
  'Ritu',
  'Arvind',
];

await withTransaction(async (db) => {
  const q = (text, params) => db.query(text, params);

  await q(`INSERT INTO tenants (id, name, code, contact_email) VALUES ($1, 'Demo Public School', 'demo', 'office@demo.school')`, [T]);
  await q(
    `INSERT INTO branches (id, tenant_id, name, code, affiliation_no, school_code, udise_code, address_line1, city, state, postal_code, phone, email, is_head_office, settings)
     VALUES ($1, $2, 'Main Campus', 'MAIN', '2730999', '27999', '07090999999', 'Sector 10, Dwarka', 'New Delhi', 'Delhi', '110075', '011-40000000',
             'office@demo.school', true, $3)`,
    [B, T, JSON.stringify({ documents: { principalName: 'Dr. Meenakshi Rao', website: 'demo.school' } })],
  );

  const users = [
    [OWNER, null, 'super_admin', 'owner@demo.school', 'Suresh', 'Malhotra', '9810011111'],
    [ADMIN, B, 'branch_admin', 'admin@demo.school', 'Anita', 'Verma', '9810022222'],
    [TEACHER, B, 'teacher', 'teacher@demo.school', 'Priya', 'Nair', '9810033333'],
    [TEACHER2, B, 'teacher', 'teacher2@demo.school', 'Rajesh', 'Kumar', '9810044444'],
    [PARENT, null, 'parent', 'parent@demo.school', 'Rakesh', 'Sharma', '9810055555'],
  ];
  for (const [uid, branch, role, email, first, last, phone] of users) {
    await q(
      `INSERT INTO users (id, tenant_id, branch_id, role, email, password_hash, first_name, last_name, phone) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [uid, T, branch, role, email, uid === TEACHER2 ? unusable : hash, first, last, phone],
    );
  }
  await q(
    `INSERT INTO staff_profiles (id, user_id, tenant_id, branch_id, employee_code, date_of_joining, designation, department)
           VALUES ($1, $2, $3, $4, 'EMP-101', '2021-06-01', 'TGT', 'Primary'), ($5, $6, $3, $4, 'EMP-102', '2019-04-01', 'TGT', 'Middle')`,
    [STAFF1, TEACHER, T, B, STAFF2, TEACHER2],
  );

  await q(
    `INSERT INTO academic_years (id, tenant_id, branch_id, name, start_date, end_date, is_current) VALUES ($1, $2, $3, '2026-27', '2026-04-01', '2027-03-31', true)`,
    [Y, T, B],
  );
  await q(
    `INSERT INTO academic_terms (tenant_id, branch_id, academic_year_id, name, sequence_no, start_date, end_date)
           VALUES ($1, $2, $3, 'Term 1', 1, '2026-04-01', '2026-09-30'), ($1, $2, $3, 'Term 2', 2, '2026-10-01', '2027-03-31')`,
    [T, B, Y],
  );
  await q(
    `INSERT INTO classes (id, tenant_id, branch_id, name, numeric_level, display_order) VALUES ($1, $2, $3, 'Grade 5', 5, 5), ($4, $2, $3, 'Grade 6', 6, 6)`,
    [C5, T, B, C6],
  );
  await q(`INSERT INTO classes (tenant_id, branch_id, name, numeric_level, display_order) VALUES ($1, $2, 'Grade 7', 7, 7)`, [T, B]);
  await q(
    `INSERT INTO sections (id, tenant_id, branch_id, academic_year_id, class_id, name, capacity, class_teacher_id)
           VALUES ($1, $2, $3, $4, $5, 'A', 40, $6), ($7, $2, $3, $4, $8, 'A', 40, $9)`,
    [S5, T, B, Y, C5, STAFF1, S6, C6, STAFF2],
  );

  // Students: 15 in 5 A, 12 in 6 A. The demo parent has one child in each.
  for (let i = 0; i < 27; i += 1) {
    const inFive = i < 15;
    const userId = id();
    const studentId = id();
    const last = LAST[i % LAST.length];
    const isDemoChild = i === 0 || i === 15;
    let parentId = PARENT;
    if (!isDemoChild) {
      parentId = id();
      await q(`INSERT INTO users (id, tenant_id, role, phone, password_hash, first_name, last_name) VALUES ($1, $2, 'parent', $3, $4, $5, $6)`, [
        parentId,
        T,
        `98${String(20000000 + i * 7919).padStart(8, '0')}`,
        unusable,
        PARENT_FIRST[i % PARENT_FIRST.length],
        last,
      ]);
    }
    const lastName = isDemoChild ? 'Sharma' : last;
    await q(
      `INSERT INTO users (id, tenant_id, branch_id, role, username, password_hash, first_name, last_name) VALUES ($1, $2, $3, 'student', $4, $5, $6, $7)`,
      [userId, T, B, `stu${String(i + 1).padStart(3, '0')}`, unusable, FIRST[i], lastName],
    );
    await q(
      `INSERT INTO student_profiles (id, tenant_id, branch_id, user_id, admission_number, admission_date, roll_number, academic_year_id, class_id, section_id,
                                     parent_id, date_of_birth, gender, nationality, father_name, mother_name, social_category, admission_class_id)
       VALUES ($1, $2, $3, $4, $5, '2022-04-01', $6, $7, $8, $9, $10, $11, $12, 'Indian', $13, $14, $15, $8)`,
      [
        studentId,
        T,
        B,
        userId,
        `DPS-${String(1001 + i)}`,
        String(inFive ? i + 1 : i - 14),
        Y,
        inFive ? C5 : C6,
        inFive ? S5 : S6,
        parentId,
        `${inFive ? 2015 : 2014}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`,
        ['Ananya', 'Diya', 'Kavya', 'Saanvi', 'Myra', 'Anika', 'Aadhya', 'Ira', 'Tara', 'Nisha', 'Meher', 'Riya', 'Pari'].includes(FIRST[i])
          ? 'female'
          : 'male',
        `Mr. ${isDemoChild ? 'Rakesh' : PARENT_FIRST[i % PARENT_FIRST.length]} ${lastName}`,
        `Mrs. ${['Sunita', 'Meera', 'Pooja', 'Kavita', 'Neha'][i % 5]} ${lastName}`,
        ['General', 'General', 'OBC', 'General', 'SC', 'General', 'EWS'][i % 7],
      ],
    );
  }

  // Fees: quarterly tuition + transport, due 10 Apr / Jul / Oct / Jan.
  const TUI = id();
  const TRN = id();
  await q(
    `INSERT INTO fee_heads (id, tenant_id, branch_id, name, code, display_order) VALUES ($1, $3, $4, 'Tuition', 'TUI', 1), ($2, $3, $4, 'Transport', 'TRN', 2)`,
    [TUI, TRN, T, B],
  );
  for (const [cls, tuition] of [
    [C5, 15000],
    [C6, 16500],
  ]) {
    await q(
      `INSERT INTO fee_structures (tenant_id, branch_id, academic_year_id, class_id, fee_head_id, frequency, installment_no, installment_label, amount, due_date)
       SELECT $1, $2, $3, $4, h.id, 'quarterly', n, 'Q' || n, h.amt, (date '2026-04-10' + (n - 1) * interval '3 months')::date
         FROM (VALUES ($5::uuid, $6::numeric), ($7::uuid, 4500::numeric)) h(id, amt), generate_series(1, 4) n`,
      [T, B, Y, cls, TUI, tuition, TRN],
    );
  }
  await q(
    `INSERT INTO student_fee_allocations (tenant_id, branch_id, student_id, academic_year_id, fee_head_id, fee_structure_id, installment_no, due_date,
                                          base_amount, concession_type, concession_value, concession_amount, concession_reason)
     SELECT $1, $2, sp.id, $3, fs.fee_head_id, fs.id, fs.installment_no, fs.due_date, fs.amount,
            CASE WHEN sib THEN 'percentage' ELSE 'none' END::concession_type, CASE WHEN sib THEN 10 ELSE 0 END,
            CASE WHEN sib THEN fs.amount * 0.10 ELSE 0 END, CASE WHEN sib THEN 'Sibling concession' END
       FROM student_profiles sp
       JOIN fee_structures fs ON fs.class_id = sp.class_id AND fs.academic_year_id = $3
       CROSS JOIN LATERAL (SELECT sp.parent_id = $4 AND fs.fee_head_id = $5 AS sib) x
      WHERE sp.tenant_id = $1`,
    [T, B, Y, PARENT, TUI],
  );

  // Attendance history: Mon–Sat from 1 Jul until yesterday.
  await q(
    `INSERT INTO student_attendance (tenant_id, branch_id, academic_year_id, section_id, student_id, attendance_date, status, marked_by)
     SELECT $1, $2, $3, sp.section_id, sp.id, d::date,
            (CASE WHEN h < 90 THEN 'present' WHEN h < 93 THEN 'late' WHEN h < 98 THEN 'absent' ELSE 'leave' END)::attendance_status, $4
       FROM student_profiles sp
       CROSS JOIN generate_series('2026-07-01'::date, CURRENT_DATE - 1, '1 day') d
       CROSS JOIN LATERAL (SELECT abs(hashtext(sp.id::text || d::text)) % 100 AS h) x
      WHERE sp.tenant_id = $1 AND extract(dow FROM d) <> 0`,
    [T, B, Y, TEACHER],
  );
  await q(
    `INSERT INTO attendance_submissions (tenant_id, branch_id, section_id, academic_year_id, attendance_date, total_students, present_count, absent_count, other_count, submitted_by, submitted_at)
     SELECT $1, $2, a.section_id, $3, a.attendance_date, count(*), count(*) FILTER (WHERE status = 'present'), count(*) FILTER (WHERE status = 'absent'),
            count(*) FILTER (WHERE status NOT IN ('present', 'absent')), $4, a.attendance_date + time '09:10'
       FROM student_attendance a WHERE a.tenant_id = $1 GROUP BY a.section_id, a.attendance_date`,
    [T, B, Y, TEACHER],
  );
});

// Invoices (Q1 + Q2) and payments through the real services. These run in their own
// transactions, so on any failure the half-built demo school is removed again: a rerun starts clean.
let studentCount = 0;
let receipts = 0;
try {
  const auth = Object.freeze({ userId: ADMIN, role: 'branch_admin', tenantId: T, branchId: B });
  const students = (await pool.query(`SELECT id, admission_number FROM student_profiles WHERE tenant_id = $1 ORDER BY admission_number`, [T])).rows;
  studentCount = students.length;
  for (const [i, s] of students.entries()) {
    await createInvoice(auth, { studentId: s.id, billUpTo: '2026-04-30', periodLabel: 'Q1 (Apr-Jun)', items: [] });
    await createInvoice(auth, { studentId: s.id, billUpTo: '2026-07-31', periodLabel: 'Q2 (Jul-Sep)', items: [] });
    const dues = (await pool.query(`SELECT id, balance_amount::float8 AS bal FROM fee_invoices WHERE student_id = $1 ORDER BY due_date`, [s.id]))
      .rows;
    // Most families paid Q1; about half paid Q2; a few paid part; some owe both quarters.
    const pattern = i % 7;
    const pay = async (invoice, rupees, mode, when) => {
      const { receipt } = await collectPayment(
        auth,
        {
          studentId: s.id,
          amount: Math.round(rupees * 100),
          paymentMode: mode,
          invoiceIds: [invoice.id],
          ...(mode === 'upi' && { instrumentNumber: `UPI${600000000 + i * 31 + receipts}` }),
        },
        `demo-seed-${s.id}-${invoice.id}-${rupees}`,
      );
      await pool.query(`UPDATE fee_receipts SET received_at = $2 WHERE id = $1`, [receipt.id, when]);
      await pool.query(`UPDATE fee_transactions SET completed_at = $2 WHERE receipt_id = $1`, [receipt.id, when]);
      receipts += 1;
    };
    if (pattern !== 6) await pay(dues[0], dues[0].bal, i % 2 ? 'upi' : 'cash', `2026-04-${String(3 + (i % 12)).padStart(2, '0')}T10:30:00+05:30`);
    if (pattern <= 2) await pay(dues[1], dues[1].bal, i % 3 ? 'upi' : 'cash', `2026-07-${String(2 + (i % 14)).padStart(2, '0')}T11:00:00+05:30`);
    if (pattern === 3) await pay(dues[1], 10000, 'upi', `2026-08-${String(5 + (i % 10)).padStart(2, '0')}T12:15:00+05:30`);
  }
} catch (err) {
  logger.error('Demo seed failed; removing the partial demo school', { error: err.message });
  await pool.query(`DELETE FROM tenants WHERE id = $1`, [T]).catch((e) => logger.error('Cleanup failed', { error: e.message }));
  await pool.end();
  process.exit(1);
}

logger.info('Demo school created', {
  tenantCode: 'demo',
  students: studentCount,
  receipts,
  logins: ['owner@demo.school', 'admin@demo.school', 'teacher@demo.school', 'parent@demo.school'],
});
await pool.end();
void env; // env is imported for its validation side effect
