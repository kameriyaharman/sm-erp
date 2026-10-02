#!/usr/bin/env node
/**
 * School-operations demo data for the demo school created by seed-demo.js:
 * subjects, Term-1 exams with marks (CBSE classes VI–VIII scheme), a scheduled Term-2
 * test, Mon–Sat timetables, homework, notices, two bus routes, expenses and two more
 * teachers; then published Term-1 report cards and two bonafide certificates, made by
 * the real document services.
 *
 * Runs only when SEED_DEMO=true and tenant "demo" exists. Idempotent:
 *   phase 1 (one transaction)  skipped when the demo branch already has subjects
 *   phase 2 (report cards)     skipped when the demo school has a published report card
 *   phase 3 (bonafides)        skipped when the demo school has a bonafide certificate
 *   phase 4 (subject teachers) skipped when the demo school has any teacher_subject_assignments:
 *     three more teacher logins (DEMO_PASSWORD): maths@, science@, hindi@demo.school;
 *     one teacher per subject per section (teacher@ = English in 5 A and 6 A, still class
 *     teacher of 5 A); timetable teachers follow the assignments (no double booking); the
 *     phase-1 homework is re-attributed to its subject teacher; two homework items get a PDF.
 * Set-based INSERT ... SELECT throughout: the live database is far away.
 */
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { env } from '../src/config/env.js';
import { pool, withTransaction } from '../src/db/pool.js';
import { logger } from '../src/utils/logger.js';
import PDFDocument from 'pdfkit';
import { generateReportCards, issueBonafide, publishReportCards } from '../src/modules/documents/documents.service.js';
import { nextSequenceCode } from '../src/modules/shared/school-ops.helpers.js';
import { teacherClashes } from '../src/modules/shared/teacher-scope.helpers.js';

if (process.env.SEED_DEMO !== 'true') {
  logger.info('Demo extras skipped (SEED_DEMO is not "true")');
  process.exit(0);
}


// =====================================================================
// Demo school lookup
// =====================================================================

async function loadDemo() {
  const { rows: [t] } = await pool.query(`SELECT id FROM tenants WHERE code = 'demo'`);
  if (!t) return null;
  const { rows: [ctx] } = await pool.query(
    `SELECT b.id AS branch_id, ay.id AS year_id, ay.start_date AS year_start, ay.end_date AS year_end,
            (now() AT TIME ZONE tn.timezone)::date AS today,
            (SELECT id FROM academic_terms WHERE academic_year_id = ay.id AND sequence_no = 1) AS term1,
            (SELECT id FROM academic_terms WHERE academic_year_id = ay.id AND sequence_no = 2) AS term2,
            (SELECT id FROM users WHERE tenant_id = tn.id AND email = 'admin@demo.school') AS admin_id,
            (SELECT id FROM users WHERE tenant_id = tn.id AND email = 'parent@demo.school') AS parent_id
       FROM tenants tn
       JOIN branches b ON b.tenant_id = tn.id AND b.deleted_at IS NULL
       JOIN academic_years ay ON ay.branch_id = b.id AND ay.is_current
      WHERE tn.id = $1
      ORDER BY b.is_head_office DESC
      LIMIT 1`,
    [t.id],
  );
  if (!ctx?.term1 || !ctx.admin_id) throw new Error('Demo school is incomplete (no current year, Term 1 or admin)');
  const { rows: sections } = await pool.query(
    `SELECT s.id, s.name, s.class_id, c.name AS class_name, c.numeric_level, s.class_teacher_id
       FROM sections s JOIN classes c ON c.id = s.class_id
      WHERE s.branch_id = $1 AND s.academic_year_id = $2 AND s.deleted_at IS NULL
      ORDER BY c.numeric_level, s.name`,
    [ctx.branch_id, ctx.year_id],
  );
  const { rows: staff } = await pool.query(
    `SELECT sf.id, sf.user_id, u.email FROM staff_profiles sf JOIN users u ON u.id = sf.user_id
      WHERE sf.branch_id = $1 ORDER BY sf.employee_code`,
    [ctx.branch_id],
  );
  return { tenantId: t.id, ...ctx, sections, staff };
}

// =====================================================================
// Phase 1: masters + operational data (one transaction)
// =====================================================================

const SUBJECTS = [
  // code, name, type, graded-only, order
  ['ENG', 'English', 'theory', false, 1],
  ['HIN', 'Hindi', 'theory', false, 2],
  ['MAT', 'Mathematics', 'theory', false, 3],
  ['SCI', 'Science', 'theory', false, 4],
  ['SST', 'Social Science', 'theory', false, 5],
  ['ART', 'Art Education', 'activity', true, 10],
  ['PHE', 'Health & Physical Education', 'activity', true, 11],
  ['DISC', 'Discipline', 'activity', true, 12],
];
const CORE = ['MAT', 'ENG', 'SCI', 'HIN', 'SST'];

