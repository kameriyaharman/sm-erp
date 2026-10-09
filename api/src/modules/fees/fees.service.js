import { withTransaction, pool } from '../../db/pool.js';
import { notifyFeeReceipt } from '../notifications/events.js';
import { AppError } from '../../errors/AppError.js';
import { assertBranchAccess, resolveBranchScope } from '../../middleware/scope.js';
import { fromPaise, toPaise } from '../../utils/money.js';
import { logger } from '../../utils/logger.js';
import * as repo from './fees.repository.js';
import { allocationLines } from './billing.helpers.js';

const unprocessable = (code, message, details) => new AppError(422, code, message, details);

export function formatNumber(branchCode, docType, periodKey, sequence) {
  const prefix = docType === 'invoice' ? 'INV' : 'RCT';
  return `${String(branchCode).toUpperCase()}/${prefix}/${periodKey}/${String(sequence).padStart(5, '0')}`;
}

function studentFeeStatus({ totalFee, paid, pending, overdue }) {
  if (totalFee === 0) return 'no_fees';
  if (pending <= 0) return 'paid';
  if (overdue > 0) return 'overdue';
  if (paid > 0) return 'partially_paid';
  return 'unpaid';
}

function mapInvoice(row) {
  return {
    id: row.id,
    ...(row.tenant_id && { tenantId: row.tenant_id }),
    invoiceNumber: row.invoice_number,
    periodLabel: row.period_label,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    academicYearId: row.academic_year_id,
    grossAmount: row.gross_amount,
    concessionAmount: row.concession_amount,
    fineAmount: row.fine_amount,
    netAmount: row.net_amount,
    paidAmount: row.paid_amount,
    balanceAmount: row.balance_amount,
    status: row.status,
    ...(row.heads !== undefined && { feeHeads: row.heads }),
    ...(row.items !== undefined && { items: row.items }),
  };
}

export function mapReceipt(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    receiptNumber: row.receipt_number,
    studentId: row.student_id,
    amount: row.amount,
    paymentMode: row.payment_mode,
    instrumentNumber: row.instrument_number,
    instrumentDate: row.instrument_date,
    bankName: row.bank_name,
    remarks: row.remarks,
    receivedAt: row.received_at,
    collectedBy: row.collected_by_name || null,
    status: row.status ?? 'active',
    cancelledAt: row.cancelled_at ?? null,
    cancelReason: row.cancel_reason ?? null,
    cancelledBy: row.cancelled_by_name ?? null,
    appliedTo: row.applied_to,
  };
}

/** A receipt in a list (student dues / profile fees tab). Cancelled receipts stay listed. */
export function mapReceiptListRow(row) {
  return {
    id: row.id,
    receiptNumber: row.receipt_number,
    amount: row.amount,
    paymentMode: row.payment_mode,
    instrumentNumber: row.instrument_number,
    receivedAt: row.received_at,
    remarks: row.remarks,
    collectedBy: row.collected_by_name ?? null,
    online: Boolean(row.online),
    gatewayPaymentId: row.gateway_payment_id ?? null,
    status: row.status,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    cancelledBy: row.cancelled_by_name ?? null,
    appliedTo: row.applied_to,
  };
}

// =====================================================================
// Queries
// =====================================================================

export async function listStudentFees(auth, { tenantId, branchId, ...filters }) {
  const scope = await resolveBranchScope(auth, { tenantId, branchId });
  const rows = await repo.listStudentFees({ scope, filters });

  const total = rows.length ? Number(rows[0].total_count) : 0;
  return {
    data: rows.map((row) => {
      const amounts = {
        totalFee: toPaise(row.total_fee),
        paid: toPaise(row.paid),
        pending: toPaise(row.pending),
        overdue: toPaise(row.overdue),
      };
      return {
        studentId: row.student_id,
        branchId: row.branch_id,
        studentName: row.student_name,
        admissionNumber: row.admission_number,
        rollNumber: row.roll_number,
        class: row.class_id ? { id: row.class_id, name: row.class_name } : null,
        section: row.section_id ? { id: row.section_id, name: row.section_name } : null,
        academicYear: { id: row.academic_year_id, name: row.academic_year },
        totalFee: row.total_fee,
        paid: row.paid,
        pending: row.pending,
        overdue: row.overdue,
        notYetInvoiced: row.unbilled,
        openInvoices: row.open_invoices,
        status: studentFeeStatus(amounts),
      };
    }),
    meta: {
      page: filters.page,
      limit: filters.limit,
      total,
      totalPages: Math.ceil(total / filters.limit),
      // Totals across every row matching the filters, not just this page.
      totals: {
        totalFee: rows[0]?.sum_total ?? '0.00',
        paid: rows[0]?.sum_paid ?? '0.00',
        pending: rows[0]?.sum_pending ?? '0.00',
      },
    },
  };
}

