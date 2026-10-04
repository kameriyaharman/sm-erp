import { pool, withTransaction } from '../../db/pool.js';
import { fromPaise, toPaise } from '../../utils/money.js';
import { logger } from '../../utils/logger.js';
import { assertStaffAccess, conflict, resolveWriteBranch, unprocessable } from '../shared/access.js';
import {
  addMonths, concessionPaise, generateInstallments, INSTALMENT_COUNT, monthsBetween, pickRule, structureTotals, validateStructureRows,
} from './schedule.helpers.js';
import * as repo from './fee-setup.repository.js';

/**
 * Fee setup: heads, class-wise structures (instalments), applying a structure to students
 * and per-student concessions. Rules that keep money honest:
 *  - an allocation that is on an invoice is never changed (its invoice is the bill);
 *  - structure changes flow to un-invoiced allocations only, and the response says how many
 *    were updated and how many invoiced ones stayed as billed.
 */

const money = fromPaise;

// =====================================================================
// helpers
// =====================================================================

async function loadClass(db, auth, classId) {
  const cls = await repo.getClass(db, classId);
  assertStaffAccess(auth, cls, 'Class not found', 'CLASS_NOT_FOUND');
  return cls;
}

async function loadYear(db, branchId, academicYearId) {
  const year = await repo.getYear(db, { branchId, academicYearId });
  if (!year) {
    if (academicYearId) throw unprocessable('ACADEMIC_YEAR_NOT_FOUND', 'That academic year does not belong to this branch');
    throw unprocessable('NO_CURRENT_YEAR', 'Set a current academic year first (Settings → Classes and subjects)');
  }
  return year;
}

const headType = (h) => (h.default_frequency === 'one_time' ? 'one_time' : 'recurring');

function mapHead(h) {
  return {
    id: h.id,
    name: h.name,
    code: h.code,
    description: h.description,
    type: headType(h),
    defaultFrequency: h.default_frequency,
    refundable: h.is_refundable,
    optional: h.is_optional,
    displayOrder: h.display_order,
    isActive: h.status === 'active',
    ...(h.classes !== undefined && { usage: { classes: h.classes, allocations: h.allocations } }),
  };
}

function mapYear(y) {
  return { id: y.id, name: y.name, startDate: y.start_date, endDate: y.end_date, isCurrent: y.is_current };
}

function shapeStructure(cls, year, rows, students) {
  const paiseRows = rows.map((r) => ({ feeHeadId: r.fee_head_id, installmentNo: r.installment_no, amount: toPaise(r.amount) }));
  const t = structureTotals(paiseRows);
  const heads = [];
  for (const r of rows) {
    if (!heads.some((h) => h.id === r.fee_head_id)) {
      heads.push({ id: r.fee_head_id, name: r.fee_head, code: r.fee_head_code, isActive: r.fee_head_status === 'active', frequency: r.frequency, annual: money(t.byHead[r.fee_head_id]) });
    }
  }
  return {
    class: { id: cls.id, name: cls.name },
    academicYear: mapYear(year),
    students,
    rows: rows.map((r) => ({
      id: r.id,
      feeHead: { id: r.fee_head_id, name: r.fee_head, code: r.fee_head_code },
      frequency: r.frequency,
      installmentNo: r.installment_no,
      label: r.installment_label,
      amount: r.amount,
      dueDate: r.due_date,
      allocations: r.allocations,
      invoiced: r.invoiced,
    })),
    heads,
    totals: {
      annual: money(t.annual),
      byInstallment: Object.fromEntries(Object.entries(t.byInstallment).map(([k, v]) => [k, money(v)])),
    },
  };
}

async function structureFor(db, cls, year) {
  // Sequential: `db` may be a transaction client, which runs one query at a time.
  const rows = await repo.structureRows(db, { classId: cls.id, academicYearId: year.id });
  const students = await repo.classStudents(db, { classId: cls.id, academicYearId: year.id });
  return shapeStructure(cls, year, rows, students.length);
}

// =====================================================================
// Fee heads
// =====================================================================

export async function listHeads(auth, { branchId }) {
  const scope = await resolveWriteBranch(auth, branchId);
  const rows = await repo.listHeads(pool, scope.branchId);
  return rows.map(mapHead);
}

