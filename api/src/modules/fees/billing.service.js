import { pool, withTransaction } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { fromPaise } from '../../utils/money.js';
import { logger } from '../../utils/logger.js';
import { loadChildForParent } from '../shared/access.js';
import { resolveGateway } from '../payments/gateway.js';
import * as repo from './fees.repository.js';
import { MAX_CHARGE_STUDENTS, loadTargets } from './charges.service.js';
import { allocationLines, instalmentLabel, planBulkBills } from './billing.helpers.js';
import { formatNumber } from './fees.service.js';

/**
 * Billing upcoming instalments early, so they can be paid (online) in advance.
 *
 *   POST /fees/invoices                           one student (existing; allocationIds | billUpTo)
 *   POST /fees/invoices/bulk                      a class / section, dryRun preview, then apply
 *   POST /parent/children/:id/fees/advance-bill   the family portal's "Pay in advance"
 *
 * Every path bills only the student's own, active, not-yet-invoiced allocations of the current
 * year, exactly as they are (amount and concession are copied, never changed). The unique index
 * on fee_invoice_items.allocation_id plus the student row lock make all of them idempotent: a
 * repeated request finds nothing left to bill instead of billing twice.
 */

const unprocessable = (code, message, details) => new AppError(422, code, message, details);

async function insertBill(db, { student, yearId, yearName, allocations, periodLabel, notes, generatedBy }) {
  const sequence = await repo.nextDocumentNumber(db, { branchId: student.branch_id, docType: 'invoice', periodKey: yearName });
  const id = await repo.insertInvoice(db, {
    tenantId: student.tenant_id,
    branchId: student.branch_id,
    studentId: student.id,
    academicYearId: yearId,
    invoiceNumber: formatNumber(student.branch_code, 'invoice', yearName, sequence),
    periodLabel,
    dueDate: allocations[0].due_date,
    generatedBy,
    notes,
  });
  await repo.insertInvoiceItems(db, { tenantId: student.tenant_id, branchId: student.branch_id, invoiceId: id, items: allocationLines(allocations) });
  return id;
}

// =====================================================================
// POST /fees/invoices/bulk (ADMINS)
// =====================================================================

export async function bulkBill(auth, { classId, sectionId, billUpTo, dryRun }) {
  const run = async (db) => {
    const target = await loadTargets(db, auth, { classId, sectionId }, { lock: !dryRun });
    if (target.students.length > MAX_CHARGE_STUDENTS) {
      throw unprocessable('TOO_MANY_STUDENTS', `Bill at most ${MAX_CHARGE_STUDENTS} students at a time; pick a section`);
    }
    const year = target.students.find((s) => s.academic_year_id);
    if (target.students.length > 0 && !year) {
      throw unprocessable('NO_CURRENT_YEAR', 'Set a current academic year first (Settings → Classes and subjects)');
    }
    const studentIds = target.students.map((s) => s.id);
    const allocations = studentIds.length
      ? await repo.unbilledForStudents(db, { studentIds, academicYearId: year.academic_year_id, billUpTo })
      : [];
    const plan = planBulkBills({ students: target.students, allocations });
    const billed = new Set(plan.bills.map((b) => b.student.id));
    const alreadyBilledIds = studentIds.length
      ? await repo.studentsWithBilledAllocations(db, { studentIds, academicYearId: year.academic_year_id, billUpTo })
      : [];
    const alreadyBilled = alreadyBilledIds.filter((id) => !billed.has(id)).length;

    const base = {
      target: { classId, sectionId: sectionId ?? null, label: target.label },
      billUpTo,
      academicYear: year ? { id: year.academic_year_id, name: year.academic_year } : null,
      students: target.students.length,
      alreadyBilled,
      nothingDue: target.students.length - plan.bills.length - alreadyBilled,
      total: fromPaise(plan.total),
    };
    const preview = (b) => ({
      studentId: b.student.id,
      name: b.student.name,
      admissionNumber: b.student.admission_number,
      classLabel: b.student.class_label,
      periodLabel: b.periodLabel,
      dueDate: b.dueDate,
      amount: fromPaise(b.total),
      lines: b.allocations.map((a) => ({ allocationId: a.id, feeHead: a.fee_head, installmentNo: a.installment_no, dueDate: a.due_date, amount: a.net_amount })),
    });
    if (dryRun) return { ...base, dryRun: true, invoicesToCreate: plan.bills.length, preview: plan.bills.slice(0, 200).map(preview) };

    const invoices = [];
    for (const b of plan.bills) {
      const id = await insertBill(db, {
        student: b.student,
        yearId: b.student.academic_year_id,
        yearName: b.student.academic_year,
        allocations: b.allocations,
        periodLabel: b.periodLabel,
        notes: `Billed in advance for ${target.label} (fees due up to ${billUpTo})`,
        generatedBy: auth.userId,
      });
      invoices.push({ id, studentId: b.student.id, amount: fromPaise(b.total) });
    }
    return { ...base, dryRun: false, tenantId: target.students[0]?.tenant_id ?? null, invoicesCreated: invoices.length, invoices };
  };

  const result = dryRun ? await run(pool) : await withTransaction(run);
  if (!dryRun) {
    logger.info('Instalments billed in bulk', { target: result.target.label, billUpTo, invoicesCreated: result.invoicesCreated, total: result.total, by: auth.userId });
  }
  return result;
}

