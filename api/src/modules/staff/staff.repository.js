import { query } from '../../db/pool.js';

const SELECT = `
  SELECT sf.id, sf.user_id, sf.tenant_id, sf.branch_id, u.first_name, u.last_name,
         concat_ws(' ', u.first_name, u.last_name) AS name, u.email, u.phone, u.role,
         sf.employee_code, sf.designation, sf.department, sf.date_of_joining, sf.status,
         COALESCE((SELECT json_agg(json_build_object('sectionId', s.id, 'label', c.name || ' ' || s.name) ORDER BY c.display_order, s.name)
                     FROM sections s
                     JOIN classes c ON c.id = s.class_id
                     JOIN academic_years ay ON ay.id = s.academic_year_id AND ay.is_current
                    WHERE s.class_teacher_id = sf.id AND s.deleted_at IS NULL), '[]'::json) AS class_teacher_of,
         COALESCE((SELECT json_agg(json_build_object('sectionId', s.id, 'sectionLabel', c.name || ' ' || s.name,
                                                     'subjectId', sub.id, 'subjectName', sub.name)
                                   ORDER BY c.display_order, c.name, s.name, sub.display_order, sub.name)
                     FROM teacher_subject_assignments a
                     JOIN academic_years ay ON ay.id = a.academic_year_id AND ay.is_current
                     JOIN sections s  ON s.id = a.section_id AND s.deleted_at IS NULL
                     JOIN classes c   ON c.id = s.class_id
                     JOIN subjects sub ON sub.id = a.subject_id
                    WHERE a.staff_id = sf.id), '[]'::json) AS subjects
    FROM staff_profiles sf
    JOIN users u ON u.id = sf.user_id`;

export async function listStaff(scope) {
  const { rows } = await query(
    `${SELECT}
      WHERE sf.deleted_at IS NULL AND u.deleted_at IS NULL
        AND ($1::uuid IS NULL OR sf.tenant_id = $1) AND ($2::uuid[] IS NULL OR sf.branch_id = ANY ($2))
      ORDER BY sf.status, u.first_name, u.last_name`,
    [scope.tenantId, scope.branchIds],
  );
  return rows;
}

export async function getStaff(db, id) {
  const { rows } = await db.query(`${SELECT} WHERE sf.id = $1 AND sf.deleted_at IS NULL`, [id]);
  return rows[0] ?? null;
}

export async function emailTaken(db, tenantId, email) {
  const { rows } = await db.query(`SELECT 1 FROM users WHERE tenant_id = $1 AND email = $2 AND deleted_at IS NULL`, [tenantId, email]);
  return rows.length > 0;
}

export async function employeeCodes(db, branchId) {
  const { rows } = await db.query(`SELECT employee_code FROM staff_profiles WHERE branch_id = $1 ORDER BY created_at DESC LIMIT 500`, [branchId]);
  return rows.map((r) => r.employee_code);
}

export async function employeeCodeTaken(db, branchId, code) {
  const { rows } = await db.query(`SELECT 1 FROM staff_profiles WHERE branch_id = $1 AND lower(employee_code) = lower($2)`, [branchId, code]);
  return rows.length > 0;
}

export async function insertStaff(db, s) {
  const { rows: [user] } = await db.query(
    `INSERT INTO users (tenant_id, branch_id, role, email, phone, password_hash, first_name, last_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [s.tenantId, s.branchId, s.role, s.email, s.phone ?? null, s.passwordHash, s.firstName, s.lastName],
  );
  const { rows: [staff] } = await db.query(
    `INSERT INTO staff_profiles (user_id, tenant_id, branch_id, employee_code, designation, department, date_of_joining)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::date, (now() AT TIME ZONE (SELECT timezone FROM tenants WHERE id = $2))::date))
     RETURNING id`,
    [user.id, s.tenantId, s.branchId, s.employeeCode, s.designation, s.department ?? null, s.dateOfJoining ?? null],
  );
  return staff.id;
}

export async function updateStaff(db, row, patch) {
  const sets = [];
  const params = [row.id];
  for (const [key, column] of [['designation', 'designation'], ['department', 'department'], ['status', 'status']]) {
    if (patch[key] !== undefined) {
      params.push(patch[key]);
      sets.push(`${column} = $${params.length}${key === 'status' ? '::record_status' : ''}`);
    }
  }
  if (sets.length) await db.query(`UPDATE staff_profiles SET ${sets.join(', ')} WHERE id = $1`, params);

  const userSets = [];
  const userParams = [row.user_id];
  if (patch.phone !== undefined) { userParams.push(patch.phone); userSets.push(`phone = $${userParams.length}`); }
  // An inactive staff member cannot sign in (authenticate checks users.status).
  if (patch.status !== undefined) { userParams.push(patch.status); userSets.push(`status = $${userParams.length}::record_status`); }
  if (userSets.length) await db.query(`UPDATE users SET ${userSets.join(', ')} WHERE id = $1`, userParams);
}
