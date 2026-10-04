import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from '../../config/env.js';
import { pool, withTransaction } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { resolveBranchScope } from '../../middleware/scope.js';
import { passwordProblems, phone10, temporaryPassword } from '../auth/login-id.js';

/**
 * Settings -> Portal logins: which parents and students can sign in to the family portal, and
 * issuing passwords for them.
 *
 *   Parent login id   mobile number (any of 9810055555 / +91 98100 55555 / 09810055555), or email
 *   Student login id  admission number (case-insensitive), or username
 *
 * A generated password is temporary: it is returned ONCE (never stored in clear, never logged)
 * and the user must set their own at first sign-in (users.must_change_password).
 *
 * Login status (users):
 *   none       password_set_at IS NULL (created at admission with a random placeholder)
 *   temporary  must_change_password
 *   active     has a password of their own
 *   locked     too many failed attempts (locked_until in the future)
 *   inactive   account deactivated
 */

const TEMP_COST = 10;   // temporary passwords are replaced at first sign-in; keeps a class-wide batch quick
const OWN_COST = 12;
const BULK_MAX = 300;

const STATUS_SQL = (u) => `CASE WHEN ${u}.status <> 'active' THEN 'inactive'
                              WHEN ${u}.password_set_at IS NULL THEN 'none'
                              WHEN ${u}.locked_until > now() THEN 'locked'
                              WHEN ${u}.must_change_password THEN 'temporary'
                              ELSE 'active' END`;

/** One row whatever the filters: status counts over `base`, the filtered total, and one page of rows (json). */
const PAGE_SQL = (orderBy) => `
  SELECT (SELECT json_object_agg(st, n) FROM (SELECT st, count(*) AS n FROM base GROUP BY st) x) AS counts,
         (SELECT count(*)::int FROM base WHERE $6::text IS NULL OR st = $6) AS total,
         COALESCE((SELECT json_agg(p) FROM (SELECT * FROM base WHERE $6::text IS NULL OR st = $6 ${orderBy} LIMIT $7 OFFSET $8) p), '[]'::json) AS rows`;

const escapeLike = (s) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export function portalUrl(req) {
  if (env.PARENT_PORTAL_URL) return `${new URL(env.PARENT_PORTAL_URL).origin}/login`;
  return `${req.protocol}://${req.get('x-forwarded-host') ?? req.get('host')}/login`;
}

const parentLoginId = (r) => phone10(r.phone) ?? r.email ?? r.username;

// =====================================================================
// GET /portal-access
// =====================================================================

