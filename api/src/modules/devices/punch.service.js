import { createHash, randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';
import { pool, withTransaction } from '../../db/pool.js';
import { logger } from '../../utils/logger.js';
import { localParts, safeZone, sendAtFor } from '../../utils/time.js';
import * as attendanceRepo from '../academics/attendance.repository.js';
import { isModuleEnabled } from '../saas/entitlements.js';
import { kickDispatcher } from '../notifications/dispatcher.js';
import { getNotifier } from '../notifications/index.js';
import { getSettings } from '../settings/store.js';
import { dayOff } from '../settings/sections.js';

/**
 * Attendance from devices at the gate: RFID card readers, biometric (fingerprint / face) terminals,
 * QR scanners and a gate app. Every punch is stored in device_punches with what was done with it.
 *
 * Students (morning, between "check-in opens" and the cut-off):
 *   no mark yet          -> present, or late after "late after"; parents get "Reached school" /
 *                           "Late arrival" when those rules are on
 *   marked absent        -> changed to late (the child came after the register); a pending absence
 *                           message is cancelled, one already sent is corrected
 *   present / late / leave -> left as it is (already_marked)
 * Staff: first punch of the day = check-in (late after the staff late time), a punch at least
 *   `minGapMinutes` later = check-out (the last one wins).
 *
 * Identifiers: a card / device user ID / QR value registered under Settings -> Devices, else the
 * student's admission number or the staff member's employee code (many schools enrol people on
 * the device by those numbers).
 */

const SOURCE = { rfid: 'rfid', biometric: 'biometric', face: 'biometric', qr: 'app', gate_app: 'app' };
const IDENT_KINDS = { rfid: ['rfid'], biometric: ['biometric', 'face'], face: ['face', 'biometric'], qr: ['qr', 'rfid'], gate_app: ['qr', 'rfid', 'biometric', 'face'] };

export const hashKey = (key) => createHash('sha256').update(String(key)).digest('hex');

/** A new device key: "smd_" + 40 url-safe characters. Shown once; only its hash is stored. */
export function newDeviceKey() {
  const key = `smd_${randomBytes(30).toString('base64url')}`;
  return { key, hash: hashKey(key), prefix: key.slice(0, 10) };
}

export async function deviceByKey(key) {
  if (typeof key !== 'string' || !key.startsWith('smd_') || key.length > 100) return null;
  const { rows } = await pool.query(
    `SELECT d.*, t.timezone, t.status AS tenant_status FROM attendance_devices d JOIN tenants t ON t.id = d.tenant_id
      WHERE d.api_key_hash = $1 AND d.deleted_at IS NULL`,
    [hashKey(key)],
  );
  return rows[0] ?? null;
}

export async function deviceBySerial(serial) {
  if (typeof serial !== 'string' || !/^[A-Za-z0-9_-]{3,64}$/.test(serial)) return null;
  const { rows } = await pool.query(
    `SELECT d.*, t.timezone, t.status AS tenant_status FROM attendance_devices d JOIN tenants t ON t.id = d.tenant_id
      WHERE d.serial_number = $1 AND d.protocol = 'adms' AND d.deleted_at IS NULL`,
    [serial],
  );
  return rows[0] ?? null;
}

export async function touchDevice(deviceId, ip) {
  await pool.query(`UPDATE attendance_devices SET last_seen_at = now(), last_ip = left($2, 64) WHERE id = $1`, [deviceId, ip ?? null]).catch(() => undefined);
}

/** Can this device record attendance right now? Returns a reason string, or null. */
export async function deviceBlockReason(device) {
  if (device.status !== 'active') return 'device is switched off in Settings -> Devices';
  if (device.tenant_status !== 'active') return 'school account is not active';
  if (!(await isModuleEnabled(device.tenant_id, 'device_attendance'))) return 'device attendance is not part of the school plan';
  return null;
}

async function resolvePerson(db, device, identifier) {
  const kinds = IDENT_KINDS[device.kind] ?? ['rfid'];
  const { rows } = await db.query(
    `SELECT student_id, staff_id FROM attendance_identifiers
      WHERE tenant_id = $1 AND branch_id = $2 AND kind = ANY ($3) AND value = $4
      LIMIT 1`,
    [device.tenant_id, device.branch_id, kinds, identifier],
  );
  if (rows[0]) return rows[0];
  // Fallback: the number the device was enrolled with is the admission number / employee code.
  const { rows: byNumber } = await db.query(
    `SELECT (SELECT sp.id FROM student_profiles sp
              WHERE sp.branch_id = $1 AND lower(sp.admission_number) = lower($2) AND sp.deleted_at IS NULL LIMIT 1) AS student_id,
            (SELECT sf.id FROM staff_profiles sf
              WHERE sf.branch_id = $1 AND lower(sf.employee_code) = lower($2) AND sf.deleted_at IS NULL LIMIT 1) AS staff_id`,
    [device.branch_id, identifier],
  );
  const hit = byNumber[0];
  if (hit?.student_id && hit?.staff_id) return { student_id: hit.student_id, staff_id: null }; // ambiguous number: students win
  return hit?.student_id || hit?.staff_id ? hit : null;
}

async function alreadyStored(db, deviceId, identifier, at) {
  const { rows } = await db.query(`SELECT 1 FROM device_punches WHERE device_id = $1 AND identifier = $2 AND punched_at = $3`, [deviceId, identifier, at]);
  return rows.length > 0;
}

async function storePunch(db, device, punch, outcome) {
  await db.query(
    `INSERT INTO device_punches (tenant_id, branch_id, device_id, identifier, kind, punched_at, student_id, staff_id, result, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, left($10, 200))
     ON CONFLICT (device_id, identifier, punched_at) DO NOTHING`,
    [device.tenant_id, device.branch_id, device.id, punch.identifier, device.kind, punch.at, outcome.studentId ?? null, outcome.staffId ?? null, outcome.result, outcome.detail ?? null],
  );
}

/**
 * Processes one punch. Never throws for bad data (unknown card, holiday ...): the outcome says
 * what happened and is stored with the punch.
 * @param {object} device   attendance_devices row (+ timezone)
 * @param {{ identifier: string, at: Date }} punch
 */
export async function processPunch(device, punch) {
  const identifier = String(punch.identifier ?? '').trim().slice(0, 64);
  if (!identifier) return { result: 'invalid', detail: 'empty identifier' };
  const at = punch.at instanceof Date && !Number.isNaN(punch.at.getTime()) ? punch.at : new Date();
  const zone = safeZone(device.timezone);
  const local = localParts(at, zone);
  const p = { identifier, at };

  if (await alreadyStored(pool, device.id, identifier, at)) return { result: 'duplicate', identifier };

  const [policy, calendar] = await Promise.all([getSettings(device.tenant_id, 'attendance', device.branch_id), getSettings(device.tenant_id, 'calendar', device.branch_id)]);
  const rules = policy.device;

  const person = await resolvePerson(pool, device, identifier);
  if (!person) {
    const outcome = { result: 'unknown_identifier', detail: `No student or staff member has ${identifier}` };
    await storePunch(pool, device, p, outcome);
    return { ...outcome, identifier };
  }
  if (person.student_id && device.applies_to === 'staff') {
    const outcome = { result: 'ignored', studentId: person.student_id, detail: 'This device records staff only' };
    await storePunch(pool, device, p, outcome);
    return outcome;
  }
  if (person.staff_id && device.applies_to === 'students') {
    const outcome = { result: 'ignored', staffId: person.staff_id, detail: 'This device records students only' };
    await storePunch(pool, device, p, outcome);
    return outcome;
  }

  const off = dayOff(calendar, local.date);
  if (off) {
    const outcome = { result: 'holiday', studentId: person.student_id, staffId: person.staff_id, detail: off.reason };
    await storePunch(pool, device, p, outcome);
    return outcome;
  }

  const outcome = person.student_id
    ? await studentPunch(device, { ...p, local, zone }, person.student_id, rules)
    : await staffPunch(device, { ...p, local }, person.staff_id, rules);
  await storePunch(pool, device, p, outcome);
  return outcome;
}

async function studentPunch(device, punch, studentId, rules) {
  const { local } = punch;
  if (local.time < rules.checkInFrom || local.time > rules.cutoff) {
    return { result: 'outside_window', studentId, detail: `Punch at ${local.time} is outside ${rules.checkInFrom}-${rules.cutoff}` };
  }
  const status = local.time > rules.lateAfter ? 'late' : 'present';
  const notifier = getNotifier({ env, logger });
  const [gateRule, lateRule] = await Promise.all([
    notifier.ruleFor(device.tenant_id, 'gate_entry', device.branch_id),
    notifier.ruleFor(device.tenant_id, 'late_arrival', device.branch_id),
  ]);

  const result = await withTransaction(async (db) => {
    const { rows: [student] } = await db.query(
      `SELECT sp.id, sp.tenant_id, sp.branch_id, sp.section_id, sp.academic_year_id, sp.status,
              concat_ws(' ', u.first_name, u.last_name) AS name, c.name AS class_name, s.name AS section_name,
              t.name AS school_name, b.name AS branch_name
         FROM student_profiles sp
         JOIN users u    ON u.id = sp.user_id
         JOIN tenants t  ON t.id = sp.tenant_id
         JOIN branches b ON b.id = sp.branch_id
         LEFT JOIN sections s ON s.id = sp.section_id
         LEFT JOIN classes c  ON c.id = sp.class_id
        WHERE sp.id = $1 AND sp.deleted_at IS NULL`,
      [studentId],
    );
    if (!student || student.status !== 'enrolled' || !student.section_id) {
      return { result: 'not_enrolled', studentId, detail: 'Student is not enrolled in a section' };
    }
    await attendanceRepo.lockSectionDay(db, student.section_id, local.date);
    const before = (await attendanceRepo.previousStatuses(db, [studentId], local.date)).get(studentId);
    if (before && before !== 'absent') return { result: 'already_marked', studentId, detail: `Already marked ${before}` };

    const newStatus = before === 'absent' ? 'late' : status;
    await db.query(
      `INSERT INTO student_attendance
              (tenant_id, branch_id, academic_year_id, section_id, student_id, attendance_date, status, check_in_time, source, remarks)
       VALUES ($1, $2, $3, $4, $5, $6, $7::attendance_status, $8::time, $9::attendance_source, $10)
       ON CONFLICT (student_id, attendance_date) DO UPDATE
          SET status = EXCLUDED.status, check_in_time = EXCLUDED.check_in_time, source = EXCLUDED.source,
              remarks = EXCLUDED.remarks, marked_by = NULL`,
      [student.tenant_id, student.branch_id, student.academic_year_id, student.section_id, studentId, local.date, newStatus, local.time, SOURCE[device.kind] ?? 'rfid', `${device.name} at ${local.time}`],
    );

    // Parents.
    const outbox = [];
    const schoolName = `${student.school_name}, ${student.branch_name}`;
    const label = [student.class_name, student.section_name].filter(Boolean).join(' ');
    let correction = false;
    if (before === 'absent') {
      await attendanceRepo.cancelPendingAbsence(db, student.tenant_id, [studentId], local.date);
      correction = (await attendanceRepo.studentsWithSentAbsence(db, student.tenant_id, [studentId], local.date)).has(studentId);
    }
    const wants = [];
    if (gateRule?.enabled) wants.push(['gate_entry', gateRule]);
    if (newStatus === 'late' && lateRule?.enabled) wants.push(['late_arrival', lateRule]);
    if (correction) wants.push(['attendance_correction', null]);
    if (wants.length) {
      const parents = await attendanceRepo.getNoticeRecipients(db, [studentId]);
      for (const [template, rule] of wants) {
        for (const parent of parents) {
          if (rule?.audience === 'primary_parent' && !parent.is_primary) continue;
          if (!parent.phone && !parent.email) continue;
          const vars = { studentName: student.name, className: label, schoolName, date: local.date, time: local.time };
          outbox.push({
            tenant_id: student.tenant_id,
            branch_id: student.branch_id,
            student_id: studentId,
            parent_user_id: parent.parent_user_id,
            channel: parent.phone ? 'sms' : 'email',
            recipient: parent.phone ?? parent.email,
            template,
            payload: { date: local.date, sectionId: student.section_id, studentName: student.name, className: label, schoolName, phone: parent.phone ?? null, email: parent.email ?? null, vars, source: 'device' },
            message: `${template}: ${student.name} ${local.date} ${local.time}`,
            dedupe_key: `${template}:${studentId}:${local.date}:${parent.parent_user_id}`,
            created_by: null,
            next_attempt_at: sendAtFor(rule?.timing, { timeZone: punch.zone, date: local.date }).toISOString(),
          });
        }
      }
      await attendanceRepo.enqueueNotifications(db, outbox);
    }
    return { result: newStatus, studentId, detail: before === 'absent' ? 'Was marked absent; changed to late' : null, queued: outbox.length };
  });
  if (result.queued) kickDispatcher();
  return result;
}

async function staffPunch(device, punch, staffId, rules) {
  const { local, at } = punch;
  return withTransaction(async (db) => {
    const { rows: [existing] } = await db.query(
      `SELECT id, check_in_at, check_out_at, status FROM staff_attendance WHERE staff_id = $1 AND attendance_date = $2 FOR UPDATE`,
      [staffId, local.date],
    );
    if (!existing) {
      const status = local.time > rules.staffLateAfter ? 'late' : 'present';
      await db.query(
        `INSERT INTO staff_attendance (tenant_id, branch_id, staff_id, attendance_date, status, check_in_at, source, remarks)
         VALUES ($1, $2, $3, $4, $5::staff_att_status, $6, $7::attendance_source, $8)`,
        [device.tenant_id, device.branch_id, staffId, local.date, status, at, SOURCE[device.kind] ?? 'biometric', `${device.name}`],
      );
      return { result: 'staff_in', staffId, detail: status === 'late' ? `Late check-in at ${local.time}` : `Check-in at ${local.time}` };
    }
    if (['leave', 'absent'].includes(existing.status) && !existing.check_in_at) {
      return { result: 'already_marked', staffId, detail: `Marked ${existing.status} for the day` };
    }
    const sinceIn = existing.check_in_at ? (at.getTime() - new Date(existing.check_in_at).getTime()) / 60_000 : Infinity;
    if (existing.check_in_at && at < new Date(existing.check_in_at)) {
      await db.query(`UPDATE staff_attendance SET check_in_at = $2 WHERE id = $1`, [existing.id, at]); // an earlier punch arrived late (offline device)
      return { result: 'staff_in', staffId, detail: `Earlier check-in at ${local.time}` };
    }
    if (sinceIn < rules.minGapMinutes) return { result: 'duplicate', staffId, detail: `Within ${rules.minGapMinutes} minutes of the check-in` };
    await db.query(`UPDATE staff_attendance SET check_out_at = GREATEST(COALESCE(check_out_at, $2), $2) WHERE id = $1`, [existing.id, at]);
    return { result: 'staff_out', staffId, detail: `Check-out at ${local.time}` };
  });
}

// ------------------------------------------------------------------ cut-off: absent for no punch

/**
 * At the cut-off: in every current section of the branch whose register was NOT taken today,
 * students without a mark are marked absent (and parents told, per the absence rule), and the
 * register is recorded as submitted by the system. Registers a teacher already took are left alone.
 */
export async function finalizeDeviceDay({ tenantId, branchId, date }) {
  const notifier = getNotifier({ env, logger });
  const absentRule = await notifier.ruleFor(tenantId, 'absentee_alert', branchId);
  const { rows: sections } = await pool.query(
    `SELECT s.id FROM sections s
       JOIN academic_years ay ON ay.id = s.academic_year_id AND ay.is_current
      WHERE s.branch_id = $1 AND s.deleted_at IS NULL AND s.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM attendance_submissions sub WHERE sub.section_id = s.id AND sub.attendance_date = $2)`,
    [branchId, date],
  );
  const summary = { sections: 0, absent: 0, notified: 0 };
  for (const { id: sectionId } of sections) {
    const done = await withTransaction(async (db) => {
      const ctx = await attendanceRepo.getSectionContext(db, sectionId, null);
      if (!ctx || date < iso(ctx.year_start) || date > iso(ctx.year_end)) return null;
      await attendanceRepo.lockSectionDay(db, sectionId, date);
      const roster = await attendanceRepo.getRoster(db, sectionId, date);
      if (roster.length === 0) return null;
      // Only sections where the devices are in use today (at least one punch-based mark), so a
      // class that never uses cards is not marked absent wholesale.
      if (!roster.some((r) => r.status)) return null;
      const missing = roster.filter((r) => !r.status);
      if (missing.length) {
        await attendanceRepo.upsertAttendance(db, ctx, {
          date,
          records: missing.map((r) => ({ studentId: r.student_id, status: 'absent', remarks: 'No punch by the cut-off' })),
          markedBy: null,
        });
      }
      const all = await attendanceRepo.previousStatuses(db, roster.map((r) => r.student_id), date);
      const counts = { total: roster.length, present: 0, absent: 0, other: 0 };
      for (const status of all.values()) {
        if (status === 'present') counts.present += 1;
        else if (status === 'absent') counts.absent += 1;
        else counts.other += 1;
      }
      await attendanceRepo.upsertSubmission(db, ctx, { date, counts, userId: null });

      let queued = 0;
      if (missing.length && (absentRule?.enabled ?? true)) {
        const parents = await attendanceRepo.getNoticeRecipients(db, missing.map((r) => r.student_id));
        const schoolName = `${ctx.school_name}, ${ctx.branch_name}`;
        const label = `${ctx.class_name} ${ctx.name}`;
        const outbox = parents
          .filter((p) => (p.phone || p.email) && (absentRule?.audience !== 'primary_parent' || p.is_primary))
          .map((p) => ({
            tenant_id: ctx.tenant_id,
            branch_id: ctx.branch_id,
            student_id: p.student_id,
            parent_user_id: p.parent_user_id,
            channel: p.phone ? 'sms' : 'email',
            recipient: p.phone ?? p.email,
            template: 'attendance_absent',
            payload: { date, sectionId: ctx.id, status: 'absent', studentName: p.student_name, className: label, schoolName, phone: p.phone ?? null, email: p.email ?? null, source: 'device_cutoff' },
            message: `Absent (no punch by cut-off): ${p.student_name} ${date}`,
            dedupe_key: `attendance_absent:${p.student_id}:${date}:${p.parent_user_id}`,
            created_by: null,
            next_attempt_at: sendAtFor(absentRule?.timing, { timeZone: safeZone(ctx.timezone), date }).toISOString(),
          }));
        queued = (await attendanceRepo.enqueueNotifications(db, outbox)).length;
      }
      return { absent: missing.length, queued };
    });
    if (done) {
      summary.sections += 1;
      summary.absent += done.absent;
      summary.notified += done.queued;
    }
  }
  if (summary.notified) kickDispatcher();
  return summary;
}

const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
