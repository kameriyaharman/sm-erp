// One-shot fee reminder run for a scheduler (Railway cron, GitHub Actions, crontab):
//   node scripts/run-fee-reminders.js [--days=3] [--no-overdue] [--tenant=<uuid>]
// Safe to run more than once a day: reminders are de-duplicated per student, parent and day.
import { env } from '../src/config/env.js';
import { pool } from '../src/db/pool.js';
import { logger } from '../src/utils/logger.js';
import { getNotifier } from '../src/modules/notifications/index.js';
import { runFeeDueReminders } from '../src/modules/notifications/jobs/fee-reminders.job.js';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

if (!env.PARENT_PORTAL_URL) {
  logger.error('PARENT_PORTAL_URL is not set; reminders need a payment link');
  process.exit(1);
}

const summary = await runFeeDueReminders({
  notifier: getNotifier({ env, logger }),
  portalUrl: env.PARENT_PORTAL_URL,
  tenantId: arg('tenant'),
  daysAhead: arg('days') ? Number(arg('days')) : 3,
  includeOverdue: !process.argv.includes('--no-overdue'),
});
await pool.end();
process.exit(summary.error || summary.failed > 0 ? 1 : 0);
