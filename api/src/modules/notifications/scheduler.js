import { pool } from '../../db/pool.js';
import { localParts, safeZone } from '../../utils/time.js';
import { finalizeDeviceDay } from '../devices/punch.service.js';
import { isModuleEnabled } from '../saas/entitlements.js';
import { getSettings } from '../settings/store.js';
import { dayOff } from '../settings/sections.js';
import { runFeeDueReminders } from './jobs/fee-reminders.job.js';

/**
 * Per-school daily jobs, at the time each school chose:
 *
 *   fee_due_reminder   Notification rules -> Fee due reminder: "send automatically at 09:00, every N days"
 *   birthday_wish      Notification rules -> Birthday wish (when switched on)
 *   attendance_cutoff  Attendance policy -> "mark absent at the cut-off" (device attendance), per branch
 *
 * Every replica ticks; a job runs once per school (and branch) per day because the first replica
 * to insert its scheduled_runs row wins. A job that fails is not retried that day (its row stays,
 * with the error in `summary`), so a broken job can't message parents twice.
 */

async function claim(tenantId, job, runKey) {
  const { rows } = await pool.query(
    `INSERT INTO scheduled_runs (tenant_id, job, run_key) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING started_at`,
    [tenantId, job, runKey],
  );
  return rows.length > 0;
}

async function finish(tenantId, job, runKey, summary) {
  await pool.query(`UPDATE scheduled_runs SET finished_at = now(), summary = $4 WHERE tenant_id = $1 AND job = $2 AND run_key = $3`, [tenantId, job, runKey, JSON.stringify(summary)]);
}

async function lastRunDate(tenantId, job) {
  const { rows } = await pool.query(`SELECT max(left(run_key, 10)) AS d FROM scheduled_runs WHERE tenant_id = $1 AND job = $2`, [tenantId, job]);
  return rows[0]?.d ?? null;
}

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

async function runJob(tenantId, job, runKey, work, logger) {
  if (!(await claim(tenantId, job, runKey))) return;
  let summary;
  try {
    summary = await work();
    logger.info('Scheduled job done', { tenantId, job, runKey, ...summary });
  } catch (err) {
    summary = { error: err.message };
    logger.error('Scheduled job failed', { tenantId, job, runKey, error: err.message });
  }
  await finish(tenantId, job, runKey, summary).catch(() => undefined);
}

async function birthdayWishes({ notifier, tenantId, date, rule }) {
  const [, month, day] = date.split('-').map(Number);
  const { rows } = await pool.query(
    `SELECT sp.id AS student_id, sp.branch_id, concat_ws(' ', su.first_name, su.last_name) AS student_name,
            concat(t.name, ', ', b.name) AS school_name,
            pu.id AS parent_user_id, pu.phone, pu.email, (pu.id = sp.parent_id) AS is_primary
       FROM student_profiles sp
       JOIN users su   ON su.id = sp.user_id
       JOIN tenants t  ON t.id = sp.tenant_id
       JOIN branches b ON b.id = sp.branch_id
       JOIN users pu   ON pu.deleted_at IS NULL AND pu.status = 'active'
                      AND (pu.id = sp.parent_id
                           OR pu.id IN (SELECT g.guardian_user_id FROM student_guardians g WHERE g.student_id = sp.id AND g.receives_notices))
      WHERE sp.tenant_id = $1 AND sp.deleted_at IS NULL AND sp.status = 'enrolled'
        AND extract(month FROM sp.date_of_birth) = $2 AND extract(day FROM sp.date_of_birth) = $3`,
    [tenantId, month, day],
  );
  let sent = 0;
  let failed = 0;
  for (const r of rows) {
    if (rule.audience === 'primary_parent' && !r.is_primary) continue;
    if (!r.phone && !r.email) continue;
    const result = await notifier.sendEvent('birthday_wish', { phone: r.phone, email: r.email }, { studentName: r.student_name, schoolName: r.school_name }, {
      tenantId,
      branchId: r.branch_id,
      studentId: r.student_id,
      recipientUserId: r.parent_user_id,
      dedupeKey: `birthday:${r.student_id}:${date.slice(0, 4)}:${r.parent_user_id}`,
    });
    if (result.ok && !result.skipped) sent += 1;
    else if (!result.ok) failed += 1;
  }
  return { students: new Set(rows.map((r) => r.student_id)).size, sent, failed };
}