export async function getStudentDues(auth, studentId) {
  const student = await repo.getStudentSummary(pool, studentId);
  if (!student) throw AppError.notFound('Student not found', 'STUDENT_NOT_FOUND');
  assertBranchAccess(auth, { tenantId: student.tenant_id, branchId: student.branch_id }, 'Student not found');

  const year = await repo.resolveAcademicYear(pool, { branchId: student.branch_id });
  const [invoices, unbilled, receipts] = await Promise.all([
    repo.listOpenInvoices(pool, studentId),
    year ? repo.getUnbilledAllocations(pool, { studentId, academicYearId: year.id }) : [],
    repo.listStudentReceipts(pool, studentId),
  ]);

  const openBalance = invoices.reduce((sum, inv) => sum + toPaise(inv.balance_amount), 0);
  const unbilledTotal = unbilled.reduce((sum, a) => sum + toPaise(a.net_amount), 0);

  return {
    student: {
      id: student.id,
      name: student.student_name,
      admissionNumber: student.admission_number,
      rollNumber: student.roll_number,
      className: student.class_name,
      sectionName: student.section_name,
      parent: student.parent_name ? { name: student.parent_name, phone: student.parent_phone } : null,
    },
    openInvoices: invoices.map(mapInvoice),
    notYetInvoiced: {
      amount: fromPaise(unbilledTotal),
      allocations: unbilled.map((a) => ({
        id: a.id,
        feeHead: a.fee_head,
        installmentNo: a.installment_no,
        dueDate: a.due_date,
        netAmount: a.net_amount,
      })),
    },
    // Every receipt, newest first; cancelled ones stay (status 'cancelled', with reason and date).
    receipts: receipts.map(mapReceiptListRow),
    totals: {
      invoicedDue: fromPaise(openBalance),
      totalDue: fromPaise(openBalance + unbilledTotal),
    },
  };
}

export async function getInvoice(auth, invoiceId) {
  const invoice = await repo.getInvoiceWithItems(pool, invoiceId);
  if (!invoice) throw AppError.notFound('Invoice not found', 'INVOICE_NOT_FOUND');
  assertBranchAccess(auth, { tenantId: invoice.tenant_id, branchId: invoice.branch_id }, 'Invoice not found');
  return { ...mapInvoice(invoice), studentId: invoice.student_id, notes: invoice.notes };
}

export async function getAnalytics(auth, { tenantId, branchId, academicYearId }) {
  const scope = await resolveBranchScope(auth, { tenantId, branchId });
  const result = await repo.feeAnalytics({ scope, academicYearId });

  const invoiced = toPaise(result.summary.invoiced);
  const collected = toPaise(result.summary.collected);
  const pending = toPaise(result.summary.pending);
  const notYetInvoiced = toPaise(result.summary.not_yet_invoiced);

  return {
    summary: {
      invoiced: result.summary.invoiced,
      collected: result.summary.collected,
      pending: result.summary.pending,
      overdue: result.summary.overdue,
      notYetInvoiced: result.summary.not_yet_invoiced,
      totalExpected: fromPaise(invoiced + notYetInvoiced),
      // Share of invoiced fees already collected (0–100, one decimal).
      collectionRate: invoiced > 0 ? Math.round((collected / invoiced) * 1000) / 10 : null,
      paidVsPending: { paid: result.summary.collected, pending: fromPaise(pending + notYetInvoiced) },
      studentsWithDues: result.summary.students_with_dues,
      studentsOverdue: result.summary.students_overdue,
    },
    byStatus: result.byStatus.map((r) => ({
      status: r.status, invoices: r.invoices, amount: r.amount, paid: r.paid, balance: r.balance,
    })),
    byMonth: result.byMonth,
    byClass: result.byClass.map((r) => ({
      classId: r.class_id, className: r.class_name, students: r.students,
      invoiced: r.invoiced, collected: r.collected, pending: r.pending,
    })),
    byFeeHead: result.byFeeHead.map((r) => ({ feeHeadId: r.fee_head_id, feeHead: r.fee_head, invoiced: r.invoiced })),
    byPaymentMode: result.byPaymentMode.map((r) => ({ paymentMode: r.payment_mode, payments: r.payments, amount: r.amount })),
  };
}

