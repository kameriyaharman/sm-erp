import { query } from '../../db/pool.js';

// ---------------------------------------------------------------- sections the caller may mark

/**
 * Current-year sections visible to the caller:
 *   teacher       -> sections where they are the class teacher
 *   branch_admin  -> every section of their branch
 *   super_admin   -> every section of their tenant (or all, for platform admins)
 */
export async function listMarkableSections(auth, role, date) {
  const { rows } = await query(
    `WITH me AS (
       SELECT sf.id AS staff_id FROM staff_profiles sf
        WHERE sf.user_id = $1 AND sf.deleted_at IS NULL AND sf.status = 'active'
     )
     SELECT s.id, s.name, s.branch_id, b.name AS branch_name,
            c.id AS class_id, c.name AS class_name, c.display_order,
            ay.id AS academic_year_id, ay.name AS academic_year,
            concat_ws(' ', tu.first_name, tu.last_name) AS class_teacher,
            (s.class_teacher_id IS NOT NULL AND s.class_teacher_id = (SELECT staff_id FROM me)) AS is_class_teacher,
            (SELECT count(*)::int FROM student_profiles sp
              WHERE sp.section_id = s.id AND sp.status = 'enrolled' AND sp.deleted_at IS NULL) AS student_count,
            sub.submitted_at, sub.present_count, sub.absent_count, sub.total_students
       FROM sections s
       JOIN classes c         ON c.id = s.class_id
       JOIN academic_years ay ON ay.id = s.academic_year_id AND ay.is_current
       JOIN branches b        ON b.id = s.branch_id AND b.deleted_at IS NULL
       LEFT JOIN staff_profiles tsf ON tsf.id = s.class_teacher_id
       LEFT JOIN users tu           ON tu.id = tsf.user_id
       LEFT JOIN attendance_submissions sub
              ON sub.section_id = s.id
             AND sub.attendance_date = COALESCE($4::date,
                   (now() AT TIME ZONE (SELECT timezone FROM tenants WHERE id = s.tenant_id))::date)
      WHERE s.deleted_at IS NULL AND s.status = 'active'
        AND CASE $2
              WHEN 'teacher'      THEN s.class_teacher_id = (SELECT staff_id FROM me)
              WHEN 'branch_admin' THEN s.branch_id = $3
              WHEN 'super_admin'  THEN ($5::uuid IS NULL OR s.tenant_id = $5)
              ELSE false
            END
      ORDER BY b.name, c.display_order, c.name, s.name`,
    [auth.userId, role, auth.branchId, date ?? null, auth.tenantId],
  );
  return rows;
}

