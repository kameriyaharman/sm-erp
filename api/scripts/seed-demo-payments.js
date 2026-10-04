#!/usr/bin/env node
/**
 * Demo data for online payments and portal logins. Runs from scripts/seed-demo-modules.js on every
 * release; idempotent and safe on the live database. Only when SEED_DEMO=true and the "demo" school exists.
 *
 *  - Student login for Aarav Sharma (parent@demo.school's child): school code demo, login = his
 *    admission number (any case), password = DEMO_PASSWORD. Set only while he has never had a
 *    password, so a password changed on the live demo is never overwritten.
 *  - The demo staff / parent logins show as "has a login" in Settings -> Portal logins.
 *  - The demo school's Razorpay account is deliberately NOT configured: the school enters its own
 *    test keys in Settings -> Online payments.
 *  - Three sample gateway orders (two failed attempts, one abandoned Checkout) so Fees -> Online
 *    payments isn't empty. They are marked as samples (ids order_DEMO..., reason text), never sent
 *    to Razorpay and move no money: no receipts, no ledger rows, invoices untouched. Paid samples
 *    are not seeded because they would need receipts for money that never moved.
 */
import bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { env } from '../src/config/env.js';
import { pool, withTransaction } from '../src/db/pool.js';
import { logger } from '../src/utils/logger.js';

if (process.env.SEED_DEMO !== 'true') {
  logger.info('Demo payments seed skipped (SEED_DEMO is not "true")');
  process.exit(0);
}
const password = process.env.DEMO_PASSWORD ?? '';
if (password.length < 10) {
  logger.error('DEMO_PASSWORD must be set (at least 10 characters)');
  process.exit(1);
}

const { rows: [tenant] } = await pool.query(`SELECT id FROM tenants WHERE code = 'demo' AND deleted_at IS NULL`);
if (!tenant) {
  logger.info('Demo payments seed skipped (no demo school)');
  await pool.end();
  process.exit(0);
}
const T = tenant.id;
const DEMO_LOGINS = ['owner@demo.school', 'admin@demo.school', 'teacher@demo.school', 'parent@demo.school'];

const result = { studentLogin: null, markedLogins: 0, sampleOrders: 0 };

// ------------------------------------------------------------ Aarav's student login
const { rows: [aarav] } = await pool.query(
  `SELECT sp.id, sp.admission_number, u.id AS user_id, u.password_set_at
     FROM student_profiles sp
     JOIN users u  ON u.id = sp.user_id
     JOIN users pu ON pu.id = sp.parent_id
    WHERE sp.tenant_id = $1 AND pu.email = 'parent@demo.school' AND u.first_name = 'Aarav' AND sp.deleted_at IS NULL
    ORDER BY sp.admission_number
    LIMIT 1`,
  [T],
);
if (aarav) {
  if (!aarav.password_set_at) {
    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      `UPDATE users SET password_hash = $2, password_set_at = now(), must_change_password = false, failed_login_attempts = 0, locked_until = NULL
        WHERE id = $1 AND password_set_at IS NULL`,
      [aarav.user_id, hash],
    );
    result.studentLogin = 'created';
  } else {
    result.studentLogin = 'exists';
  }
  result.studentLoginId = aarav.admission_number;
}

// ------------------------------------------------------------ demo logins count as "has a login"
const marked = await pool.query(
  `UPDATE users SET password_set_at = now() WHERE tenant_id = $1 AND email = ANY ($2::citext[]) AND password_set_at IS NULL AND deleted_at IS NULL`,
  [T, DEMO_LOGINS],
);
result.markedLogins = marked.rowCount;

// ------------------------------------------------------------ sample orders (once)
const { rows: [{ n: existing }] } = await pool.query(
  `SELECT count(*)::int AS n FROM payment_orders WHERE tenant_id = $1 AND gateway_order_id LIKE 'order_DEMO%'`,
  [T],
);
if (existing === 0) {
  // Students with an open bill, other than the demo parent's own children (their fee screens stay clean).
  const { rows: open } = await pool.query(
    `SELECT DISTINCT ON (i.student_id) i.id AS invoice_id, i.student_id, i.branch_id, i.balance_amount::text AS balance, sp.parent_id
       FROM fee_invoices i
       JOIN student_profiles sp ON sp.id = i.student_id
       JOIN users pu ON pu.id = sp.parent_id
      WHERE i.tenant_id = $1 AND i.status IN ('unpaid', 'partially_paid') AND i.balance_amount > 0
        AND pu.email IS DISTINCT FROM 'parent@demo.school'
      ORDER BY i.student_id, i.due_date
      LIMIT 3`,
    [T],
  );
  const samples = [
    { status: 'failed', ago: '6 days', reason: 'Sample record (demo school): card declined by the issuing bank. No money moved.' },
    { status: 'failed', ago: '2 days', reason: 'Sample record (demo school): UPI request timed out in the payer\'s app. No money moved.' },
    { status: 'created', ago: '1 day', reason: null },   // abandoned Checkout -> shows as "expired"
  ];
  await withTransaction(async (db) => {
    for (const [i, inv] of open.entries()) {
      const s = samples[i];
      const id = randomUUID();
      await db.query(
        `INSERT INTO payment_orders
                (id, tenant_id, branch_id, student_id, gateway, gateway_order_id, receipt_ref, amount, currency, status,
                 created_by, created_at, expires_at, gateway_mode, failure_reason)
         VALUES ($1, $2, $3, $4, 'razorpay', $5, $6, $7, 'INR', $8::payment_order_status, $9,
                 now() - $10::interval, now() - $10::interval + interval '30 minutes', 'test', $11)`,
        [id, T, inv.branch_id, inv.student_id, `order_DEMO${randomBytes(6).toString('hex')}`, `sm_demo_${randomBytes(8).toString('hex')}`,
          inv.balance, s.status, inv.parent_id, s.ago, s.reason],
      );
      await db.query(`INSERT INTO payment_order_items (order_id, invoice_id, branch_id, amount) VALUES ($1, $2, $3, $4)`, [id, inv.invoice_id, inv.branch_id, inv.balance]);
      result.sampleOrders += 1;
    }
  });
}

logger.info('Demo payments seed done', { ...result, gateway: 'not configured (enter test keys in Settings -> Online payments)' });
await pool.end();
void env; // imported for its validation side effect