function uniqueViolation(err, input) {
  if (err.code !== '23505') return err;
  if (/code/.test(err.constraint ?? '')) return conflict('HEAD_CODE_TAKEN', `Another fee head already uses the code ${input.code}`);
  return conflict('HEAD_NAME_TAKEN', `A fee head named “${input.name}” already exists`);
}

export async function createHead(auth, input) {
  const { tenantId, branchId } = await resolveWriteBranch(auth, input.branchId);
  const id = await withTransaction(async (db) => {
    try {
      return await repo.insertHead(db, {
        tenantId,
        branchId,
        name: input.name,
        code: input.code,
        description: input.description,
        defaultFrequency: input.type === 'one_time' ? 'one_time' : (input.defaultFrequency ?? 'quarterly'),
        optional: input.optional,
        refundable: input.refundable,
        displayOrder: input.displayOrder ?? (await repo.nextHeadOrder(db, branchId)),
      });
    } catch (err) {
      throw uniqueViolation(err, input);
    }
  });
  return mapHead(await repo.getHead(pool, id));
}

export async function updateHead(auth, id, input) {
  await withTransaction(async (db) => {
    const head = await repo.getHead(db, id, { lock: true });
    assertStaffAccess(auth, head, 'Fee head not found', 'FEE_HEAD_NOT_FOUND');
    if (input.isActive === false && head.status === 'active') {
      const usage = await repo.headUsage(db, id);
      if (usage.live_structures > 0) {
        throw conflict('HEAD_IN_USE', `This head is in ${usage.live_structures} instalment(s) of this year's class fee structures. Remove it there first.`, usage);
      }
    }
    let defaultFrequency;
    if (input.type === 'one_time') defaultFrequency = 'one_time';
    else if (input.defaultFrequency) defaultFrequency = input.defaultFrequency;
    else if (input.type === 'recurring' && head.default_frequency === 'one_time') defaultFrequency = 'quarterly';
    try {
      await repo.updateHead(db, id, {
        name: input.name,
        code: input.code,
        description: input.description === undefined ? undefined : input.description ?? null,
        defaultFrequency,
        optional: input.optional,
        refundable: input.refundable,
        displayOrder: input.displayOrder,
        status: input.isActive === undefined ? undefined : input.isActive ? 'active' : 'inactive',
      });
    } catch (err) {
      throw uniqueViolation(err, { name: input.name ?? head.name, code: input.code ?? head.code });
    }
  });
  return mapHead(await repo.getHead(pool, id));
}

/** Only a head that was never used anywhere can be deleted; otherwise deactivate it. */
export async function deleteHead(auth, id) {
  await withTransaction(async (db) => {
    const head = await repo.getHead(db, id, { lock: true });
    assertStaffAccess(auth, head, 'Fee head not found', 'FEE_HEAD_NOT_FOUND');
    const usage = await repo.headUsage(db, id);
    if (usage.structures || usage.allocations || usage.invoice_items || usage.concessions) {
      throw conflict('HEAD_IN_USE', 'This fee head has been used in a fee structure or on a bill. Deactivate it instead.', usage);
    }
    await repo.deleteHead(db, id);
  });
}

// =====================================================================
// Structure
// =====================================================================

export async function overview(auth, { academicYearId, branchId }) {
  const scope = await resolveWriteBranch(auth, branchId);
  const year = await loadYear(pool, scope.branchId, academicYearId);
  const [rows, years] = await Promise.all([
    repo.overview(pool, { branchId: scope.branchId, academicYearId: year.id }),
    repo.listYears(pool, scope.branchId),
  ]);
  return {
    academicYear: mapYear(year),
    years: years.map(mapYear),
    classes: rows.map((r) => ({
      id: r.id,
      name: r.name,
      annual: r.annual,
      heads: r.heads,
      installments: r.rows,
      students: r.students,
      studentsSetUp: r.rows > 0 ? r.fully_allocated : 0,
    })),
  };
}

export async function getStructure(auth, { classId, academicYearId }) {
  const cls = await loadClass(pool, auth, classId);
  const year = await loadYear(pool, cls.branch_id, academicYearId);
  return structureFor(pool, cls, year);
}

class DryRun extends Error {
  constructor(result) {
    super('dry run');
    this.result = result;
  }
}

/**
 * Replaces the structure of one class + year with `rows`. Rows are matched to existing ones by
 * (fee head, instalment no.). Changed rows flow to un-invoiced allocations; removed rows switch
 * off their un-invoiced allocations (or are deleted when nobody was ever allocated them).
 */
