import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addMonths, concessionPaise, generateInstallments, monthsBetween, pickRule, splitAmount, structureTotals, validateStructureRows,
} from '../src/modules/fee-setup/schedule.helpers.js';

test('quarterly schedule from April is due on the 10th of Apr / Jul / Oct / Jan', () => {
  const rows = generateInstallments({ frequency: 'quarterly', yearStart: '2026-04-01', dueDay: 10, amount: 1500000 });
  assert.deepEqual(rows, [
    { installmentNo: 1, label: 'Q1 (Apr-Jun)', dueDate: '2026-04-10', amount: 1500000 },
    { installmentNo: 2, label: 'Q2 (Jul-Sep)', dueDate: '2026-07-10', amount: 1500000 },
    { installmentNo: 3, label: 'Q3 (Oct-Dec)', dueDate: '2026-10-10', amount: 1500000 },
    { installmentNo: 4, label: 'Q4 (Jan-Mar)', dueDate: '2027-01-10', amount: 1500000 },
  ]);
});

test('monthly schedule has 12 instalments, labels cross the calendar year, day clamped in short months', () => {
  const rows = generateInstallments({ frequency: 'monthly', yearStart: '2026-04-01', dueDay: 31, amount: 250000 });
  assert.equal(rows.length, 12);
  assert.equal(rows[0].label, 'Apr 2026');
  assert.equal(rows[0].dueDate, '2026-04-30');
  assert.equal(rows[9].label, 'Jan 2027');
  assert.equal(rows[10].dueDate, '2027-02-28');
  assert.equal(rows[11].dueDate, '2027-03-31');
});

test('half-yearly, annual and one-time schedules', () => {
  assert.deepEqual(
    generateInstallments({ frequency: 'half_yearly', yearStart: '2026-04-01', dueDay: 15, amount: 100 }).map((r) => [r.label, r.dueDate]),
    [['Term 1 (Apr-Sep)', '2026-04-15'], ['Term 2 (Oct-Mar)', '2026-10-15']],
  );
  assert.deepEqual(generateInstallments({ frequency: 'annual', yearStart: '2026-04-01', amount: 500000 }), [
    { installmentNo: 1, label: 'Annual', dueDate: '2026-04-10', amount: 500000 },
  ]);
  assert.equal(generateInstallments({ frequency: 'one_time', yearStart: '2026-04-01', dueDay: 1, amount: 1 })[0].label, 'One-time');
});

test('a yearly total is split exactly, whole rupees stay whole', () => {
  assert.deepEqual(splitAmount(1000000, 3), [333400, 333300, 333300]);
  assert.deepEqual(splitAmount(100, 4), [100, 0, 0, 0]);
  assert.deepEqual(splitAmount(1001, 4), [251, 250, 250, 250]);
  for (const [total, n] of [[1800000, 12], [999999, 4], [7, 2], [0, 4]]) {
    assert.equal(splitAmount(total, n).reduce((a, b) => a + b, 0), total);
  }
  const rows = generateInstallments({ frequency: 'monthly', yearStart: '2026-04-01', total: 1850000 });
  assert.equal(rows.reduce((a, r) => a + r.amount, 0), 1850000);
});

test('schedule input is checked', () => {
  assert.throws(() => generateInstallments({ frequency: 'weekly', yearStart: '2026-04-01', amount: 1 }), RangeError);
  assert.throws(() => generateInstallments({ frequency: 'monthly', yearStart: '2026-04-01' }), RangeError);
  assert.throws(() => generateInstallments({ frequency: 'monthly', yearStart: '2026-04-01', amount: 1, total: 12 }), RangeError);
  assert.throws(() => generateInstallments({ frequency: 'monthly', yearStart: '2026-04-01', dueDay: 0, amount: 1 }), RangeError);
});

test('date helpers', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(addMonths('2026-04-10', 12), '2027-04-10');
  assert.equal(addMonths('2026-04-10', -4), '2025-12-10');
  assert.equal(monthsBetween('2025-04-01', '2026-04-01'), 12);
  assert.equal(monthsBetween('2026-04-01', '2026-01-15'), -3);
});

test('concession maths in paise', () => {
  assert.equal(concessionPaise({ type: 'percentage', value: 10, base: 1500000 }), 150000);
  assert.equal(concessionPaise({ type: 'percentage', value: 12.5, base: 333333 }), 41667); // 41666.625 -> half up
  assert.equal(concessionPaise({ type: 'percentage', value: 33.33, base: 100 }), 33);
  assert.equal(concessionPaise({ type: 'percentage', value: 100, base: 450000 }), 450000);
  assert.equal(concessionPaise({ type: 'flat', value: 50000, base: 450000 }), 50000);
  assert.equal(concessionPaise({ type: 'flat', value: 500000, base: 450000 }), 450000);
  assert.equal(concessionPaise({ type: 'full_waiver', base: 450000 }), 450000);
  assert.equal(concessionPaise({ type: 'none', base: 450000 }), 0);
  assert.throws(() => concessionPaise({ type: 'percentage', value: 101, base: 1 }), RangeError);
});

test('a head-specific concession rule wins over an all-heads rule', () => {
  const rules = [{ feeHeadId: null, type: 'percentage', value: 5 }, { feeHeadId: 'tui', type: 'full_waiver' }];
  assert.equal(pickRule(rules, 'tui').type, 'full_waiver');
  assert.equal(pickRule(rules, 'trn').value, 5);
  assert.equal(pickRule([], 'trn'), null);
});

test('structure totals per head, per instalment and per year', () => {
  const t = structureTotals([
    { feeHeadId: 'tui', installmentNo: 1, amount: 1500000 },
    { feeHeadId: 'tui', installmentNo: 2, amount: 1500000 },
    { feeHeadId: 'trn', installmentNo: 1, amount: 450000 },
    { feeHeadId: 'adm', installmentNo: 1, amount: 500000 },
  ]);
  assert.equal(t.annual, 3950000);
  assert.deepEqual(t.byHead, { tui: 3000000, trn: 450000, adm: 500000 });
  assert.deepEqual(t.byInstallment, { 1: 2450000, 2: 1500000 });
});

test('structure rows: duplicates, mixed frequencies, too many instalments, dates outside the year', () => {
  const year = { startDate: '2026-04-01', endDate: '2027-03-31' };
  const ok = [
    { feeHeadId: 'a', frequency: 'quarterly', installmentNo: 1, dueDate: '2026-04-10', amount: 1 },
    { feeHeadId: 'b', frequency: 'one_time', installmentNo: 1, dueDate: '2026-02-15', amount: 1 }, // admission, before the year
  ];
  assert.deepEqual(validateStructureRows(ok, year), []);
  const issues = validateStructureRows(
    [
      ...ok,
      { feeHeadId: 'a', frequency: 'quarterly', installmentNo: 1, dueDate: '2026-07-10', amount: 1 },
      { feeHeadId: 'a', frequency: 'monthly', installmentNo: 2, dueDate: '2026-05-10', amount: 1 },
      { feeHeadId: 'b', frequency: 'one_time', installmentNo: 2, dueDate: '2026-04-10', amount: 1 },
      { feeHeadId: 'c', frequency: 'annual', installmentNo: 1, dueDate: '2027-04-10', amount: 1 },
    ],
    year,
  );
  assert.deepEqual(issues.map((i) => i.path), ['rows.2.installmentNo', 'rows.3.frequency', 'rows.4.installmentNo', 'rows.5.dueDate']);
});