/** One pass over all active schools. */
export async function schedulerTick({ notifier, env, logger, now = new Date() }) {
  const { rows: tenants } = await pool.query(`SELECT id, timezone FROM tenants WHERE status = 'active' AND deleted_at IS NULL`);
  for (const tenant of tenants) {
    try {
      const zone = safeZone(tenant.timezone);
      const local = localParts(now, zone);

      // ---- fee reminders
      const fee = await notifier.ruleFor(tenant.id, 'fee_due_reminder');
      const ft = fee?.timing;
      if (fee?.enabled && ft?.mode === 'scheduled' && ft.autoRun && local.time >= ft.time && env.PARENT_PORTAL_URL) {
        const last = await lastRunDate(tenant.id, 'fee_due_reminder');
        const every = Math.max(1, Number(ft.everyDays ?? 1));
        if (!last || daysBetween(last, local.date) >= every) {
          await runJob(tenant.id, 'fee_due_reminder', local.date, async () => {
            const s = await runFeeDueReminders({
              notifier,
              portalUrl: env.PARENT_PORTAL_URL,
              tenantId: tenant.id,
              daysAhead: ft.daysBefore ?? 3,
              includeOverdue: ft.includeOverdue ?? true,
              today: local.date,
              logger,
            });
            return { students: s.students, sent: s.sent, failed: s.failed, alreadySent: s.alreadySent, noPhone: s.noPhone };
          }, logger);
        }
      }

      // ---- birthdays
      const bday = await notifier.ruleFor(tenant.id, 'birthday_wish');
      if (bday?.enabled && bday.timing?.mode === 'scheduled' && local.time >= (bday.timing.time ?? '08:00')) {
        await runJob(tenant.id, 'birthday_wish', local.date, () => birthdayWishes({ notifier, tenantId: tenant.id, date: local.date, rule: bday }), logger);
      }

      // ---- device attendance cut-off, per branch
      if (await isModuleEnabled(tenant.id, 'device_attendance')) {
        const { rows: branches } = await pool.query(
          `SELECT b.id FROM branches b WHERE b.tenant_id = $1 AND b.deleted_at IS NULL AND b.status = 'active'
              AND EXISTS (SELECT 1 FROM attendance_devices d WHERE d.branch_id = b.id AND d.deleted_at IS NULL AND d.status = 'active')`,
          [tenant.id],
        );
        for (const { id: branchId } of branches) {
          const [policy, calendar] = await Promise.all([getSettings(tenant.id, 'attendance', branchId), getSettings(tenant.id, 'calendar', branchId)]);
          if (!policy.device.autoAbsentAtCutoff || local.time < policy.device.cutoff || dayOff(calendar, local.date)) continue;
          await runJob(tenant.id, 'attendance_cutoff', `${local.date}:${branchId}`, () => finalizeDeviceDay({ tenantId: tenant.id, branchId, date: local.date }), logger);
        }
      }
    } catch (err) {
      logger.error('Scheduler error for school', { tenantId: tenant.id, error: err.message });
    }
  }
}

export function startScheduler({ notifier, env, logger, intervalMs = 60_000 }) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await schedulerTick({ notifier, env, logger });
    } catch (err) {
      logger.error('Scheduler tick failed', { error: err.message });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  setTimeout(tick, 5_000).unref();
  logger.info('Scheduler started', { intervalMs });
  return { stop: () => clearInterval(timer), runNow: tick };
}
