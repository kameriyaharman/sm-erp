import { toPaise } from '../../utils/money.js';

/**
 * Pure helpers for billing upcoming instalments (POST /fees/invoices/bulk and the family
 * portal's "Pay in advance"). Unit-tested in test/fee-billing.test.js.
 */

/** "Instalment 3" | "Instalments 3–4" | null (no allocations). Max 50 chars (fee_invoices.period_label). */
export function instalmentLabel(allocations) {
  const nos = [...new Set(allocations.map((a) => Number(a.installment_no)))].sort((a, b) => a - b);
  if (nos.length === 0) return null;
  if (nos.length === 1) return `Instalment ${nos[0]}`;
  const contiguous = nos.every((n, i) => i === 0 || n === nos[i - 1] + 1);
  return (contiguous ? `Instalments ${nos[0]}–${nos[nos.length - 1]}` : `Instalments ${nos.join(', ')}`).slice(0, 50);
}

/**
 * Groups un-invoiced allocations by student. Returns one bill per student who has something to
 * bill (in the students' order), with its lines, total (paise) and earliest due date.
 */
export function planBulkBills({ students, allocations }) {
  const byStudent = new Map();
  for (const a of allocations) {
    if (!byStudent.has(a.student_id)) byStudent.set(a.student_id, []);
    byStudent.get(a.student_id).push(a);
  }
  const bills = [];
  for (const s of students) {
    const list = byStudent.get(s.id);
    if (!list?.length) continue;
    const sorted = [...list].sort((x, y) => (x.due_date < y.due_date ? -1 : x.due_date > y.due_date ? 1 : 0));
    bills.push({
      student: s,
      allocations: sorted,
      total: sorted.reduce((sum, a) => sum + toPaise(a.net_amount), 0),
      dueDate: sorted[0].due_date,
      periodLabel: instalmentLabel(sorted),
    });
  }
  return { bills, total: bills.reduce((sum, b) => sum + b.total, 0) };
}

/** Invoice lines for allocations, exactly as POST /fees/invoices builds them (no amount is changed). */
export function allocationLines(allocations) {
  return allocations.map((a) => ({
    allocation_id: a.id,
    fee_head_id: a.fee_head_id,
    description: `${a.fee_head} (installment ${a.installment_no})`,
    amount: a.base_amount,
    concession_amount: a.concession_amount,
  }));
}