export async function listPortalAccess(auth, q) {
  const scope = await resolveBranchScope(auth);
  const { rows: [tenant] } = auth.tenantId ? await pool.query(`SELECT code, name FROM tenants WHERE id = $1`, [auth.tenantId]) : { rows: [] };
  const schoolCode = tenant?.code ?? null;
  const schoolName = tenant?.name ?? null;
  const search = q.search ? `%${escapeLike(q.search)}%` : null;
  const digits = q.search && /^[+\d\s-]{4,}$/.test(q.search) ? q.search.replace(/\D/g, '').slice(-10) : null;
  const offset = (q.page - 1) * q.limit;

  if (q.type === 'student') {
    const { rows } = await pool.query(
      `WITH base AS (
         SELECT u.id AS user_id, sp.id AS student_id, concat_ws(' ', u.first_name, u.last_name) AS name, sp.admission_number,
                u.username, c.name AS class_name, sec.name AS section_name, b.name AS branch_name, c.numeric_level, sp.roll_number,
                u.last_login_at, u.password_set_at, u.must_change_password, ${STATUS_SQL('u')} AS st
           FROM student_profiles sp
           JOIN users u           ON u.id = sp.user_id AND u.deleted_at IS NULL
           JOIN branches b        ON b.id = sp.branch_id
           LEFT JOIN classes c    ON c.id = sp.class_id
           LEFT JOIN sections sec ON sec.id = sp.section_id
          WHERE sp.deleted_at IS NULL AND sp.status IN ('enrolled', 'suspended')
            AND ($1::uuid IS NULL OR sp.tenant_id = $1) AND ($2::uuid[] IS NULL OR sp.branch_id = ANY ($2))
            AND ($3::uuid IS NULL OR sp.class_id = $3) AND ($4::uuid IS NULL OR sp.section_id = $4)
            AND ($5::text IS NULL OR concat_ws(' ', u.first_name, u.last_name) ILIKE $5 OR sp.admission_number ILIKE $5 OR u.username ILIKE $5)
       )
       ${PAGE_SQL('ORDER BY numeric_level NULLS LAST, class_name, section_name, name')}`,
      [scope.tenantId, scope.branchIds, q.classId ?? null, q.sectionId ?? null, search, q.status ?? null, q.limit, offset],
    );
    return page(rows[0], q, { schoolCode, schoolName }, (r) => ({
      userId: r.user_id,
      type: 'student',
      name: r.name,
      loginId: r.admission_number,
      status: r.st,
      lastLoginAt: r.last_login_at,
      passwordSetAt: r.password_set_at,
      student: {
        id: r.student_id,
        admissionNumber: r.admission_number,
        username: r.username,
        classLabel: [r.class_name, r.section_name].filter(Boolean).join(' '),
        branchName: r.branch_name,
      },
    }));
  }

  const { rows } = await pool.query(
    `WITH links AS (
       SELECT sp.parent_id AS user_id, sp.id AS student_id FROM student_profiles sp
        WHERE sp.parent_id IS NOT NULL AND sp.deleted_at IS NULL AND sp.status IN ('enrolled', 'suspended')
       UNION
       SELECT g.guardian_user_id, g.student_id FROM student_guardians g
         JOIN student_profiles sp ON sp.id = g.student_id AND sp.deleted_at IS NULL AND sp.status IN ('enrolled', 'suspended')
     ),
     kids AS (
       SELECT l.user_id, sp.id AS student_id, sp.class_id, sp.section_id, sp.admission_number,
              concat_ws(' ', su.first_name, su.last_name) AS name, c.name AS class_name, sec.name AS section_name, c.numeric_level
         FROM links l
         JOIN student_profiles sp ON sp.id = l.student_id
         JOIN users su            ON su.id = sp.user_id
         LEFT JOIN classes c      ON c.id = sp.class_id
         LEFT JOIN sections sec   ON sec.id = sp.section_id
        WHERE ($1::uuid IS NULL OR sp.tenant_id = $1) AND ($2::uuid[] IS NULL OR sp.branch_id = ANY ($2))
     ),
     base AS (
       SELECT u.id AS user_id, concat_ws(' ', u.first_name, u.last_name) AS name, u.phone, u.email, u.username,
              u.last_login_at, u.password_set_at, u.must_change_password, ${STATUS_SQL('u')} AS st,
              (SELECT json_agg(json_build_object('id', k.student_id, 'name', k.name, 'admissionNumber', k.admission_number,
                                                 'classLabel', concat_ws(' ', k.class_name, k.section_name))
                               ORDER BY k.numeric_level NULLS LAST, k.name)
                 FROM kids k WHERE k.user_id = u.id) AS children,
              (SELECT min(k.numeric_level) FROM kids k WHERE k.user_id = u.id) AS sort_level
         FROM users u
        WHERE u.deleted_at IS NULL AND u.role = 'parent'
          AND EXISTS (SELECT 1 FROM kids k WHERE k.user_id = u.id
                        AND ($3::uuid IS NULL OR k.class_id = $3) AND ($4::uuid IS NULL OR k.section_id = $4))
          AND ($5::text IS NULL OR concat_ws(' ', u.first_name, u.last_name) ILIKE $5 OR u.email ILIKE $5
               OR ($9::text IS NOT NULL AND regexp_replace(u.phone, '\\D', '', 'g') LIKE '%' || $9 || '%')
               OR EXISTS (SELECT 1 FROM kids k WHERE k.user_id = u.id AND (k.name ILIKE $5 OR k.admission_number ILIKE $5)))
     )
     ${PAGE_SQL('ORDER BY sort_level NULLS LAST, name')}`,
    [scope.tenantId, scope.branchIds, q.classId ?? null, q.sectionId ?? null, search, q.status ?? null, q.limit, offset, digits],
  );
  return page(rows[0], q, { schoolCode, schoolName }, (r) => ({
    userId: r.user_id,
    type: 'parent',
    name: r.name,
    loginId: parentLoginId(r),
    status: r.st,
    lastLoginAt: r.last_login_at,
    passwordSetAt: r.password_set_at,
    phone: r.phone,
    email: r.email,
    children: r.children ?? [],
  }));
}