async function phaseOne(demo) {
  const { rows: existing } = await pool.query(`SELECT 1 FROM subjects WHERE branch_id = $1 LIMIT 1`, [demo.branch_id]);
  if (existing.length) return null;

  const T = demo.tenantId;
  const B = demo.branch_id;
  const Y = demo.year_id;
  const unusable = await bcrypt.hash(randomUUID(), 12);

  return withTransaction(async (db) => {
    const q = (text, params) => db.query(text, params);
    const out = {};

    // ---- subjects
    const { rows: subjectRows } = await q(
      `INSERT INTO subjects (tenant_id, branch_id, code, name, subject_type, is_graded_only, display_order)
       SELECT $1, $2, x.code, x.name, x.type, x.graded, x.ord
         FROM unnest($3::text[], $4::text[], $5::text[], $6::boolean[], $7::smallint[]) AS x(code, name, type, graded, ord)
       RETURNING id, code`,
      [T, B, ...[0, 1, 2, 3, 4].map((i) => SUBJECTS.map((s) => s[i]))],
    );
    const subj = Object.fromEntries(subjectRows.map((r) => [r.code, r.id]));
    out.subjects = subjectRows.length;

    // ---- two more teachers (cannot sign in until the school sets a password)
    const { rows: newStaff } = await q(
      `WITH u AS (
         INSERT INTO users (tenant_id, branch_id, role, email, phone, password_hash, first_name, last_name)
         SELECT $1, $2, 'teacher', x.email, x.phone, $3, x.first, x.last
           FROM unnest($4::text[], $5::text[], $6::text[], $7::text[]) AS x(email, phone, first, last)
         RETURNING id, email
       )
       INSERT INTO staff_profiles (user_id, tenant_id, branch_id, employee_code, designation, department, date_of_joining, qualification)
       SELECT u.id, $1, $2, x.code, x.designation, x.department, x.joined::date, x.qualification
         FROM u JOIN unnest($4::text[], $8::text[], $9::text[], $10::text[], $11::text[], $12::text[])
                     AS x(email, code, designation, department, joined, qualification) ON x.email = u.email
       RETURNING id, user_id, employee_code`,
      [T, B, unusable,
        ['sunita.rao@demo.school', 'imran.qureshi@demo.school'], ['+919810066666', '+919810077777'],
        ['Sunita', 'Imran'], ['Rao', 'Qureshi'],
        ['EMP-103', 'EMP-104'], ['TGT Mathematics', 'TGT Science'], ['Middle', 'Middle'], ['2020-07-01', '2023-04-03'],
        ['M.Sc. Mathematics, B.Ed.', 'M.Sc. Physics, B.Ed.']],
    );
    out.staff = newStaff.length;

    // Teachers by subject: class teacher of 5 A = English + Art, of 6 A = Hindi + Social Science.
    const [s5, s6] = demo.sections;
    const byCode = Object.fromEntries(newStaff.map((s) => [s.employee_code, s]));
    const t5 = demo.staff.find((s) => s.id === s5.class_teacher_id) ?? demo.staff[0];
    const t6 = demo.staff.find((s) => s.id === s6.class_teacher_id) ?? demo.staff[1] ?? demo.staff[0];
    const teacherOf = { ENG: t5, ART: t5, HIN: t6, SST: t6, MAT: byCode['EMP-103'], SCI: byCode['EMP-104'], PHE: byCode['EMP-104'], DISC: t5 };

    // ---- exams: Term 1 complete (PT x2, NB, SEA, Half-Yearly), Term 2 first test scheduled
    const EXAMS = [
      ['Periodic Test 1', 'periodic', 'PT', demo.term1, '2026-05-11', '2026-05-16', 'completed', 40, 13],
      ['Periodic Test 2', 'periodic', 'PT', demo.term1, '2026-08-03', '2026-08-08', 'completed', 40, 13],
      ['Notebook Submission - Term 1', 'internal', 'NB', demo.term1, '2026-09-07', '2026-09-12', 'completed', 5, null],
      ['Subject Enrichment - Term 1', 'internal', 'SEA', demo.term1, '2026-09-07', '2026-09-12', 'completed', 5, null],
      ['Half Yearly Exam', 'mid_term', 'TERM', demo.term1, '2026-09-16', '2026-09-24', 'completed', 80, 27],
      ['Periodic Test 3', 'periodic', 'PT', demo.term2, '2026-11-09', '2026-11-14', 'scheduled', 40, 13],
    ];
    const { rows: examRows } = await q(
      `INSERT INTO exams (tenant_id, branch_id, academic_year_id, term_id, name, exam_type, component_code, start_date, end_date, status, created_by)
       SELECT $1, $2, $3, x.term, x.name, x.type::exam_type, x.code, x.s::date, x.e::date, x.status::exam_status, $4
         FROM unnest($5::uuid[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11::text[])
              AS x(term, name, type, code, s, e, status)
       RETURNING id, name, start_date, component_code, status`,
      [T, B, Y, demo.admin_id, EXAMS.map((e) => e[3]), EXAMS.map((e) => e[0]), EXAMS.map((e) => e[1]), EXAMS.map((e) => e[2]),
        EXAMS.map((e) => e[4]), EXAMS.map((e) => e[5]), EXAMS.map((e) => e[6])],
    );
    const exam = Object.fromEntries(examRows.map((r) => [r.name, r]));
    out.exams = examRows.length;

    // Papers: every core subject for both classes (one per day); co-scholastic + discipline in the Half Yearly.
    const papers = [];
    for (const [name, , , , start, , , max, pass] of EXAMS) {
      for (const section of demo.sections) {
        CORE.forEach((code, i) => papers.push([exam[name].id, section.class_id, subj[code], addDays(start, i), max, pass]));
        if (name === 'Half Yearly Exam') {
          for (const code of ['ART', 'PHE', 'DISC']) papers.push([exam[name].id, section.class_id, subj[code], addDays(start, 6), 5, null]);
        }
      }
    }
    const classIds = [...new Set(demo.sections.map((s) => s.class_id))];
    const { rowCount: paperCount } = await q(
      `INSERT INTO exam_schedules (tenant_id, branch_id, exam_id, academic_year_id, class_id, subject_id, exam_date, max_marks, pass_marks)
       SELECT $1, $2, x.exam, $3, x.cls, x.subject, x.d::date, x.max, x.pass
         FROM unnest($4::uuid[], $5::uuid[], $6::uuid[], $7::text[], $8::numeric[], $9::numeric[]) AS x(exam, cls, subject, d, max, pass)`,
      [T, B, Y, ...[0, 1, 2, 3, 4, 5].map((i) => papers.map((p) => p[i]))],
    );
    out.papers = paperCount;

    // Marks for every completed exam: a steady "ability" per student plus per-paper noise, in
    // half-mark steps; graded subjects get A/B/C. Two absences in the periodic tests.
    const { rowCount: markCount } = await q(
      `INSERT INTO marks_entry (tenant_id, branch_id, exam_schedule_id, exam_id, subject_id, academic_year_id, term_id,
                                student_id, marks_obtained, max_marks, is_absent, grade, entered_by)
       SELECT es.tenant_id, es.branch_id, es.id, es.exam_id, es.subject_id, es.academic_year_id, e.term_id, sp.id,
              CASE WHEN sub.is_graded_only OR absent THEN NULL
                   ELSE round(es.max_marks * least(1.0, greatest(0.2, ability + noise)) * 2) / 2 END,
              es.max_marks, absent,
              CASE WHEN sub.is_graded_only THEN (CASE WHEN h % 10 < 5 THEN 'A' WHEN h % 10 < 9 THEN 'B' ELSE 'C' END) END,
              tu.user_id
         FROM exam_schedules es
         JOIN exams e    ON e.id = es.exam_id AND e.status = 'completed'
         JOIN subjects sub ON sub.id = es.subject_id
         JOIN student_profiles sp ON sp.class_id = es.class_id AND sp.academic_year_id = es.academic_year_id
                                  AND sp.deleted_at IS NULL AND sp.status = 'enrolled'
         LEFT JOIN staff_profiles tu ON tu.id = (SELECT x.staff FROM unnest($3::uuid[], $4::uuid[]) AS x(subject, staff) WHERE x.subject = es.subject_id)
         CROSS JOIN LATERAL (SELECT abs(hashtext(sp.id::text || es.id::text)) AS h,
                                    0.48 + (abs(hashtext(sp.admission_number)) % 46) / 100.0 AS ability) r
         CROSS JOIN LATERAL (SELECT ((r.h % 25) - 12) / 100.0 AS noise,
                                    (e.name = 'Periodic Test 1' AND sub.code = 'SCI' AND sp.roll_number = '3')
                                 OR (e.name = 'Periodic Test 2' AND sub.code = 'HIN' AND sp.roll_number = '7') AS absent) n
        WHERE es.branch_id = $1 AND es.class_id = ANY ($2)`,
      [B, classIds, Object.keys(teacherOf).map((c) => subj[c]), Object.values(teacherOf).map((t) => t.id)],
    );
    out.marks = markCount;

    // ---- timetables Mon–Sat: assembly, 4 periods, lunch, 2 periods (Saturday ends with art + PE)
    const SLOTS = [
      [1, '08:00', '08:20', 'assembly', 'Morning assembly'],
      [2, '08:20', '09:00'], [3, '09:00', '09:40'], [4, '09:40', '10:20'], [5, '10:20', '11:00'],
      [6, '11:00', '11:30', 'break', 'Lunch break'],
      [7, '11:30', '12:10'], [8, '12:10', '12:50'],
    ];
    const periods = [];
    demo.sections.forEach((section, si) => {
      const offset = si * 2; // 6 A runs two subjects ahead of 5 A: no teacher is in two rooms at once
      for (let day = 1; day <= 6; day += 1) {
        let k = 0;
        for (const [no, start, end, kind, label] of SLOTS) {
          if (kind) {
            periods.push([section.id, day, no, start, end, kind, null, label, null, null]);
            continue;
          }
          let code;
          let pKind = 'class';
          if (day === 6 && no >= 7) {
            code = (no === 7) === (si % 2 === 0) ? 'ART' : 'PHE';
            pKind = 'activity';
          } else {
            code = CORE[((day - 1) * 6 + k + offset) % CORE.length];
          }
          k += 1;
          periods.push([section.id, day, no, start, end, pKind, subj[code], null, teacherOf[code].id, `R-${section.numeric_level}0${si + 1}`]);
        }
      }
    });
    const { rowCount: periodCount } = await q(
      `INSERT INTO timetable_periods (tenant_id, branch_id, section_id, weekday, period_no, start_time, end_time, kind, subject_id, label, teacher_staff_id, room)
       SELECT $1, $2, x.section, x.wd, x.no, x.st::time, x.en::time, x.kind, x.subject, x.label, x.teacher, x.room
         FROM unnest($3::uuid[], $4::smallint[], $5::smallint[], $6::text[], $7::text[], $8::text[], $9::uuid[], $10::text[], $11::uuid[], $12::text[])
              AS x(section, wd, no, st, en, kind, subject, label, teacher, room)`,
      [T, B, ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => periods.map((p) => p[i]))],
    );
    out.periods = periodCount;

    // ---- homework: six items per section over the last ten days
    const HOMEWORK = {
      ENG: ['Write a letter to your friend about your summer vacation', 'Read chapter 6 and answer questions 1-5'],
      HIN: ['पाठ 5 के प्रश्न-उत्तर लिखिए', 'Write 10 sentences on "Mera Vidyalaya" in Hindi'],
      MAT: ['Exercise 4.2: questions 1 to 12 (fractions)', 'Practice worksheet on decimals'],
      SCI: ['Draw and label the parts of a plant', 'Collect 5 examples of magnetic and non-magnetic objects'],
      SST: ['Map work: mark the states of North India', 'Make notes on the Mughal administration'],
    };
    const homework = [];
    demo.sections.forEach((section, si) => {
      for (let i = 0; i < 6; i += 1) {
        const code = CORE[(i + si) % CORE.length];
        const daysAgo = (si % 2 ? [10, 8, 6, 3, 2, 1] : [9, 7, 5, 4, 2, 1])[i]; // spread over the last ten days
        const [title, details] = [HOMEWORK[code][i % 2], i % 3 === 0 ? 'Submit in your notebook. Neat handwriting please.' : null];
        homework.push([section.id, subj[code], title, details, daysAgo, 2 + (i % 3), teacherOf[code].user_id]);
      }
    });
    const { rowCount: hwCount } = await q(
      `INSERT INTO homework (tenant_id, branch_id, section_id, subject_id, title, details, assigned_at, due_date, created_by)
       SELECT $1, $2, x.section, x.subject, x.title, x.details,
              ((CURRENT_DATE - x.ago) + time '13:30') AT TIME ZONE 'Asia/Kolkata', CURRENT_DATE - x.ago + x.due_in, x.by
         FROM unnest($3::uuid[], $4::uuid[], $5::text[], $6::text[], $7::int[], $8::int[], $9::uuid[])
              AS x(section, subject, title, details, ago, due_in, by)`,
      [T, B, ...[0, 1, 2, 3, 4, 5, 6].map((i) => homework.map((h) => h[i]))],
    );
    out.homework = hwCount;

    // ---- notices
    const NOTICES = [
      ['Parent-Teacher Meeting on Saturday', 'The Term 1 Parent-Teacher Meeting will be held this Saturday from 9:00 am to 12:30 pm. Report cards will be discussed with the class teacher. Please bring the school diary.', 'all', null, true, 2],
      ['Half-yearly report cards are out', 'Term 1 progress reports are now available in the parent app under Report cards. Please review them and sign the acknowledgement slip in the diary.', 'parents', null, false, 1],
      ['Grade 5 field trip to the National Science Centre', 'Grade 5 will visit the National Science Centre, Pragati Maidan next Friday. Consent forms and Rs 350 must reach the class teacher by Wednesday. Students should carry a packed lunch and water bottle.', 'parents', s5.class_id, false, 4],
      ['Staff meeting: Term 2 planning', 'All teachers are requested to attend the Term 2 planning meeting in the conference room on Monday at 2:00 pm. Bring your Term 1 result analysis and lesson plans for October.', 'teachers', null, false, 3],
      ['Diwali holidays', 'The school will remain closed from 19 October to 23 October for Diwali. Classes resume on Saturday, 24 October. Wishing all families a safe and happy Diwali!', 'all', null, false, 6],
    ];
    const { rowCount: noticeCount } = await q(
      `INSERT INTO notices (tenant_id, branch_id, title, body, audience, class_id, pinned, created_by, created_at)
       SELECT $1, $2, x.title, x.body, x.audience, x.cls, x.pinned, $3, now() - make_interval(days => x.ago, hours => x.ago)
         FROM unnest($4::text[], $5::text[], $6::text[], $7::uuid[], $8::boolean[], $9::int[]) AS x(title, body, audience, cls, pinned, ago)`,
      [T, B, demo.admin_id, ...[0, 1, 2, 3, 4, 5].map((i) => NOTICES.map((n) => n[i]))],
    );
    out.notices = noticeCount;

    // ---- transport: two routes, four stops each, 14 students (both of the demo parent's children)
    const ROUTES = [
      ['Route 1 - Sector 12', 'DL 1P C 4521', 'Ramesh Yadav', '+919811100021', 'Sunita Devi', 40,
        [['Sector 12 Market', '07:05', '14:35'], ['Sector 11 Pocket 4', '07:12', '14:28'], ['Ramphal Chowk', '07:20', '14:20'], ['Sector 7 Metro Station', '07:28', '14:12']]],
      ['Route 2 - Janakpuri', 'DL 1P D 7788', 'Mahesh Kumar', '+919811100034', null, 35,
        [['Janakpuri District Centre', '06:55', '14:45'], ['Uttam Nagar East Metro', '07:06', '14:34'], ['Palam Extension', '07:18', '14:22'], ['Sector 6 Market', '07:27', '14:13']]],
    ];
    const { rows: routeRows } = await q(
      `INSERT INTO transport_routes (tenant_id, branch_id, name, vehicle_number, driver_name, driver_phone, attendant_name, capacity)
       SELECT $1, $2, x.name, x.vehicle, x.driver, x.phone, x.attendant, x.capacity
         FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::smallint[]) AS x(name, vehicle, driver, phone, attendant, capacity)
       RETURNING id, name`,
      [T, B, ...[0, 1, 2, 3, 4, 5].map((i) => ROUTES.map((r) => r[i]))],
    );
    const routeId = Object.fromEntries(routeRows.map((r) => [r.name, r.id]));
    const stops = ROUTES.flatMap(([name, , , , , , list]) => list.map(([stop, pick, drop], i) => [routeId[name], stop, i + 1, pick, drop]));
    const { rows: stopRows } = await q(
      `INSERT INTO transport_stops (tenant_id, branch_id, route_id, name, sequence_no, pickup_time, drop_time)
       SELECT $1, $2, x.route, x.name, x.seq, x.pick::time, x.drop_time::time
         FROM unnest($3::uuid[], $4::text[], $5::smallint[], $6::text[], $7::text[]) AS x(route, name, seq, pick, drop_time)
       RETURNING id, route_id, sequence_no`,
      [T, B, ...[0, 1, 2, 3, 4].map((i) => stops.map((s) => s[i]))],
    );
    const { rowCount: riders } = await q(
      `WITH picked AS (
         SELECT sp.id, row_number() OVER (ORDER BY (sp.parent_id = $4) DESC, sp.admission_number) AS n
           FROM student_profiles sp
          WHERE sp.branch_id = $2 AND sp.deleted_at IS NULL AND sp.status = 'enrolled'
            AND (sp.parent_id = $4 OR abs(hashtext(sp.admission_number)) % 2 = 0)
       )
       INSERT INTO student_transport (student_id, tenant_id, branch_id, route_id, stop_id, assigned_by)
       SELECT p.id, $1, $2, st.route_id, st.id, $3
         FROM picked p
         JOIN unnest($5::uuid[], $6::uuid[], $7::int[]) AS st(id, route_id, seq)
           ON st.route_id = ($8::uuid[])[1 + (p.n % 2)::int] AND st.seq = 1 + ((p.n / 2) % 4)
        WHERE p.n <= 14`,
      [T, B, demo.admin_id, demo.parent_id, stopRows.map((s) => s.id), stopRows.map((s) => s.route_id), stopRows.map((s) => s.sequence_no),
        routeRows.map((r) => r.id)],
    );
    out.routes = routeRows.length;
    out.riders = riders;

    // ---- expenses: April to this month (nothing dated in the future)
    const expenses = buildExpenses(demo.year_start, minIso(demo.today, demo.year_end));
    const { rowCount: expenseCount } = await q(
      `INSERT INTO expenses (tenant_id, branch_id, category, description, amount, expense_date, payment_mode, vendor, reference, created_by, created_at)
       SELECT $1, $2, x.category, x.description, x.amount, x.d::date, x.mode, x.vendor, x.ref, $3, x.d::date + time '16:00'
         FROM unnest($4::text[], $5::text[], $6::numeric[], $7::text[], $8::text[], $9::text[], $10::text[]) AS x(category, description, amount, d, mode, vendor, ref)`,
      [T, B, demo.admin_id, ...[0, 1, 2, 3, 4, 5, 6].map((i) => expenses.map((e) => e[i]))],
    );
    out.expenses = expenseCount;
    return out;
  });
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** ~4–5 realistic expenses per month; salaries are the biggest monthly item. */
function buildExpenses(yearStart, lastDay) {
  const out = [];
  let [y, m] = yearStart.slice(0, 7).split('-').map(Number);
  const [ly, lm] = lastDay.slice(0, 7).split('-').map(Number);
  let i = 0;
  while (y < ly || (y === ly && m <= lm)) {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    const month = `${MONTH_NAMES[m - 1]} ${y}`;
    const summer = m >= 4 && m <= 9;
    const rows = [
      ['salary', `Staff salaries - ${month}`, 412500 + (i % 3) * 7500, 1, 'bank_transfer', 'Staff payroll', `NEFT/SAL/${ym.replace('-', '')}`],
      ['utilities', `Electricity bill - ${month}`, summer ? 38650 + i * 1210 : 21400 + i * 530, 8, 'upi', 'BSES Rajdhani Power Ltd', `CA-1023${45 + i}`],
      ['transport', `Diesel for school buses - ${month}`, 36800 + (i % 4) * 1450, 12, 'card', 'Indian Oil, Sector 12', null],
      ['utilities', `Internet and phone - ${month}`, 6490, 15, 'bank_transfer', 'Airtel Business', null],
    ];
    if (i % 2 === 0) rows.push(['supplies', 'Chalk, markers, registers and printer paper', 8450 + i * 375, 18, 'cash', 'Sharma Stationers', null]);
    if (i % 3 === 1) rows.push(['maintenance', 'AC servicing and classroom fan repairs', 14200 + i * 600, 21, 'upi', 'CoolTech Services', null]);
    if (m === 8) rows.push(['events', 'Independence Day celebration: decoration and sweets', 18500, 14, 'cash', 'Bikanervala, Dwarka', null]);
    if (m === 9) rows.push(['events', 'Inter-house sports day: trophies and refreshments', 26750, 25, 'upi', 'Sports Corner', null]);
    if (m === 6) rows.push(['maintenance', 'Summer break whitewash of 6 classrooms', 48000, 20, 'cheque', 'Gupta Painters', 'CHQ 004512']);
    if (m === 4) rows.push(['supplies', 'Library books for the new session', 22300, 22, 'bank_transfer', 'Om Book Distributors', null]);
    for (const [category, description, amount, day, mode, vendor, ref] of rows) {
      const date = `${ym}-${String(day).padStart(2, '0')}`;
      if (date <= lastDay) out.push([category, description, amount.toFixed(2), date, mode, vendor, ref]);
    }
    i += 1;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const minIso = (a, b) => (a < b ? a : b);

// =====================================================================
// Phase 2: Term-1 report cards through the real services
// =====================================================================

async function phaseTwo(demo) {
  const { rows } = await pool.query(`SELECT 1 FROM report_cards WHERE tenant_id = $1 AND status = 'published' LIMIT 1`, [demo.tenantId]);
  if (rows.length) return null;
  const auth = Object.freeze({ userId: demo.admin_id, role: 'branch_admin', tenantId: demo.tenantId, branchId: demo.branch_id });
  const out = { generated: 0, published: 0, incomplete: 0 };
  for (const section of demo.sections) {
    const g = await generateReportCards(auth, { sectionId: section.id, termId: demo.term1 });
    const p = await publishReportCards(auth, { sectionId: section.id, termId: demo.term1 });
    out.generated += g.generated;
    out.incomplete += g.incomplete;
    out.published += p.published;
  }
  return out;
}

// =====================================================================
// Phase 3: two bonafide certificates
// =====================================================================

async function phaseThree(demo) {
  const { rows } = await pool.query(`SELECT 1 FROM certificates WHERE tenant_id = $1 AND certificate_type = 'bonafide' LIMIT 1`, [demo.tenantId]);
  if (rows.length) return null;
  const auth = Object.freeze({ userId: demo.admin_id, role: 'branch_admin', tenantId: demo.tenantId, branchId: demo.branch_id });
  const { rows: students } = await pool.query(
    `SELECT id FROM student_profiles WHERE branch_id = $1 AND status = 'enrolled' AND deleted_at IS NULL
      ORDER BY (parent_id = $2) DESC, admission_number LIMIT 2`,
    [demo.branch_id, demo.parent_id],
  );
  const purposes = ['Passport application', 'Opening a bank account'];
  const issued = [];
  for (const [i, s] of students.entries()) issued.push((await issueBonafide(auth, s.id, { purpose: purposes[i] })).number);
  return { bonafides: issued };
}

// =====================================================================
// Phase 4: subject teachers (teacher_subject_assignments), timetable, homework files
// =====================================================================

// New teacher logins (password DEMO_PASSWORD).
const NEW_TEACHERS = [
  { key: 'maths', email: 'maths@demo.school', first: 'Neha', last: 'Gupta', phone: '+919810088881', designation: 'TGT Mathematics', qualification: 'M.Sc. Mathematics, B.Ed.' },
  { key: 'science', email: 'science@demo.school', first: 'Arvind', last: 'Mehta', phone: '+919810088882', designation: 'TGT Science', qualification: 'M.Sc. Chemistry, B.Ed.' },
  { key: 'hindi', email: 'hindi@demo.school', first: 'Kavita', last: 'Joshi', phone: '+919810088883', designation: 'TGT Hindi', qualification: 'M.A. Hindi, B.Ed.' },
];
// Subject code -> teacher key; the same teacher for every section. Keys of existing staff are their emails.
const SUBJECT_TEACHER = {
  ENG: 'teacher@demo.school',          // Priya Nair, class teacher of 5 A
  SST: 'teacher2@demo.school',         // Rajesh Kumar, class teacher of 6 A
  MAT: 'maths',
  SCI: 'science',
  HIN: 'hindi',
  ART: 'sunita.rao@demo.school',
  DISC: 'sunita.rao@demo.school',
  PHE: 'imran.qureshi@demo.school',
};

async function phaseFour(demo) {
  const { rows: done } = await pool.query(`SELECT 1 FROM teacher_subject_assignments WHERE tenant_id = $1 LIMIT 1`, [demo.tenantId]);
  if (done.length) return null;
  const { rows: subjectRows } = await pool.query(`SELECT id, code FROM subjects WHERE branch_id = $1 AND status = 'active'`, [demo.branch_id]);
  if (subjectRows.length === 0 || demo.sections.length === 0) return null;

  const password = process.env.DEMO_PASSWORD ?? '';
  const loginHash = await bcrypt.hash(password.length >= 10 ? password : randomUUID(), 12);
  if (password.length < 10) logger.warn('DEMO_PASSWORD not set: the new demo teachers cannot sign in');
  const pdfs = await Promise.all([
    worksheetPdf('Letter writing: format guide', ['Sender\'s address and date', 'Salutation (Dear ...)', 'Body: three short paragraphs', 'Closing (Yours lovingly / sincerely)', 'Your name']),
    worksheetPdf('Practice worksheet: decimals', ['0.5 + 0.25 =', '1.75 - 0.8 =', '2.4 x 3 =', '7.2 / 0.9 =', 'Write 3/4 as a decimal']),
  ]);

  return withTransaction(async (db) => {
    const q = (text, params) => db.query(text, params);
    const T = demo.tenantId;
    const B = demo.branch_id;
    const out = { teachersCreated: [] };

    // ---- teacher logins (reuse an existing teacher with that email)
    const staffByKey = {};
    const { rows: existing } = await q(
      `SELECT u.email, u.role, sf.id AS staff_id, sf.user_id FROM users u LEFT JOIN staff_profiles sf ON sf.user_id = u.id AND sf.branch_id = $2
        WHERE u.tenant_id = $1 AND u.deleted_at IS NULL AND u.email = ANY ($3)`,
      [T, B, [...NEW_TEACHERS.map((t) => t.email), ...Object.values(SUBJECT_TEACHER).filter((k) => k.includes('@'))]],
    );
    const byEmail = Object.fromEntries(existing.map((r) => [r.email, r]));
    const { rows: codes } = await q(`SELECT employee_code FROM staff_profiles WHERE branch_id = $1 ORDER BY created_at DESC, employee_code DESC`, [B]);
    const taken = new Set(codes.map((c) => c.employee_code.toLowerCase()));
    let code = nextSequenceCode(codes.map((c) => c.employee_code), 'EMP-101');
    for (const t of NEW_TEACHERS) {
      const found = byEmail[t.email];
      if (found) {
        if (found.role === 'teacher' && found.staff_id) staffByKey[t.key] = { id: found.staff_id, user_id: found.user_id };
        continue;
      }
      while (taken.has(code.toLowerCase())) code = nextSequenceCode([code]);
      taken.add(code.toLowerCase());
      const { rows: [u] } = await q(
        `INSERT INTO users (tenant_id, branch_id, role, email, phone, password_hash, first_name, last_name)
         VALUES ($1, $2, 'teacher', $3, $4, $5, $6, $7) RETURNING id`,
        [T, B, t.email, t.phone, loginHash, t.first, t.last],
      );
      const { rows: [sf] } = await q(
        `INSERT INTO staff_profiles (user_id, tenant_id, branch_id, employee_code, designation, department, date_of_joining, qualification)
         VALUES ($1, $2, $3, $4, $5, 'Middle', '2024-04-01', $6) RETURNING id`,
        [u.id, T, B, code, t.designation, t.qualification],
      );
      staffByKey[t.key] = { id: sf.id, user_id: u.id };
      out.teachersCreated.push(t.email);
    }
    for (const r of existing) if (r.role === 'teacher' && r.staff_id && !staffByKey[r.email]) staffByKey[r.email] = { id: r.staff_id, user_id: r.user_id };

    // Fallback for a missing teacher: the class teacher of the section.
    const subjectId = Object.fromEntries(subjectRows.map((r) => [r.code, r.id]));
    const ctStaff = Object.fromEntries(demo.staff.map((s) => [s.id, s]));
    const teacherFor = (code, section) => staffByKey[SUBJECT_TEACHER[code]] ?? ctStaff[section.class_teacher_id] ?? null;

    // ---- assignments: every active subject of every current section
    const pairs = [];
    for (const section of demo.sections) {
      for (const { code, id } of subjectRows) {
        const t = SUBJECT_TEACHER[code] ? teacherFor(code, section) : ctStaff[section.class_teacher_id];
        if (t) pairs.push({ sectionId: section.id, subjectId: id, staffId: t.id, userId: t.user_id });
      }
    }
    const { rowCount: assigned } = await q(
      `INSERT INTO teacher_subject_assignments (tenant_id, branch_id, academic_year_id, staff_id, section_id, subject_id, assigned_by)
       SELECT $1, $2, $3, x.staff, x.section, x.subject, $4
         FROM unnest($5::uuid[], $6::uuid[], $7::uuid[]) AS x(staff, section, subject)
       ON CONFLICT ON CONSTRAINT uq_tsa_section_subject DO NOTHING`,
      [T, B, demo.year_id, demo.admin_id, pairs.map((p) => p.staffId), pairs.map((p) => p.sectionId), pairs.map((p) => p.subjectId)],
    );
    out.assignments = assigned;
    const teacherOfPair = new Map(pairs.map((p) => [`${p.sectionId}:${p.subjectId}`, p]));

    // ---- timetable: the subject teacher takes each period; then remove double bookings by
    // swapping periods within the same section and day (or, failing that, leaving the slot without a teacher).
    const { rows: periodRows } = await q(
      `SELECT tp.id, tp.section_id, tp.weekday, tp.period_no, tp.kind, tp.subject_id, tp.teacher_staff_id
         FROM timetable_periods tp JOIN sections s ON s.id = tp.section_id
        WHERE s.branch_id = $1 AND s.academic_year_id = $2 AND s.deleted_at IS NULL
        ORDER BY tp.section_id, tp.weekday, tp.period_no`,
      [B, demo.year_id],
    );
    const periods = periodRows.map((p) => ({
      id: p.id, sectionId: p.section_id, weekday: p.weekday, periodNo: p.period_no, kind: p.kind, subjectId: p.subject_id,
      teacherStaffId: p.subject_id ? teacherOfPair.get(`${p.section_id}:${p.subject_id}`)?.staffId ?? p.teacher_staff_id : p.teacher_staff_id,
      original: { subjectId: p.subject_id, teacherStaffId: p.teacher_staff_id },
    }));
    let unresolved = 0;
    for (let guard = 0; guard < 500; guard += 1) {
      const clashes = teacherClashes(periods);
      if (clashes.length === 0) break;
      const [, p] = clashes[0];
      const before = clashes.length;
      const swapWith = periods.filter((o) => o.sectionId === p.sectionId && o.weekday === p.weekday && o.id !== p.id && o.subjectId && o.kind === p.kind);
      let fixed = false;
      for (const o of swapWith) {
        [p.subjectId, o.subjectId, p.teacherStaffId, o.teacherStaffId] = [o.subjectId, p.subjectId, o.teacherStaffId, p.teacherStaffId];
        if (teacherClashes(periods).length < before) { fixed = true; break; }
        [p.subjectId, o.subjectId, p.teacherStaffId, o.teacherStaffId] = [o.subjectId, p.subjectId, o.teacherStaffId, p.teacherStaffId];
      }
      if (!fixed) { p.teacherStaffId = null; unresolved += 1; }
    }
    const changed = periods.filter((p) => p.subjectId !== p.original.subjectId || p.teacherStaffId !== p.original.teacherStaffId);
    if (changed.length) {
      await q(
        `UPDATE timetable_periods tp SET subject_id = x.subject, teacher_staff_id = x.teacher
           FROM unnest($1::uuid[], $2::uuid[], $3::uuid[]) AS x(id, subject, teacher)
          WHERE tp.id = x.id`,
        [changed.map((p) => p.id), changed.map((p) => p.subjectId), changed.map((p) => p.teacherStaffId)],
      );
    }
    out.periodsUpdated = changed.length;
    if (unresolved) out.periodsWithoutTeacher = unresolved;

    // ---- phase-1 homework (created with the subjects) belongs to its subject teacher
    const { rowCount: rehomed } = await q(
      `UPDATE homework h SET created_by = x.user_id
         FROM unnest($2::uuid[], $3::uuid[], $4::uuid[]) AS x(section, subject, user_id)
        WHERE h.branch_id = $1 AND h.section_id = x.section AND h.subject_id = x.subject
          AND h.created_at = (SELECT min(created_at) FROM subjects WHERE branch_id = $1)
          AND h.created_by IS DISTINCT FROM x.user_id`,
      [B, pairs.map((p) => p.sectionId), pairs.map((p) => p.subjectId), pairs.map((p) => p.userId)],
    );
    out.homeworkReassigned = rehomed;

    // ---- two homework items get a small PDF: latest English of the first section, latest Maths of the second
    const targets = [
      [demo.sections[0], 'ENG', 'Letter-writing-format.pdf', pdfs[0]],
      [demo.sections[1] ?? demo.sections[0], 'MAT', 'Decimals-practice-worksheet.pdf', pdfs[1]],
    ];
    out.attachments = 0;
    for (const [section, subjectCode, fileName, data] of targets) {
      const { rows: [hw] } = await q(
        `SELECT h.id, h.created_by FROM homework h
          WHERE h.section_id = $1 AND h.subject_id = $2 AND h.deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM homework_attachments a WHERE a.homework_id = h.id)
          ORDER BY h.assigned_at DESC LIMIT 1`,
        [section.id, subjectId[subjectCode]],
      );
      if (!hw) continue;
      await q(
        `INSERT INTO homework_attachments (homework_id, tenant_id, branch_id, file_name, mime_type, size_bytes, data, uploaded_by)
         VALUES ($1, $2, $3, $4, 'application/pdf', $5, $6, $7)`,
        [hw.id, T, B, fileName, data.length, data, hw.created_by],
      );
      out.attachments += 1;
    }
    return out;
  });
}

/** A one-page worksheet PDF (a few KB). */
function worksheetPdf(title, lines) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: title, Author: 'Demo Public School' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.font('Helvetica-Bold').fontSize(18).text('Demo Public School', { align: 'center' });
    doc.moveDown(0.3).font('Helvetica').fontSize(13).text(title, { align: 'center' });
    doc.moveDown(1.2).fontSize(11);
    lines.forEach((line, i) => doc.text(`${i + 1}.  ${line}`).moveDown(0.6));
    doc.moveDown(1).fontSize(9).fillColor('#666').text('Complete in your notebook and bring it to the next class.');
    doc.end();
  });
}

// =====================================================================
// Run (at the end: the constants above must be initialised first)
// =====================================================================

const summary = {};

try {
  const demo = await loadDemo();
  if (!demo) {
    logger.info('Demo extras skipped: no demo school (tenant code "demo")');
  } else {
    summary.phase1 = (await phaseOne(demo)) ?? 'skipped';
    summary.phase2 = (await phaseTwo(demo)) ?? 'skipped';
    summary.phase3 = (await phaseThree(demo)) ?? 'skipped';
    summary.phase4 = (await phaseFour(demo)) ?? 'skipped';
    logger.info('Demo extras ready', summary);
  }
  await pool.end();
} catch (err) {
  logger.error('Demo extras failed', { error: err.message, stack: err.stack });
  await pool.end().catch(() => {});
  process.exit(1);
}
void env; // imported for its validation side effect