// =====================================================================
// Commands
// =====================================================================

/**
 * Creates one invoice for a student from their unbilled fee allocations and/or
 * ad-hoc items. Totals and status are computed by database triggers.
 */
export async function createInvoice(auth, input) {
  const invoiceId = await withTransaction(async (db) => {
    const student = await repo.getStudentForUpdate(db, input.studentId);
    if (!student) throw AppError.notFound('Student not found', 'STUDENT_NOT_FOUND');
    assertBranchAccess(auth, { tenantId: student.tenant_id, branchId: student.branch_id }, 'Student not found');

    const year = await repo.resolveAcademicYear(db, {
      branchId: student.branch_id,
      academicYearId: input.academicYearId,
      fallbackId: student.academic_year_id,
    });
    if (!year) throw unprocessable('ACADEMIC_YEAR_NOT_FOUND', 'No matching academic year for this student');

    const allocations = await repo.getUnbilledAllocations(db, {
      studentId: student.id,
      academicYearId: year.id,
      allocationIds: input.allocationIds,
      billUpTo: input.billUpTo,
      lock: true,
    });

    if (input.allocationIds) {
      const found = new Set(allocations.map((a) => a.id));
      const unavailable = input.allocationIds.filter((id) => !found.has(id));
      if (unavailable.length > 0) {
        throw unprocessable(
          'ALLOCATIONS_UNAVAILABLE',
          'Some fee allocations are already invoiced, inactive, or belong to another student/year',
          { allocationIds: unavailable },
        );
      }
    }

    if (input.items.length > 0) {
      const headIds = [...new Set(input.items.map((i) => i.feeHeadId))];
      const heads = await repo.findFeeHeads(db, student.branch_id, headIds);
      if (heads.length !== headIds.length) {
        const known = new Set(heads.map((h) => h.id));
        throw unprocessable('FEE_HEAD_NOT_FOUND', 'Unknown or inactive fee head for this branch', {
          feeHeadIds: headIds.filter((id) => !known.has(id)),
        });
      }
    }

    const lines = [
      ...allocationLines(allocations),
      ...input.items.map((item) => ({
        allocation_id: null,
        fee_head_id: item.feeHeadId,
        description: item.description ?? null,
        amount: fromPaise(item.amount),
        concession_amount: fromPaise(item.concessionAmount),
      })),
    ];

    if (lines.length === 0) {
      throw unprocessable('NOTHING_TO_BILL', 'This student has no unbilled fees for the selected period');
    }

    const dueDate = input.dueDate ?? allocations[0]?.due_date;
    if (!dueDate) {
      throw unprocessable('DUE_DATE_REQUIRED', 'dueDate is required when the invoice has only custom items', {
        dueDate: ['Required'],
      });
    }

    const sequence = await repo.nextDocumentNumber(db, { branchId: student.branch_id, docType: 'invoice', periodKey: year.name });
    const id = await repo.insertInvoice(db, {
      tenantId: student.tenant_id,
      branchId: student.branch_id,
      studentId: student.id,
      academicYearId: year.id,
      invoiceNumber: formatNumber(student.branch_code, 'invoice', year.name, sequence),
      periodLabel: input.periodLabel,
      dueDate,
      generatedBy: auth.userId,
      notes: input.notes,
    });
    await repo.insertInvoiceItems(db, { tenantId: student.tenant_id, branchId: student.branch_id, invoiceId: id, items: lines });
    return id;
  });

  const invoice = await repo.getInvoiceWithItems(pool, invoiceId);
  logger.info('Invoice created', { invoiceId, invoiceNumber: invoice.invoice_number, by: auth.userId });
  return { ...mapInvoice(invoice), studentId: invoice.student_id };
}