function page(result, q, school, map) {
  return {
    data: result.rows.map(map),
    meta: {
      ...school,
      page: q.page,
      limit: q.limit,
      total: result.total,
      totalPages: Math.ceil(result.total / q.limit),
      counts: { none: 0, temporary: 0, active: 0, locked: 0, inactive: 0, ...(result.counts ?? {}) },
    },
  };
}

// =====================================================================
// Access to one account
// =====================================================================

/** The parent/student account an admin may manage, or 404. */
async function loadManagedUser(db, auth, userId) {
  const scope = await resolveBranchScope(auth);
  const { rows: [u] } = await db.query(
    `SELECT u.id, u.tenant_id, u.role, u.status, u.phone, u.email, u.username, concat_ws(' ', u.first_name, u.last_name) AS name,
            t.code AS school_code, t.name AS school_name,
            sp.admission_number, sp.branch_id AS student_branch_id,
            concat_ws(' ', c.name, sec.name) AS class_label
       FROM users u
       JOIN tenants t                ON t.id = u.tenant_id
       LEFT JOIN student_profiles sp ON sp.user_id = u.id AND sp.deleted_at IS NULL
       LEFT JOIN classes c           ON c.id = sp.class_id
       LEFT JOIN sections sec        ON sec.id = sp.section_id
      WHERE u.id = $1 AND u.deleted_at IS NULL AND u.role IN ('parent', 'student')
        AND ($2::uuid IS NULL OR u.tenant_id = $2)`,
    [userId, scope.tenantId],
  );
  const notFound = () => AppError.notFound('Account not found', 'USER_NOT_FOUND');
  if (!u) throw notFound();
  if (u.role === 'student') {
    if (scope.branchIds && !scope.branchIds.includes(u.student_branch_id)) throw notFound();
    return u;
  }
  // A parent is in scope when one of their children is.
  const { rows } = await db.query(
    `SELECT concat_ws(' ', su.first_name, su.last_name) AS name, concat_ws(' ', c.name, sec.name) AS class_label, sp.admission_number
       FROM student_profiles sp
       JOIN users su          ON su.id = sp.user_id
       LEFT JOIN classes c    ON c.id = sp.class_id
       LEFT JOIN sections sec ON sec.id = sp.section_id
      WHERE sp.deleted_at IS NULL AND sp.tenant_id = $2 AND ($3::uuid[] IS NULL OR sp.branch_id = ANY ($3))
        AND (sp.parent_id = $1 OR EXISTS (SELECT 1 FROM student_guardians g WHERE g.student_id = sp.id AND g.guardian_user_id = $1))
      ORDER BY c.numeric_level NULLS LAST, su.first_name`,
    [userId, u.tenant_id, scope.branchIds],
  );
  if (rows.length === 0) throw notFound();
  return { ...u, children: rows.map((r) => ({ name: r.name, classLabel: r.class_label, admissionNumber: r.admission_number })) };
}

function slipFor(u, password) {
  const isStudent = u.role === 'student';
  return {
    userId: u.id,
    type: u.role,
    name: u.name,
    loginId: isStudent ? u.admission_number ?? u.username : parentLoginId(u),
    // Other ids that also work (shown small on the slip).
    alsoWorks: isStudent ? [u.username].filter((x) => x && x.toLowerCase() !== String(u.admission_number).toLowerCase()) : [phone10(u.phone) && u.email].filter(Boolean),
    classLabel: isStudent ? u.class_label : null,
    children: isStudent ? undefined : u.children,
    password,
  };
}

