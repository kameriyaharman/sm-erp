import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargeBody } from '../src/modules/fees/fees.schemas.js';
import { planCharge } from '../src/modules/fees/charges.helpers.js';

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('planCharge bills everyone once, skipping students already billed in this batch', () => {
  const students = [{ id: U(1) }, { id: U(2) }, { id: U(3) }];
  assert.deepEqual(planCharge({ students, amount: 50000 }), { toBill: students, skipped: 0, total: 150000 });
  const retry = planCharge({ students, alreadyBilled: [U(1), U(3)], amount: 50000 });
  assert.deepEqual(retry.toBill.map((s) => s.id), [U(2)]);
  assert.equal(retry.skipped, 2);
  assert.equal(retry.total, 50000);
  // a full retry bills nobody
  assert.deepEqual(planCharge({ students, alreadyBilled: students.map((s) => s.id), amount: 50000 }), { toBill: [], skipped: 3, total: 0 });
  assert.deepEqual(planCharge({ students: [], amount: 100 }), { toBill: [], skipped: 0, total: 0 });
});

const base = { feeHeadId: U(9), description: 'Annual picnic', amount: '450', dueDate: '2026-11-15', batchId: U(7) };

test('chargeBody: student or class (+ section) scope, rupees to paise, strict', () => {
  const one = chargeBody.parse({ ...base, scope: { studentId: U(1) } });
  assert.equal(one.amount, 45000);
  assert.equal(one.dryRun, false);
  const cls = chargeBody.parse({ ...base, amount: 120.5, scope: { classId: U(2), sectionId: U(3) } });
  assert.equal(cls.amount, 12050);
  assert.deepEqual(cls.scope, { classId: U(2), sectionId: U(3) });
  assert.ok(chargeBody.safeParse({ ...base, scope: { classId: U(2) } }).success);
  // both shapes at once, unknown keys, or no scope are refused
  assert.equal(chargeBody.safeParse({ ...base, scope: { studentId: U(1), classId: U(2) } }).success, false);
  assert.equal(chargeBody.safeParse({ ...base, scope: { sectionId: U(3) } }).success, false);
  assert.equal(chargeBody.safeParse({ ...base, scope: { classId: U(2) }, extra: 1 }).success, false);
  assert.equal(chargeBody.safeParse({ ...base }).success, false);
});

test('chargeBody: amount, description and date rules; batchId required unless dryRun', () => {
  const scope = { classId: U(2) };
  for (const amount of ['0', '-5', '12.345', 'abc']) {
    assert.equal(chargeBody.safeParse({ ...base, scope, amount }).success, false, amount);
  }
  assert.equal(chargeBody.safeParse({ ...base, scope, description: ' x ' }).success, false);
  assert.equal(chargeBody.safeParse({ ...base, scope, dueDate: '15-11-2026' }).success, false);
  const { batchId: _b, ...noBatch } = base;
  const missing = chargeBody.safeParse({ ...noBatch, scope });
  assert.equal(missing.success, false);
  assert.deepEqual(missing.error.issues[0].path, ['batchId']);
  assert.ok(chargeBody.safeParse({ ...noBatch, scope, dryRun: true }).success);
});