/**
 * Records a counter payment and issues one receipt. The amount is applied to the
 * selected open invoices oldest-due first. Retrying with the same Idempotency-Key
 * returns the original receipt instead of charging twice.
 */
export async function collectPayment(auth, input, idempotencyKey) {
  const outcome = await withTransaction(async (db) => {
    // Lock first, then check the key: two concurrent retries for the same student
    // queue on this lock, so the second one sees the first one's receipt.
    const student = await repo.getStudentForUpdate(db, input.studentId);
    if (!student) throw AppError.notFound('Student not found', 'STUDENT_NOT_FOUND');
    assertBranchAccess(auth, { tenantId: student.tenant_id, branchId: student.branch_id }, 'Student not found');

    const existingId = await repo.findReceiptByIdempotencyKey(db, student.tenant_id, idempotencyKey);
    if (existingId) return { receiptId: existingId, replayed: true };

    const invoices = await repo.lockOpenInvoices(db, student.id, input.invoiceIds);
    if (input.invoiceIds) {
      const open = new Set(invoices.map((i) => i.id));
      const notOpen = input.invoiceIds.filter((id) => !open.has(id));
      if (notOpen.length > 0) {
        throw unprocessable('INVOICES_NOT_PAYABLE', 'Some invoices are already paid, cancelled, or belong to another student', {
          invoiceIds: notOpen,
        });
      }
    }

    const totalDue = invoices.reduce((sum, inv) => sum + toPaise(inv.balance_amount), 0);
    if (totalDue <= 0) {
      throw unprocessable('NOTHING_DUE', 'There are no open invoices to collect against. Create an invoice first.');
    }
    if (input.amount > totalDue) {
      throw unprocessable('AMOUNT_EXCEEDS_DUE', `Amount is more than the ₹${fromPaise(totalDue)} due on the selected invoices`, {
        maxAmount: fromPaise(totalDue),
      });
    }

    // Oldest due first.
    let remaining = input.amount;
    const lines = [];
    for (const inv of invoices) {
      if (remaining === 0) break;
      const applied = Math.min(remaining, toPaise(inv.balance_amount));
      if (applied > 0) {
        lines.push({ invoice_id: inv.id, amount: fromPaise(applied) });
        remaining -= applied;
      }
    }

    const year = invoices[0].academic_year_id;
    const yearRow = await repo.resolveAcademicYear(db, { branchId: student.branch_id, academicYearId: year });
    const sequence = await repo.nextDocumentNumber(db, { branchId: student.branch_id, docType: 'receipt', periodKey: yearRow.name });

    const receiptId = await repo.insertReceipt(db, {
      tenantId: student.tenant_id,
      branchId: student.branch_id,
      studentId: student.id,
      academicYearId: year,
      receiptNumber: formatNumber(student.branch_code, 'receipt', yearRow.name, sequence),
      amount: fromPaise(input.amount),
      paymentMode: input.paymentMode,
      instrumentNumber: input.instrumentNumber,
      instrumentDate: input.instrumentDate,
      bankName: input.bankName,
      remarks: input.remarks,
      collectedBy: auth.userId,
      idempotencyKey,
    });

    await repo.insertPaymentTransactions(db, {
      tenantId: student.tenant_id,
      branchId: student.branch_id,
      studentId: student.id,
      receiptId,
      paymentMode: input.paymentMode,
      instrument: { number: input.instrumentNumber, date: input.instrumentDate, bank: input.bankName },
      collectedBy: auth.userId,
      lines,
    });

    return { receiptId, replayed: false };
  });

  const receipt = await repo.getReceipt(pool, outcome.receiptId);
  if (!outcome.replayed) {
    logger.info('Fee collected', { receiptNumber: receipt.receipt_number, amount: receipt.amount, by: auth.userId });
    notifyFeeReceipt(outcome.receiptId, auth.userId); // "Fee received" message, when the school switched it on
  }
  return { receipt: mapReceipt(receipt), replayed: outcome.replayed };
}