/** Writes a new password for one account (inside the caller's transaction). Ends all its sessions. */
async function writePassword(db, userId, hash, mustChange) {
  await db.query(
    `UPDATE users
        SET password_hash = $2, must_change_password = $3, password_set_at = now(), password_changed_at = now(),
            failed_login_attempts = 0, locked_until = NULL
      WHERE id = $1`,
    [userId, hash, mustChange],
  );
  await db.query(
    `UPDATE auth_refresh_tokens SET revoked_at = now(), revoked_reason = 'password_reset' WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
}

// =====================================================================
// POST /portal-access/:userId/reset
// =====================================================================

export async function resetPassword(auth, userId, input, { logger, portalUrl: url }) {
  const u = await loadManagedUser(pool, auth, userId);
  if (u.status !== 'active') {
    throw new AppError(409, 'ACCOUNT_INACTIVE', 'This account is deactivated. Re-activate the student or parent first.');
  }

  let password;
  let generated = false;
  if (input.password) {
    const problems = passwordProblems(input.password, { loginIds: [phone10(u.phone), u.email?.split('@')[0], u.username, u.admission_number] });
    if (problems.length) throw new AppError(422, 'WEAK_PASSWORD', problems[0], { body: { password: problems } });
    password = input.password;
  } else {
    password = temporaryPassword(randomInt);
    generated = true;
  }
  const mustChange = generated ? true : input.mustChange;
  const hash = await bcrypt.hash(password, mustChange ? TEMP_COST : OWN_COST);
  await withTransaction((db) => writePassword(db, u.id, hash, mustChange));

  logger?.info('Portal password reset', { userId: u.id, role: u.role, generated, mustChange, by: auth.userId });
  return {
    schoolCode: u.school_code,
    schoolName: u.school_name,
    portalUrl: url,
    mustChangePassword: mustChange,
    // The password is in the response only when the server generated it (an admin-typed one is already known).
    slip: slipFor(u, generated ? password : null),
  };
}

// =====================================================================
// POST /portal-access/bulk
// =====================================================================

export async function bulkIssue(auth, input, { logger, portalUrl: url }) {
  const scope = await resolveBranchScope(auth);
  const { rows: [cls] } = await pool.query(
    `SELECT c.id, c.name, c.branch_id, c.tenant_id, t.code AS school_code, t.name AS school_name,
            (SELECT s.name FROM sections s WHERE s.id = $2 AND s.class_id = c.id AND s.deleted_at IS NULL) AS section_name
       FROM classes c JOIN tenants t ON t.id = c.tenant_id
      WHERE c.id = $1 AND c.deleted_at IS NULL`,
    [input.classId, input.sectionId ?? null],
  );
  if (!cls || (scope.tenantId && cls.tenant_id !== scope.tenantId) || (scope.branchIds && !scope.branchIds.includes(cls.branch_id))) {
    throw AppError.notFound('Class not found', 'CLASS_NOT_FOUND');
  }
  if (input.sectionId && !cls.section_name) throw AppError.notFound('Section not found', 'SECTION_NOT_FOUND');

  const { rows: targets } = input.type === 'student'
    ? await pool.query(
      `SELECT u.id, u.role, u.phone, u.email, u.username, u.password_set_at, concat_ws(' ', u.first_name, u.last_name) AS name,
              sp.admission_number, concat_ws(' ', c.name, sec.name) AS class_label
         FROM student_profiles sp
         JOIN users u           ON u.id = sp.user_id AND u.deleted_at IS NULL AND u.status = 'active'
         LEFT JOIN classes c    ON c.id = sp.class_id
         LEFT JOIN sections sec ON sec.id = sp.section_id
        WHERE sp.class_id = $1 AND ($2::uuid IS NULL OR sp.section_id = $2) AND sp.deleted_at IS NULL AND sp.status IN ('enrolled', 'suspended')
        ORDER BY sec.name, sp.roll_number NULLS LAST, u.first_name`,
      [cls.id, input.sectionId ?? null],
    )
    : await pool.query(
      `WITH kids AS (
         SELECT sp.id, sp.parent_id AS user_id, sp.roll_number, sec.name AS section_name FROM student_profiles sp
           LEFT JOIN sections sec ON sec.id = sp.section_id
          WHERE sp.class_id = $1 AND ($2::uuid IS NULL OR sp.section_id = $2) AND sp.deleted_at IS NULL AND sp.status IN ('enrolled', 'suspended')
         UNION
         SELECT sp.id, g.guardian_user_id, sp.roll_number, sec.name FROM student_guardians g
           JOIN student_profiles sp ON sp.id = g.student_id
           LEFT JOIN sections sec ON sec.id = sp.section_id
          WHERE sp.class_id = $1 AND ($2::uuid IS NULL OR sp.section_id = $2) AND sp.deleted_at IS NULL AND sp.status IN ('enrolled', 'suspended')
       )
       SELECT u.id, u.role, u.phone, u.email, u.username, u.password_set_at, concat_ws(' ', u.first_name, u.last_name) AS name,
              min(k.section_name) AS section_name, min(k.roll_number) AS roll
         FROM kids k JOIN users u ON u.id = k.user_id AND u.deleted_at IS NULL AND u.status = 'active' AND u.role = 'parent'
        GROUP BY u.id
        ORDER BY min(k.section_name), min(k.roll_number) NULLS LAST, name`,
      [cls.id, input.sectionId ?? null],
    );

  const chosen = input.onlyWithoutLogin ? targets.filter((t) => !t.password_set_at) : targets;
  if (chosen.length > BULK_MAX) {
    throw new AppError(422, 'TOO_MANY', `At most ${BULK_MAX} logins at a time. Pick one section.`);
  }

  // Children for parent slips (only children in this school, in the caller's scope).
  let childrenOf = new Map();
  if (input.type === 'parent' && chosen.length > 0) {
    const { rows } = await pool.query(
      `SELECT x.user_id, json_agg(json_build_object('name', concat_ws(' ', su.first_name, su.last_name),
                                                    'classLabel', concat_ws(' ', c.name, sec.name), 'admissionNumber', sp.admission_number)
                                  ORDER BY c.numeric_level NULLS LAST, su.first_name) AS children
         FROM (SELECT sp.id AS sid, sp.parent_id AS user_id FROM student_profiles sp WHERE sp.parent_id = ANY ($1)
               UNION SELECT g.student_id, g.guardian_user_id FROM student_guardians g WHERE g.guardian_user_id = ANY ($1)) x
         JOIN student_profiles sp ON sp.id = x.sid AND sp.deleted_at IS NULL AND sp.status IN ('enrolled', 'suspended')
                                 AND ($2::uuid[] IS NULL OR sp.branch_id = ANY ($2))
         JOIN users su            ON su.id = sp.user_id
         LEFT JOIN classes c      ON c.id = sp.class_id
         LEFT JOIN sections sec   ON sec.id = sp.section_id
        GROUP BY x.user_id`,
      [chosen.map((t) => t.id), scope.branchIds],
    );
    childrenOf = new Map(rows.map((r) => [r.user_id, r.children]));
  }

  // Hash first (slow on purpose), then write everything in one transaction.
  const prepared = [];
  for (const t of chosen) {
    const password = temporaryPassword(randomInt);
    prepared.push({ t, password, hash: await bcrypt.hash(password, TEMP_COST) });
  }
  await withTransaction(async (db) => {
    for (const p of prepared) await writePassword(db, p.t.id, p.hash, true);
  });

  logger?.info('Portal logins issued', { classId: cls.id, sectionId: input.sectionId ?? null, type: input.type, count: prepared.length, by: auth.userId });
  return {
    schoolCode: cls.school_code,
    schoolName: cls.school_name,
    portalUrl: url,
    classLabel: [cls.name, cls.section_name].filter(Boolean).join(' '),
    issued: prepared.length,
    skipped: targets.length - chosen.length,
    slips: prepared.map(({ t, password }) => slipFor({ ...t, children: childrenOf.get(t.id) ?? [] }, password)),
  };
}
