import { query } from '../../db/pool.js';

export async function sectionPeriods(db, sectionId) {
  const { rows } = await (db ?? { query }).query(
    `SELECT tp.id, tp.weekday, tp.period_no, to_char(tp.start_time, 'HH24:MI') AS start, to_char(tp.end_time, 'HH24:MI') AS "end",
            tp.kind, tp.subject_id, sub.name AS subject_name, tp.label, tp.teacher_staff_id,
            concat_ws(' ', u.first_name, u.last_name) AS teacher_name, tp.room
       FROM timetable_periods tp
       LEFT JOIN subjects sub      ON sub.id = tp.subject_id
       LEFT JOIN staff_profiles sf ON sf.id = tp.teacher_staff_id
       LEFT JOIN users u           ON u.id = sf.user_id
      WHERE tp.section_id = $1
      ORDER BY tp.weekday, tp.start_time, tp.period_no`,
    [sectionId],
  );
  return rows;
}

export async function subjectsInBranch(db, branchId, ids) {
  const { rows } = await db.query(`SELECT id FROM subjects WHERE branch_id = $1 AND id = ANY ($2)`, [branchId, ids]);
  return new Set(rows.map((r) => r.id));
}

export async function staffInBranch(db, branchId, ids) {
  const { rows } = await db.query(`SELECT id FROM staff_profiles WHERE branch_id = $1 AND id = ANY ($2) AND deleted_at IS NULL`, [branchId, ids]);
  return new Set(rows.map((r) => r.id));
}

/** The same teachers' periods in other sections of the same academic year. */
export async function otherSectionsPeriods(db, { sectionId, academicYearId, staffIds }) {
  const { rows } = await db.query(
    `SELECT tp.teacher_staff_id, tp.weekday, to_char(tp.start_time, 'HH24:MI') AS start, to_char(tp.end_time, 'HH24:MI') AS "end",
            c.name || ' ' || s.name AS section_label, concat_ws(' ', u.first_name, u.last_name) AS teacher_name
       FROM timetable_periods tp
       JOIN sections s ON s.id = tp.section_id AND s.academic_year_id = $2 AND s.deleted_at IS NULL
       JOIN classes c  ON c.id = s.class_id
       JOIN staff_profiles sf ON sf.id = tp.teacher_staff_id
       JOIN users u ON u.id = sf.user_id
      WHERE tp.teacher_staff_id = ANY ($3) AND tp.section_id <> $1`,
    [sectionId, academicYearId, staffIds],
  );
  return rows;
}

export async function replacePeriods(db, section, periods) {
  await db.query(`DELETE FROM timetable_periods WHERE section_id = $1`, [section.id]);
  if (periods.length === 0) return;
  await db.query(
    `INSERT INTO timetable_periods (tenant_id, branch_id, section_id, weekday, period_no, start_time, end_time, kind, subject_id, label, teacher_staff_id, room)
     SELECT $1, $2, $3, x.weekday, x.period_no, x.start_time, x.end_time, x.kind, x.subject_id, x.label, x.teacher_staff_id, x.room
       FROM unnest($4::smallint[], $5::smallint[], $6::time[], $7::time[], $8::text[], $9::uuid[], $10::text[], $11::uuid[], $12::text[])
            AS x(weekday, period_no, start_time, end_time, kind, subject_id, label, teacher_staff_id, room)`,
    [
      section.tenant_id, section.branch_id, section.id,
      periods.map((p) => p.weekday), periods.map((p) => p.periodNo), periods.map((p) => p.start), periods.map((p) => p.end),
      periods.map((p) => p.kind), periods.map((p) => p.subjectId ?? null), periods.map((p) => p.label ?? null),
      periods.map((p) => p.teacherStaffId ?? null), periods.map((p) => p.room ?? null),
    ],
  );
}
