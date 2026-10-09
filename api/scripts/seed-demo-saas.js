#!/usr/bin/env node
/**
 * Demo data for the SaaS settings engine. Runs from scripts/seed-demo-modules.js on every release;
 * idempotent. Only when SEED_DEMO=true and the "demo" school exists.
 *
 *  - The demo school is on the Premium plan (active), so every module can be tried.
 *  - A platform administrator (no school) for the platform console: platform@demo.school,
 *    password = DEMO_PASSWORD. Created once; a changed password is never overwritten.
 *  - A gate app device in the demo branch. Its key is never logged: an admin gets one with
 *    "New key" under Settings -> Devices.
 */
import bcrypt from 'bcryptjs';
import { pool } from '../src/db/pool.js';
import { logger } from '../src/utils/logger.js';
import { newDeviceKey } from '../src/modules/devices/punch.service.js';

if (process.env.SEED_DEMO !== 'true') {
  logger.info('Demo SaaS seed skipped (SEED_DEMO is not "true")');
  process.exit(0);
}
const password = process.env.DEMO_PASSWORD ?? '';
if (password.length < 10) {
  logger.error('DEMO_PASSWORD must be set (at least 10 characters)');
  process.exit(1);
}

const { rows: [tenant] } = await pool.query(`SELECT id FROM tenants WHERE code = 'demo' AND deleted_at IS NULL`);
if (!tenant) {
  logger.info('Demo SaaS seed skipped (no demo school)');
  await pool.end();
  process.exit(0);
}

const summary = {};
const { rowCount: sub } = await pool.query(
  `INSERT INTO tenant_subscriptions (tenant_id, plan_id, status, notes)
   SELECT $1, id, 'active', 'Demo school' FROM plans WHERE code = 'premium'
   ON CONFLICT (tenant_id) DO NOTHING`,
  [tenant.id],
);
summary.subscription = sub ? 'created (premium)' : 'kept';

const { rows: [admin] } = await pool.query(`SELECT id FROM users WHERE tenant_id IS NULL AND email = 'platform@demo.school' AND deleted_at IS NULL`);
if (!admin) {
  await pool.query(
    `INSERT INTO users (tenant_id, role, email, first_name, last_name, password_hash, password_set_at)
     VALUES (NULL, 'super_admin', 'platform@demo.school', 'Platform', 'Admin', $1, now())`,
    [await bcrypt.hash(password, 12)],
  );
  summary.platformAdmin = 'created: platform@demo.school (no school code)';
} else summary.platformAdmin = 'kept';

const { rows: [device] } = await pool.query(`SELECT id FROM attendance_devices WHERE tenant_id = $1 AND name = 'Main gate app' AND deleted_at IS NULL`, [tenant.id]);
if (!device) {
  const { rows: [branch] } = await pool.query(`SELECT id FROM branches WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY is_head_office DESC LIMIT 1`, [tenant.id]);
  const key = newDeviceKey();
  await pool.query(
    `INSERT INTO attendance_devices (tenant_id, branch_id, name, kind, protocol, api_key_hash, api_key_prefix, location, applies_to)
     VALUES ($1, $2, 'Main gate app', 'gate_app', 'http', $3, $4, 'Main gate', 'both')`,
    [tenant.id, branch.id, key.hash, key.prefix],
  );
  summary.device = 'created (its key is not shown: use "New key" in Settings -> Devices)';
} else summary.device = 'kept';

logger.info('Demo SaaS seed done', summary);
await pool.end();
process.exit(0);
