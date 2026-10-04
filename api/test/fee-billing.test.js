import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocationLines, instalmentLabel, planBulkBills } from '../src/modules/fees/billing.helpers.js';

const alloc = (id, student, no, due, net, extra = {}) => ({
  id, student_id: student, installment_no: no, due_date: due, net_amount: net, base_amount: net, concession_amount: '0.00',
  fee_head_id: `h-${id}`, fee_head: 'Tuition', ...extra,
});

test('instalmentLabel: one, a run, a gap, none', () => {
  assert.equal(instalmentLabel([alloc('a', 's', 3, '2026-10-10', '1.00'), alloc('b', 's', 3, '2026-10-10', '1.00')]), 'Instalment 3');
  assert.equal(instalmentLabel([alloc('a', 's', 4, '2027-01-10', '1.00'), alloc('b', 's', 3, '2026-10-10', '1.00')]), 'Instalments 3–4');
  assert.equal(instalmentLabel([alloc('a', 's', 1, '2026-04-10', '1.00'), alloc('b', 's', 3, '2026-10-10', '1.00')]), 'Instalments 1, 3');
  assert.equal(instalmentLabel([]), null);
});

test('planBulkBills: one bill per student with something to bill, in the students\' order, exact paise totals', () => {
  const students = [{ id: 's1' }, { id: 's2' }, { id: 's3' }];
  const { bills, total } = planBulkBills({
    students,
    allocations: [
      alloc('x', 's3', 3, '2026-10-10', '4500.10'),
      alloc('a', 's1', 4, '2027-01-10', '13500.00'),
      alloc('b', 's1', 3, '2026-10-10', '13500.00'),
      alloc('c', 's1', 3, '2026-10-10', '4500.00'),
    ],
  });
  assert.deepEqual(bills.map((b) => b.student.id), ['s1', 's3']);
  assert.equal(bills[0].total, 3150000);
  assert.equal(bills[0].dueDate, '2026-10-10');               // earliest due date of the bill
  assert.equal(bills[0].periodLabel, 'Instalments 3–4');
  assert.deepEqual(bills[0].allocations.map((a) => a.id).slice(0, 1), ['b']);
  assert.equal(bills[1].total, 450010);
  assert.equal(total, 3150000 + 450010);
});

test('planBulkBills: nobody to bill', () => {
  assert.deepEqual(planBulkBills({ students: [{ id: 's1' }], allocations: [] }), { bills: [], total: 0 });
});

test('allocationLines copies amounts and concessions unchanged', () => {
  const [line] = allocationLines([alloc('a', 's', 3, '2026-10-10', '9000.00', { base_amount: '10000.00', concession_amount: '1000.00' })]);
  assert.deepEqual(line, { allocation_id: 'a', fee_head_id: 'h-a', description: 'Tuition (installment 3)', amount: '10000.00', concession_amount: '1000.00' });
});
