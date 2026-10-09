#!/usr/bin/env node
/**
 * Creates (or resets the password of) an SM ERP platform administrator: a super_admin with no
 * school, who manages plans and onboards schools in the platform console.
 *
 *   node scripts/create-platform-admin.js you@company.in "First" "Last"
 *
 * Prints a temporary password once; it must be changed at first sign-in. Sign in with the email
 * and an empty school code.
 */
import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { pool } from '../src/db/pool.js';
import { temporaryPassword } from '../src/modules/auth/login-id.js';

const [email, firstName = 'Platform', lastName = 'Admin'] = process.argv.slice(2);
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage: node scripts/create-platform-admin.js <email> [first name] [last name]');
  process.exit(1);
}
const password = temporaryPassword(randomInt);
const hash = await bcrypt.hash(password, 12);
const { rows: [existing] } = await pool.query(`SELECT id, role FROM users WHERE tenant_id IS NULL AND email = $1 AND deleted_at IS NULL`, [email]);
if (existing) {
  if (existing.role !== 'super_admin') {
    console.error(`${email} exists but is not a platform administrator`);
    process.exit(1);
  }
  await pool.query(
    `UPDATE users SET password_hash = $2, must_change_password = true, password_set_at = now(), password_changed_at = now(), failed_login_attempts = 0, locked_until = NULL WHERE id = $1`,
    [existing.id, hash],
  );
  console.log(`Password reset for ${email}.`);
} else {
  await pool.query(
    `INSERT INTO users (tenant_id, role, email, first_name, last_name, password_hash, must_change_password, password_set_at)
     VALUES (NULL, 'super_admin', $1, $2, $3, $4, true, now())`,
    [email, firstName, lastName, hash],
  );
  console.log(`Platform administrator ${email} created.`);
}
console.log(`Temporary password (shown once): ${password}`);
console.log('Sign in with this email and no school code; you will be asked to set your own password.');
await pool.end();