async function saveStructureTx(db, auth, { cls, year, rows, dryRun }) {
  const heads = rows.length ? await repo.headsByIds(db, cls.branch_id, [...new Set(rows.map((r) => r.feeHeadId))]) : [];
  const headById = new Map(heads.map((h) => [h.id, h]));
  const issues = [];
  rows.forEach((r, i) => {
    const h = headById.get(r.feeHeadId);
    if (!h) issues.push({ path: `rows.${i}.feeHeadId`, message: 'Unknown fee head for this branch' });
  });
  issues.push(...validateStructureRows(rows, { startDate: year.start_date, endDate: year.end_date }));
  if (issues.length) {
    throw unprocessable('INVALID_STRUCTURE', issues[0].message, { issues });
  }

  const existing = await repo.lockStructure(db, { classId: cls.id, academicYearId: year.id });
  const byKey = new Map(existing.map((e) => [`${e.fee_head_id}#${e.installment_no}`, e]));
  const kept = new Set();
  const changedIds = [];
  const reactivateIds = [];
  let added = 0;
  for (const r of rows) {
    const head = headById.get(r.feeHeadId);
    const label = r.label ?? generateInstallments({ frequency: r.frequency, yearStart: year.start_date, amount: 0 })[r.installmentNo - 1]?.label ?? null;
    const values = { frequency: r.frequency, label, amount: money(r.amount), dueDate: r.dueDate };
    const e = byKey.get(`${r.feeHeadId}#${r.installmentNo}`);
    if (!e) {
      if (head.status !== 'active') throw unprocessable('FEE_HEAD_INACTIVE', `“${head.name}” is inactive; activate it before adding it to a class`);
      await repo.insertStructureRow(db, { tenantId: cls.tenant_id, branchId: cls.branch_id, academicYearId: year.id, classId: cls.id, feeHeadId: r.feeHeadId, installmentNo: r.installmentNo, ...values });
      added += 1;
      continue;
    }
    kept.add(e.id);
    const same = e.status === 'active' && e.frequency === r.frequency && (e.installment_label ?? null) === label && toPaise(e.amount) === r.amount && e.due_date === r.dueDate;
    if (same) continue;
    await repo.updateStructureRow(db, e.id, values);
    if (e.status !== 'active') reactivateIds.push(e.id);
    else changedIds.push(e.id);
  }
  const removed = existing.filter((e) => e.status === 'active' && !kept.has(e.id));
  const toDelete = removed.filter((e) => e.allocations_any === 0).map((e) => e.id);
  const toDeactivate = removed.filter((e) => e.allocations_any > 0).map((e) => e.id);
  const deactivatedAllocations = await repo.deactivateStructureRows(db, toDeactivate);
  // Invoiced allocations of removed rows stay billed.
  const removedInvoiced = toDeactivate.length
    ? (await db.query(
      `SELECT count(*)::int AS n FROM student_fee_allocations a
        WHERE a.fee_structure_id = ANY ($1) AND a.is_active AND EXISTS (SELECT 1 FROM fee_invoice_items it WHERE it.allocation_id = a.id)`,
      [toDeactivate],
    )).rows[0].n
    : 0;
  await repo.deleteStructureRows(db, toDelete);
  const prop = await repo.propagateToAllocations(db, { changedIds, reactivateIds });

  const impact = {
    rowsAdded: added,
    rowsChanged: changedIds.length + reactivateIds.length,
    rowsRemoved: removed.length,
    allocationsUpdated: prop.updated,
    studentsUpdated: prop.students,
    allocationsRemoved: deactivatedAllocations,
    invoicedUnchanged: prop.invoicedUnchanged + removedInvoiced,
  };
  const structure = await structureFor(db, cls, year);
  if (dryRun) throw new DryRun({ structure, impact, dryRun: true });
  return { structure, impact, dryRun: false };
}

async function inTransaction(work) {
  try {
    return await withTransaction(work);
  } catch (err) {
    if (err instanceof DryRun) return err.result; // rolled back
    throw err;
  }
}

export async function saveStructure(auth, { classId, academicYearId, rows, dryRun }) {
  const result = await inTransaction(async (db) => {
    const cls = await loadClass(db, auth, classId);
    const year = await loadYear(db, cls.branch_id, academicYearId);
    return saveStructureTx(db, auth, { cls, year, rows, dryRun });
  });
  if (!result.dryRun) logger.info('Fee structure saved', { classId, academicYearId: result.structure.academicYear.id, ...result.impact, by: auth.userId });
  return result;
}