/** Section + its tenant's "today" + whether the caller is its class teacher. */
export async function getSectionContext(db, sectionId, userId) {
  const { rows } = await db.query(
    `SELECT s.id, s.name, s.tenant_id, s.branch_id, s.class_id, s.academic_year_id,
            c.name AS class_name, b.name AS branch_name, t.name AS school_name, t.timezone,
            ay.name AS academic_year, ay.start_date AS year_start, ay.end_date AS year_end,
            (now() AT TIME ZONE t.timezone)::date AS today,
            concat_ws(' ', tu.first_name, tu.last_name) AS class_teacher,
            EXISTS (SELECT 1 FROM staff_profiles sf
                     WHERE sf.id = s.class_teacher_id AND sf.user_id = $2
                       AND sf.deleted_at IS NULL AND sf.status = 'active') AS is_class_teacher
       FROM sections s
       JOIN classes c         ON c.id = s.class_id
       JOIN branches b        ON b.id = s.branch_id
       JOIN tenants t         ON t.id = s.tenant_id
       JOIN academic_years ay ON ay.id = s.academic_year_id
       LEFT JOIN staff_profiles tsf ON tsf.id = s.class_teacher_id
       LEFT JOIN users tu           ON tu.id = tsf.user_id
      WHERE s.id = $1 AND s.deleted_at IS NULL`,
    [sectionId, userId],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------- roster

/** Enrolled students of a section with their mark (if any) for the date. */
export async function getRoster(db, sectionId, date) {
  const { rows } = await db.query(
    `SELECT sp.id AS student_id, sp.admission_number, sp.roll_number,
            concat_ws(' ', u.first_name, u.last_name) AS student_name,
            sa.status, sa.remarks,
            EXISTS (
              SELECT 1 FROM users pu
               WHERE pu.deleted_at IS NULL AND pu.status = 'active'
                 AND (pu.phone IS NOT NULL OR pu.email IS NOT NULL)
                 AND (pu.id = sp.parent_id
                      OR pu.id IN (SELECT g.guardian_user_id FROM student_guardians g
                                    WHERE g.student_id = sp.id AND g.receives_notices))
            ) AS has_parent_contact,
            (SELECT json_build_object('status', n.status, 'channel', n.channel, 'template', n.template, 'sentAt', n.sent_at)
               FROM parent_notifications n
              WHERE n.student_id = sp.id AND n.payload->>'date' = $2::text
              ORDER BY n.created_at DESC LIMIT 1) AS last_notification
       FROM student_profiles sp
       JOIN users u ON u.id = sp.user_id
       LEFT JOIN student_attendance sa ON sa.student_id = sp.id AND sa.attendance_date = $2
      WHERE sp.section_id = $1 AND sp.status = 'enrolled' AND sp.deleted_at IS NULL
      ORDER BY NULLIF(regexp_replace(COALESCE(sp.roll_number, ''), '\\D', '', 'g'), '')::int NULLS LAST,
               student_name`,
    [sectionId, date],
  );
  return rows;
}

export async function getSubmission(db, sectionId, date) {
  const { rows } = await db.query(
    `SELECT sub.*, concat_ws(' ', su.first_name, su.last_name) AS submitted_by_name,
            concat_ws(' ', lu.first_name, lu.last_name) AS updated_by_name
       FROM attendance_submissions sub
       LEFT JOIN users su ON su.id = sub.submitted_by
       LEFT JOIN users lu ON lu.id = sub.last_updated_by
      WHERE sub.section_id = $1 AND sub.attendance_date = $2`,
    [sectionId, date],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------- writes

/** Serialises submissions for the same section + day (transaction-scoped). */
export async function lockSectionDay(db, sectionId, date) {
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text || ':' || $2::text, 0))`, [sectionId, date]);
}

export async function previousStatuses(db, studentIds, date) {
  const { rows } = await db.query(
    `SELECT student_id, status FROM student_attendance
      WHERE student_id = ANY ($1) AND attendance_date = $2`,
    [studentIds, date],
  );
  return new Map(rows.map((r) => [r.student_id, r.status]));
}

export async function upsertAttendance(db, ctx, { date, records, markedBy }) {
  await db.query(
    `INSERT INTO student_attendance
            (tenant_id, branch_id, academic_year_id, section_id, student_id, attendance_date,
             status, remarks, source, marked_by)
     SELECT $1, $2, $3, $4, x.student_id, $5, x.status::attendance_status, x.remarks, 'app', $6
       FROM jsonb_to_recordset($7::jsonb) AS x(student_id uuid, status text, remarks text)
     ON CONFLICT (student_id, attendance_date) DO UPDATE
        SET status     = EXCLUDED.status,
            remarks    = EXCLUDED.remarks,
            section_id = EXCLUDED.section_id,
            source     = EXCLUDED.source,
            marked_by  = EXCLUDED.marked_by`,
    [
      ctx.tenant_id, ctx.branch_id, ctx.academic_year_id, ctx.id, date, markedBy,
      JSON.stringify(records.map((r) => ({ student_id: r.studentId, status: r.status, remarks: r.remarks ?? null }))),
    ],
  );
}

export async function upsertSubmission(db, ctx, { date, counts, userId }) {
  const { rows } = await db.query(
    `INSERT INTO attendance_submissions
            (tenant_id, branch_id, section_id, academic_year_id, attendance_date,
             total_students, present_count, absent_count, other_count, submitted_by, last_updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
     ON CONFLICT (section_id, attendance_date) DO UPDATE
        SET total_students  = EXCLUDED.total_students,
            present_count   = EXCLUDED.present_count,
            absent_count    = EXCLUDED.absent_count,
            other_count     = EXCLUDED.other_count,
            last_updated_by = EXCLUDED.last_updated_by,
            revision        = attendance_submissions.revision + 1
     RETURNING id, revision, submitted_at, updated_at`,
    [ctx.tenant_id, ctx.branch_id, ctx.id, ctx.academic_year_id, date, counts.total, counts.present, counts.absent, counts.other, userId],
  );
  return rows[0];
}

/** Parents/guardians who should hear about a student, with how to reach them. */
export async function getNoticeRecipients(db, studentIds) {
  const { rows } = await db.query(
    `SELECT sp.id AS student_id, concat_ws(' ', su.first_name, su.last_name) AS student_name,
            pu.id AS parent_user_id, concat_ws(' ', pu.first_name, pu.last_name) AS parent_name,
            pu.phone, pu.email
       FROM student_profiles sp
       JOIN users su ON su.id = sp.user_id
       JOIN users pu ON pu.deleted_at IS NULL AND pu.status = 'active'
                    AND (pu.id = sp.parent_id
                         OR pu.id IN (SELECT g.guardian_user_id FROM student_guardians g
                                       WHERE g.student_id = sp.id AND g.receives_notices))
      WHERE sp.id = ANY ($1)`,
    [studentIds],
  );
  return rows;
}

/**
 * Queues one notification per (event, parent). Re-submitting the same register
 * hits the dedupe key and queues nothing new; a previously cancelled message
 * for the same event is re-armed instead.
 */
export async function enqueueNotifications(db, notifications) {
  if (notifications.length === 0) return [];
  const { rows } = await db.query(
    `INSERT INTO parent_notifications
            (tenant_id, branch_id, student_id, parent_user_id, channel, recipient,
             template, payload, message, dedupe_key, created_by)
     SELECT x.tenant_id, x.branch_id, x.student_id, x.parent_user_id, x.channel::notification_channel,
            x.recipient, x.template, x.payload, x.message, x.dedupe_key, x.created_by
       FROM jsonb_to_recordset($1::jsonb) AS x(
            tenant_id uuid, branch_id uuid, student_id uuid, parent_user_id uuid, channel text,
            recipient text, template text, payload jsonb, message text, dedupe_key text, created_by uuid)
     ON CONFLICT (tenant_id, dedupe_key) DO UPDATE
        SET status = 'queued', attempts = 0, next_attempt_at = now(), last_error = NULL,
            message = EXCLUDED.message, recipient = EXCLUDED.recipient
      WHERE parent_notifications.status = 'cancelled'
     RETURNING id, student_id, template`,
    [JSON.stringify(notifications)],
  );
  return rows;
}

/** Absence message not sent yet and the student is no longer absent: don't send it. */
export async function cancelPendingAbsence(db, tenantId, studentIds, date) {
  const { rows } = await db.query(
    `UPDATE parent_notifications
        SET status = 'cancelled', last_error = 'Attendance changed before sending'
      WHERE tenant_id = $1 AND student_id = ANY ($2)
        AND template = 'attendance_absent' AND payload->>'date' = $3::text
        AND status = 'queued'
      RETURNING student_id`,
    [tenantId, studentIds, date],
  );
  return rows;
}

/** Students whose absence message already went out for this date. */
export async function studentsWithSentAbsence(db, tenantId, studentIds, date) {
  const { rows } = await db.query(
    `SELECT DISTINCT student_id FROM parent_notifications
      WHERE tenant_id = $1 AND student_id = ANY ($2)
        AND template = 'attendance_absent' AND payload->>'date' = $3::text
        AND status IN ('sending', 'sent')`,
    [tenantId, studentIds, date],
  );
  return new Set(rows.map((r) => r.student_id));
}

export async function notificationsFor(db, sectionId, date) {
  const { rows } = await db.query(
    `SELECT n.id, n.student_id, concat_ws(' ', su.first_name, su.last_name) AS student_name,
            concat_ws(' ', pu.first_name, pu.last_name) AS parent_name,
            n.channel, n.recipient, n.template, n.message, n.status, n.attempts,
            n.sent_at, n.last_error, n.created_at
       FROM parent_notifications n
       JOIN student_profiles sp ON sp.id = n.student_id
       JOIN users su ON su.id = sp.user_id
       JOIN users pu ON pu.id = n.parent_user_id
      WHERE (n.payload->>'sectionId') = $1::text AND (n.payload->>'date') = $2::text
      ORDER BY n.created_at`,
    [sectionId, date],
  );
  return rows;
}
