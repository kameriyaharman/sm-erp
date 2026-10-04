import { pool, withTransaction } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { assertBranchAccess } from '../../middleware/scope.js';
import { fromPaise } from '../../utils/money.js';
import { logger } from '../../utils/logger.js';
import * as repo from './fees.repository.js';
import { planCharge } from './charges.helpers.js';

/**
 * One-off charges ("extra fee"): exam fee, picnic, lost ID card… billed to one student or to
 * every current student of a class / section, as ONE invoice per student with one ad-hoc line
 * (no fee-structure instalments are pulled in). Same invoice numbering, totals triggers and
 * cache rules as POST /fees/invoices.
 *
 * Idempotent per batch: the client sends a batchId (uuid); each invoice stores it and
 * (batch, student) is unique (migration 15). Re-sending the same batch only bills the
 * students who were not billed yet, so a retry or double click never charges twice.
 */

const unprocessable = (code, message, details) => new AppError(422, code, message, details);

/** A class / section can be billed in one go up to this many students. */
export const MAX_CHARGE_STUDENTS = 2000;

function invoiceNumber(branchCode, yearName, sequence) {
  return `${String(branchCode).toUpperCase()}/INV/${yearName}/${String(sequence).padStart(5, '0')}`;
}

// ---------------------------------------------------------------- queries

const TARGET_SELECT = `
  SELECT sp.id, sp.tenant_id, sp.branch_id, sp.status,
         concat_ws(' ', u.first_name, u.last_name) AS name, sp.admission_number,
         NULLIF(concat_ws(' ', c.name, s.name), '') AS class_label,
         b.code AS branch_code,
         ay.id AS academic_year_id, ay.name AS academic_year
    FROM student_profiles sp
    JOIN users u         ON u.id = sp.user_id
    JOIN branches b      ON b.id = sp.branch_id
    LEFT JOIN classes c  ON c.id = sp.class_id
    LEFT JOIN sections s ON s.id = sp.section_id
    -- The branch's current year (where Fee collection shows dues), else the student's own year.
    LEFT JOIN LATERAL (
      SELECT y.id, y.name FROM academic_years y
       WHERE y.branch_id = sp.branch_id AND (y.is_current OR y.id = sp.academic_year_id)
       ORDER BY y.is_current DESC LIMIT 1
    ) ay ON TRUE`;

const ACTIVE = `sp.status IN ('enrolled', 'suspended')`;

async function loadTargets(db, auth, scope, { lock }) {
  const forUpdate = lock ? 'FOR UPDATE OF sp' : '';
  if (scope.studentId) {
    const { rows } = await db.query(`${TARGET_SELECT} WHERE sp.id = $1 AND sp.deleted_at IS NULL ${forUpdate}`, [scope.studentId]);
    const student = rows[0];
    if (!student) throw AppError.notFound('Student not found', 'STUDENT_NOT_FOUND');
    assertBranchAccess(auth, { tenantId: student.tenant_id, branchId: student.branch_id }, 'Student not found');
    if (!['enrolled', 'suspended'].includes(student.status)) {
      throw unprocessable('STUDENT_NOT_ACTIVE', `${student.name} has left the school; charges can only be added to current students`);
    }
    return { label: student.name, branchId: student.branch_id, students: [student] };
  }

  const { rows: [cls] } = await db.query(
    `SELECT id, tenant_id, branch_id, name FROM classes WHERE id = $1 AND deleted_at IS NULL`,
    [scope.classId],
  );
  if (!cls) throw AppError.notFound('Class not found', 'CLASS_NOT_FOUND');
  assertBranchAccess(auth, { tenantId: cls.tenant_id, branchId: cls.branch_id }, 'Class not found');
  let label = cls.name;
  if (scope.sectionId) {
    const { rows: [sec] } = await db.query(
      `SELECT id, name FROM sections WHERE id = $1 AND class_id = $2 AND deleted_at IS NULL`,
      [scope.sectionId, cls.id],
    );
    if (!sec) throw unprocessable('SECTION_NOT_IN_CLASS', `That section is not a section of ${cls.name}`);
    label = `${cls.name} ${sec.name}`;
  }
  const { rows } = await db.query(
    `${TARGET_SELECT}
      WHERE sp.deleted_at IS NULL AND ${ACTIVE}
        AND sp.class_id = $1 AND ($2::uuid IS NULL OR sp.section_id = $2)
      ORDER BY s.name NULLS LAST, NULLIF(regexp_replace(sp.roll_number, '\\D', '', 'g'), '')::int NULLS LAST, name
      ${forUpdate}`,
    [cls.id, scope.sectionId ?? null],
  );
  return { label, branchId: cls.branch_id, students: rows };
}