export async function copyStructure(auth, input) {
  const result = await inTransaction(async (db) => {
    const from = await loadClass(db, auth, input.fromClassId);
    const to = await loadClass(db, auth, input.toClassId);
    if (from.branch_id !== to.branch_id) throw unprocessable('DIFFERENT_BRANCHES', 'Copy between classes of the same branch');
    const fromYear = await loadYear(db, from.branch_id, input.fromAcademicYearId);
    const toYear = await loadYear(db, to.branch_id, input.toAcademicYearId);
    if (from.id === to.id && fromYear.id === toYear.id) throw unprocessable('SAME_STRUCTURE', 'Pick a different class or year to copy from');
    const source = await repo.structureRows(db, { classId: from.id, academicYearId: fromYear.id });
    if (!source.length) throw unprocessable('SOURCE_EMPTY', `${from.name} (${fromYear.name}) has no fee structure to copy`);
    const target = await repo.structureRows(db, { classId: to.id, academicYearId: toYear.id });
    if (target.length && !input.overwrite) {
      throw conflict('STRUCTURE_EXISTS', `${to.name} already has a fee structure for ${toYear.name}. Copy again with overwrite to replace it.`, { rows: target.length });
    }
    const shift = monthsBetween(fromYear.start_date, toYear.start_date);
    const rows = source.map((r) => ({
      feeHeadId: r.fee_head_id,
      frequency: r.frequency,
      installmentNo: r.installment_no,
      label: r.installment_label ?? undefined,
      amount: toPaise(r.amount),
      dueDate: addMonths(r.due_date, shift),
    }));
    return saveStructureTx(db, auth, { cls: to, year: toYear, rows, dryRun: false });
  });
  logger.info('Fee structure copied', { from: input.fromClassId, to: input.toClassId, by: auth.userId });
  return result;
}

export async function schedule(auth, { frequency, amount, total, dueDay, academicYearId, branchId }) {
  const scope = await resolveWriteBranch(auth, branchId);
  const year = await loadYear(pool, scope.branchId, academicYearId);
  const rows = generateInstallments({ frequency, yearStart: year.start_date, dueDay, amount, total });
  return {
    academicYear: mapYear(year),
    frequency,
    installments: INSTALMENT_COUNT[frequency],
    rows: rows.map((r) => ({ ...r, amount: money(r.amount) })),
    total: money(rows.reduce((s, r) => s + r.amount, 0)),
  };
}

// =====================================================================
// Apply to students
// =====================================================================

function ruleFromRow(r) {
  return {
    feeHeadId: r.fee_head_id,
    type: r.concession_type,
    value: r.concession_type === 'flat' ? toPaise(r.concession_value) : Number(r.concession_value),
    reason: r.reason,
  };
}

/** New allocations (with concession rules applied) for students missing some structure rows. */
async function planAllocations(db, { cls, year, studentIds }) {
  const students = await repo.classStudents(db, { classId: cls.id, academicYearId: year.id, studentIds });
  const ids = students.map((s) => s.id);
  const missing = ids.length ? await repo.missingAllocations(db, { classId: cls.id, academicYearId: year.id, studentIds: ids }) : [];
  const rules = ids.length ? await repo.rulesFor(db, { studentIds: ids, academicYearId: year.id }) : [];
  const structure = await repo.structureRows(db, { classId: cls.id, academicYearId: year.id });
  const rulesByStudent = new Map();
  for (const r of rules) rulesByStudent.set(r.student_id, [...(rulesByStudent.get(r.student_id) ?? []), ruleFromRow(r)]);

  const rows = missing.map((m) => {
    const base = toPaise(m.amount);
    const rule = pickRule(rulesByStudent.get(m.student_id) ?? [], m.fee_head_id);
    const conc = rule ? concessionPaise({ type: rule.type, value: rule.value, base }) : 0;
    return {
      studentId: m.student_id,
      feeHeadId: m.fee_head_id,
      feeStructureId: m.fee_structure_id,
      installmentNo: m.installment_no,
      dueDate: m.due_date,
      base,
      concession: conc,
      baseAmount: money(base),
      concessionType: rule ? rule.type : 'none',
      concessionValue: rule ? (rule.type === 'flat' ? money(rule.value) : rule.type === 'percentage' ? String(rule.value) : '0') : '0',
      concessionAmount: money(conc),
      concessionReason: rule?.reason ?? null,
    };
  });
  const byStudent = new Map();
  for (const r of rows) {
    const s = byStudent.get(r.studentId) ?? { missing: 0, gross: 0, concession: 0 };
    s.missing += 1;
    s.gross += r.base;
    s.concession += r.concession;
    byStudent.set(r.studentId, s);
  }
  return { students, rows, byStudent, structureRows: structure.length };
}

