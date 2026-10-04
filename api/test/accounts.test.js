import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  csvCell, dailyRollup, datesBetween, fyKey, incomeExpenseSummary, openingOn, plainRupees, toCsv, withRunningBalance,
} from '../src/modules/accounts/daybook.helpers.js';

test('running balance: opening + in - out = closing, row by row', () => {
  const r = withRunningBalance(5000000, [
    { id: 'a', direction: 'in', amount: 1500000 },
    { id: 'b', direction: 'out', amount: 845000 },
    { id: 'c', direction: 'in', amount: 1 },
  ]);
  assert.deepEqual(r.entries.map((e) => [e.in, e.out, e.balance]), [[1500000, 0, 6500000], [0, 845000, 5655000], [1, 0, 5655001]]);
  assert.equal(r.totalIn, 1500001);
  assert.equal(r.totalOut, 845000);
  assert.equal(r.closing, r.opening + r.totalIn - r.totalOut);
});

test('running balance on an empty day keeps the opening; it may go negative', () => {
  assert.deepEqual(withRunningBalance(1200, []), { entries: [], opening: 1200, totalIn: 0, totalOut: 0, closing: 1200 });
  assert.equal(withRunningBalance(100, [{ direction: 'out', amount: 300 }]).closing, -200);
  assert.throws(() => withRunningBalance(0, [{ direction: 'in', amount: 10.5 }]), RangeError);
  assert.throws(() => withRunningBalance(0, [{ direction: 'in', amount: 0 }]), RangeError);
});

test('opening balance counts an account only from its opening date', () => {
  const accounts = [
    { openingBalance: 5000000, openingDate: '2026-04-01', before: 120000 },
    { openingBalance: 25000000, openingDate: '2026-06-01', before: 0 },
  ];
  assert.equal(openingOn('2026-05-15', accounts), 5120000);
  assert.equal(openingOn('2026-06-01', accounts), 30120000);
});

test('daily roll-up chains closing into the next opening and adds accounts opened later', () => {
  const totals = new Map([
    ['2026-04-01', { in: 1000, out: 0, count: 1 }],
    ['2026-04-03', { in: 0, out: 400, count: 2 }],
  ]);
  const r = dailyRollup({ from: '2026-04-01', to: '2026-04-03', opening: 500, totals, openedOn: new Map([['2026-04-02', 10000]]) });
  assert.deepEqual(r.days.map((d) => [d.date, d.opening, d.in, d.out, d.closing]), [
    ['2026-04-01', 500, 1000, 0, 1500],
    ['2026-04-02', 11500, 0, 0, 11500],
    ['2026-04-03', 11500, 0, 400, 11100],
  ]);
  assert.equal(r.totalIn, 1000);
  assert.equal(r.totalOut, 400);
  assert.equal(r.closing, 11100);
});

test('dates between, across a month end', () => {
  assert.deepEqual(datesBetween('2026-03-30', '2026-04-02'), ['2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02']);
  assert.deepEqual(datesBetween('2026-04-02', '2026-04-01'), []);
});

test('income vs expense: transfers ignored, fee refunds reduce fee income', () => {
  const s = incomeExpenseSummary([
    { direction: 'in', category: 'fees', amount: 3000000 },
    { direction: 'in', category: 'fees', amount: 1500000 },
    { direction: 'out', category: 'fee_refund', amount: 500000 },
    { direction: 'in', category: 'donation', amount: 1100000 },
    { direction: 'out', category: 'salary', amount: 4125000 },
    { direction: 'out', category: 'transfer', amount: 2000000 },
    { direction: 'in', category: 'transfer', amount: 2000000 },
  ]);
  assert.deepEqual(s.income, [{ category: 'fees', amount: 4000000 }, { category: 'donation', amount: 1100000 }]);
  assert.deepEqual(s.expense, [{ category: 'salary', amount: 4125000 }]);
  assert.equal(s.feeRefunds, 500000);
  assert.equal(s.totalIncome, 5100000);
  assert.equal(s.net, 5100000 - 4125000);
});

test('financial year key', () => {
  assert.equal(fyKey('2026-04-01'), '2026-27');
  assert.equal(fyKey('2027-03-31'), '2026-27');
  assert.equal(fyKey('2099-12-31'), '2099-00');
});

test('CSV cells: quoting, formula injection, numbers', () => {
  assert.equal(csvCell('Sharma, Stationers'), '"Sharma, Stationers"');
  assert.equal(csvCell('He said "hi"'), '"He said ""hi"""');
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell('-5'), "'-5");
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(12), '12');
  assert.equal(plainRupees(123450), '1234.50');
  assert.equal(plainRupees(-5), '-0.05');
  assert.equal(toCsv([['a', 'b'], [1, 'c,d']]), 'a,b\r\n1,"c,d"\r\n');
});