async function billedInBatch(db, batchId, studentIds) {
  if (!batchId || studentIds.length === 0) return [];
  const { rows } = await db.query(
    `SELECT student_id FROM fee_invoices WHERE charge_batch_id = $1 AND student_id = ANY ($2)`,
    [batchId, studentIds],
  );
  return rows.map((r) => r.student_id);
}

async function loadHead(db, branchId, feeHeadId) {
  const [head] = await repo.findFeeHeads(db, branchId, [feeHeadId]);
  if (!head) throw unprocessable('FEE_HEAD_NOT_FOUND', 'Unknown or inactive fee head for this branch', { feeHeadIds: [feeHeadId] });
  return head;
}

const preview = (s) => ({ id: s.id, name: s.name, admissionNumber: s.admission_number, classLabel: s.class_label });

// ---------------------------------------------------------------- service

/**
 * POST /fees/charges. dryRun: who would be billed and the total, nothing written.
 * Returns { batchId, target, feeHead, amount, students, alreadyCharged, invoicesCreated|invoicesToCreate, total, ... }.
 */
export async function createCharges(auth, input) {
  const { scope, feeHeadId, description, amount, dueDate, batchId, dryRun } = input;

  const run = async (db) => {
    const target = await loadTargets(db, auth, scope, { lock: !dryRun });
    if (target.students.length > MAX_CHARGE_STUDENTS) {
      throw unprocessable('TOO_MANY_STUDENTS', `Charge at most ${MAX_CHARGE_STUDENTS} students at a time; pick a section`);
    }
    const head = await loadHead(db, target.branchId, feeHeadId);
    const noYear = target.students.find((s) => !s.academic_year_id);
    if (noYear) throw unprocessable('NO_CURRENT_YEAR', 'Set a current academic year first (Settings → Classes and subjects)');
    const plan = planCharge({ students: target.students, alreadyBilled: await billedInBatch(db, batchId, target.students.map((s) => s.id)), amount });
    const base = {
      batchId: batchId ?? null,
      target: { ...scope, label: target.label },
      feeHead: { id: head.id, name: head.name },
      description,
      amount: fromPaise(amount),
      dueDate,
      students: target.students.length,
      alreadyCharged: plan.skipped,
      total: fromPaise(plan.total),
    };
    if (dryRun) {
      return { ...base, dryRun: true, invoicesToCreate: plan.toBill.length, preview: plan.toBill.slice(0, 100).map(preview) };
    }

    const invoices = [];
    for (const s of plan.toBill) {
      const sequence = await repo.nextDocumentNumber(db, { branchId: s.branch_id, docType: 'invoice', periodKey: s.academic_year });
      const id = await repo.insertInvoice(db, {
        tenantId: s.tenant_id,
        branchId: s.branch_id,
        studentId: s.id,
        academicYearId: s.academic_year_id,
        invoiceNumber: invoiceNumber(s.branch_code, s.academic_year, sequence),
        periodLabel: description.slice(0, 50),
        dueDate,
        generatedBy: auth.userId,
        notes: 'One-off charge',
        chargeBatchId: batchId,
      });
      await repo.insertInvoiceItems(db, {
        tenantId: s.tenant_id,
        branchId: s.branch_id,
        invoiceId: id,
        items: [{ allocation_id: null, fee_head_id: head.id, description, amount: fromPaise(amount), concession_amount: '0.00' }],
      });
      invoices.push({ id, studentId: s.id });
    }
    return { ...base, dryRun: false, tenantId: target.students[0]?.tenant_id ?? null, invoicesCreated: invoices.length, invoices };
  };

  const result = dryRun ? await run(pool) : await withTransaction(run);
  if (!dryRun) {
    logger.info('One-off charge billed', {
      batchId, target: result.target.label, feeHeadId, amount: result.amount, invoicesCreated: result.invoicesCreated, skipped: result.alreadyCharged, by: auth.userId,
    });
  }
  return result;
}