export async function applyPreview(auth, { classId, academicYearId }) {
  const cls = await loadClass(pool, auth, classId);
  const year = await loadYear(pool, cls.branch_id, academicYearId);
  const plan = await planAllocations(pool, { cls, year });
  const list = plan.students.map((s) => {
    const p = plan.byStudent.get(s.id) ?? { missing: 0, gross: 0, concession: 0 };
    return {
      studentId: s.id,
      name: s.name,
      admissionNumber: s.admission_number,
      section: s.section_name,
      rollNumber: s.roll_number,
      hasInvoices: s.has_invoices,
      status: plan.structureRows === 0 ? 'no_structure' : p.missing === 0 ? 'up_to_date' : p.missing === plan.structureRows ? 'new' : 'partial',
      newAllocations: p.missing,
      gross: money(p.gross),
      concession: money(p.concession),
      net: money(p.gross - p.concession),
    };
  });
  const sum = (k) => plan.rows.reduce((n, r) => n + r[k], 0);
  return {
    class: { id: cls.id, name: cls.name },
    academicYear: mapYear(year),
    structureRows: plan.structureRows,
    students: list.length,
    upToDate: list.filter((s) => s.status === 'up_to_date').length,
    willChange: list.filter((s) => s.newAllocations > 0).length,
    withInvoices: list.filter((s) => s.hasInvoices).length,
    newAllocations: plan.rows.length,
    gross: money(sum('base')),
    concession: money(sum('concession')),
    net: money(sum('base') - sum('concession')),
    rows: list,
  };
}

export async function apply(auth, { classId, academicYearId, studentIds }) {
  const result = await withTransaction(async (db) => {
    const cls = await loadClass(db, auth, classId);
    const year = await loadYear(db, cls.branch_id, academicYearId);
    // Same lock as saving the structure: the structure cannot change while we apply it.
    await repo.lockStructure(db, { classId: cls.id, academicYearId: year.id });
    const plan = await planAllocations(db, { cls, year, studentIds });
    if (studentIds) {
      const found = new Set(plan.students.map((s) => s.id));
      const outside = studentIds.filter((id) => !found.has(id));
      if (outside.length) throw unprocessable('STUDENTS_NOT_IN_CLASS', 'Some students are not enrolled in this class for this year', { studentIds: outside });
    }
    if (plan.structureRows === 0) throw unprocessable('NO_STRUCTURE', `${cls.name} has no fee structure for ${year.name} yet`);
    const created = await repo.insertAllocations(db, {
      tenantId: cls.tenant_id, branchId: cls.branch_id, academicYearId: year.id, approvedBy: auth.userId, rows: plan.rows,
    });
    return {
      tenantId: cls.tenant_id,
      created,
      students: plan.byStudent.size,
      net: money(plan.rows.reduce((n, r) => n + r.base - r.concession, 0)),
      structure: await structureFor(db, cls, year),
    };
  });
  logger.info('Fee structure applied', { classId, created: result.created, students: result.students, by: auth.userId });
  return result;
}

// =====================================================================
// Concessions
// =====================================================================

function mapRule(r) {
  return {
    id: r.id,
    feeHead: r.fee_head_id ? { id: r.fee_head_id, name: r.fee_head } : null,
    type: r.concession_type,
    value: r.concession_value,
    reason: r.reason,
    approvedBy: r.approved_by_name,
    recordedBy: r.recorded_by,
    approvedAt: r.approved_at,
  };
}

function mapAllocation(a) {
  return {
    id: a.id,
    feeHead: { id: a.fee_head_id, name: a.fee_head },
    installmentNo: a.installment_no,
    label: a.installment_label,
    dueDate: a.due_date,
    baseAmount: a.base_amount,
    concessionType: a.concession_type,
    concessionAmount: a.concession_amount,
    netAmount: a.net_amount,
    concessionReason: a.concession_reason,
    invoiced: Boolean(a.invoice_number),
    invoiceNumber: a.invoice_number,
  };
}