// =====================================================================
// POST /parent/children/:studentId/fees/advance-bill (parent: own child; student: self)
// =====================================================================

/**
 * "Pay in advance": bills the chosen upcoming instalments of the caller's own child so the
 * portal can open Razorpay Checkout for them. Only when the school takes payments online.
 * Re-sending the same instalments returns the open invoice(s) already holding them.
 */
export async function advanceBill(auth, studentId, { allocationIds }) {
  const child = await loadChildForParent(pool, auth, studentId);
  const gateway = await resolveGateway(pool, { tenantId: child.tenant_id, branchId: child.branch_id });
  if (!gateway.enabled) {
    throw new AppError(503, 'PAYMENTS_DISABLED', 'Online payment is not set up for this school yet. Please pay at the school office.');
  }

  const outcome = await withTransaction(async (db) => {
    const student = await repo.getStudentForUpdate(db, child.id);
    if (!student) throw AppError.notFound('Student not found', 'STUDENT_NOT_FOUND');
    const year = await repo.resolveAcademicYear(db, { branchId: student.branch_id });
    if (!year) throw unprocessable('ACADEMIC_YEAR_NOT_FOUND', 'The school has no current academic year');

    const allocations = await repo.getUnbilledAllocations(db, { studentId: student.id, academicYearId: year.id, allocationIds, lock: true });
    if (allocations.length === allocationIds.length) {
      const id = await insertBill(db, {
        student,
        yearId: year.id,
        yearName: year.name,
        allocations,
        periodLabel: `${instalmentLabel(allocations)} (advance)`.slice(0, 50),
        notes: 'Billed from the family portal to pay in advance',
        generatedBy: auth.userId,
      });
      return { invoiceIds: [id], replayed: false };
    }

    // Already billed (a retry, or the school billed it meanwhile): hand back the open bill(s).
    const existing = await repo.openInvoicesForAllocations(db, student.id, allocationIds);
    const covered = new Set(existing.filter((e) => ['unpaid', 'partially_paid'].includes(e.status)).map((e) => e.allocation_id));
    if (allocations.length === 0 && allocationIds.every((a) => covered.has(a))) {
      return { invoiceIds: [...new Set(existing.map((e) => e.invoice_id))], replayed: true };
    }
    throw unprocessable('ALLOCATIONS_UNAVAILABLE', 'Some of these instalments are already paid, billed or no longer due. Refresh and try again.', {
      allocationIds: allocationIds.filter((a) => !allocations.some((x) => x.id === a) && !covered.has(a)),
    });
  });

  const invoices = await repo.invoicesState(pool, outcome.invoiceIds);
  if (!outcome.replayed) logger.info('Instalments billed from the portal', { studentId: child.id, invoiceIds: outcome.invoiceIds, by: auth.userId });
  return {
    tenantId: child.tenant_id,
    replayed: outcome.replayed,
    invoices: invoices.map((i) => ({
      id: i.id, invoiceNumber: i.invoice_number, periodLabel: i.period_label, dueDate: i.due_date,
      netAmount: i.net_amount, balanceAmount: i.balance_amount, status: i.status,
    })),
  };
}