async function concessionView(db, student, year) {
  const rules = await repo.rulesFor(db, { studentIds: [student.id], academicYearId: year.id });
  const allocations = await repo.studentAllocations(db, { studentId: student.id, academicYearId: year.id });
  const sum = (list, k) => money(list.reduce((n, a) => n + toPaise(a[k]), 0));
  const open = allocations.filter((a) => !a.invoice_number);
  return {
    student: {
      id: student.id, name: student.name, admissionNumber: student.admission_number,
      className: student.class_name, sectionName: student.section_name,
    },
    academicYear: mapYear(year),
    concessions: rules.map(mapRule),
    allocations: allocations.map(mapAllocation),
    totals: {
      gross: sum(allocations, 'base_amount'),
      concession: sum(allocations, 'concession_amount'),
      net: sum(allocations, 'net_amount'),
      unInvoicedNet: sum(open, 'net_amount'),
    },
  };
}

async function loadStudent(db, auth, studentId) {
  const student = await repo.getStudent(db, studentId);
  assertStaffAccess(auth, student, 'Student not found', 'STUDENT_NOT_FOUND');
  return student;
}

export async function getConcession(auth, studentId, { academicYearId }) {
  const student = await loadStudent(pool, auth, studentId);
  const year = await loadYear(pool, student.branch_id, academicYearId ?? student.academic_year_id ?? undefined);
  return concessionView(pool, student, year);
}

export async function saveConcession(auth, studentId, input) {
  const result = await withTransaction(async (db) => {
    const student = await loadStudent(db, auth, studentId);
    const year = await loadYear(db, student.branch_id, input.academicYearId ?? student.academic_year_id ?? undefined);
    const headIds = [...new Set(input.concessions.map((c) => c.feeHeadId).filter(Boolean))];
    if (headIds.length) {
      const heads = await repo.headsByIds(db, student.branch_id, headIds);
      if (heads.length !== headIds.length) throw unprocessable('FEE_HEAD_NOT_FOUND', 'Unknown fee head for this branch');
    }
    const rules = input.concessions.map((c) => ({
      feeHeadId: c.feeHeadId,
      type: c.type,
      // flat: paise in memory, rupees in the table; percentage: percent; waiver: 0
      value: c.type === 'flat' ? c.value : c.type === 'percentage' ? c.value : 0,
      reason: c.reason,
    }));
    await repo.replaceRules(db, {
      tenantId: student.tenant_id, branchId: student.branch_id, studentId: student.id, academicYearId: year.id,
      approvedByName: input.approvedBy, userId: auth.userId,
      rules: rules.map((r) => ({ ...r, value: r.type === 'flat' ? money(r.value) : String(r.value) })),
    });
    const allocations = await repo.studentAllocations(db, { studentId: student.id, academicYearId: year.id, lock: true });
    const open = allocations.filter((a) => !a.invoice_number);
    const before = open.reduce((n, a) => n + toPaise(a.net_amount), 0);
    const updates = [];
    let after = 0;
    for (const a of open) {
      const base = toPaise(a.base_amount);
      const rule = pickRule(rules, a.fee_head_id);
      const amount = rule ? concessionPaise({ type: rule.type, value: rule.value, base }) : 0;
      after += base - amount;
      const type = rule ? rule.type : 'none';
      const value = rule ? (rule.type === 'flat' ? money(rule.value) : rule.type === 'percentage' ? String(rule.value) : '0') : '0';
      if (type !== a.concession_type || toPaise(a.concession_amount) !== amount || toPaise(value) !== toPaise(a.concession_value) || (rule?.reason ?? null) !== a.concession_reason) {
        updates.push({ id: a.id, type, value, amount: money(amount), reason: rule?.reason ?? null });
      }
    }
    await repo.setAllocationConcessions(db, { userId: auth.userId, rows: updates });
    return {
      tenantId: student.tenant_id,
      view: await concessionView(db, student, year),
      impact: {
        allocationsUpdated: updates.length,
        invoicedUnchanged: allocations.length - open.length,
        unInvoicedBefore: money(before),
        unInvoicedAfter: money(after),
      },
    };
  });
  logger.info('Fee concession saved', { studentId, rules: input.concessions.length, ...result.impact, by: auth.userId });
  return result;
}
