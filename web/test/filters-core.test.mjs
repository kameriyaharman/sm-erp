// Unit tests for src/lib/filters-core.ts. Run: cd web && npm test (Node 22 strips the types).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFilters, readPage, writeFilters, clearFilters, countActive,
  addDays, startOfWeek, monthBounds, academicYearBounds, presetRange, matchPreset, describeRange, isIsoDate,
} from '../src/lib/filters-core.ts';

const sp = (q) => new URLSearchParams(q);
const DEF = { search: '', classId: '', sectionId: '', status: 'all', sort: 'pending' };

test('readFilters: defaults, URL values, aliases (real key wins)', () => {
  assert.deepEqual(readFilters(sp(''), DEF), DEF);
  assert.deepEqual(readFilters(sp('classId=c1&status=overdue&other=x'), DEF), { ...DEF, classId: 'c1', status: 'overdue' });
  assert.equal(readFilters(sp('class=c9'), DEF, { class: 'classId' }).classId, 'c9');
  assert.equal(readFilters(sp('class=c9&classId=c1'), DEF, { class: 'classId' }).classId, 'c1');
  // an explicitly empty value overrides a non-empty default ("everyone")
  assert.equal(readFilters(sp('status='), DEF).status, '');
});

test('readPage: 1 unless a valid page > 1', () => {
  assert.equal(readPage(sp('')), 1);
  assert.equal(readPage(sp('page=3')), 3);
  assert.equal(readPage(sp('page=0')), 1);
  assert.equal(readPage(sp('page=abc')), 1);
  assert.equal(readPage(sp('page=2.5')), 1);
});

test('writeFilters: drops defaults, keeps other keys, resets page', () => {
  assert.equal(writeFilters('tab=day&page=4', { classId: 'c1' }, DEF), 'tab=day&classId=c1');
  assert.equal(writeFilters('classId=c1&sectionId=s1', { classId: '', sectionId: '' }, DEF), '');
  assert.equal(writeFilters('status=overdue', { status: 'all' }, DEF), '');
  assert.equal(writeFilters('', { status: '' }, DEF), 'status=');
  assert.equal(writeFilters('classId=c1', { page: 3 }, DEF), 'classId=c1&page=3');
  assert.equal(writeFilters('classId=c1&page=3', { page: 1 }, DEF), 'classId=c1');
  assert.equal(writeFilters('class=c9&page=2', { classId: 'c2' }, DEF, { class: 'classId' }), 'classId=c2');
  assert.equal(writeFilters('', { search: 'aarav sharma' }, DEF), 'search=aarav+sharma');
  assert.equal(writeFilters('', { classId: null }, DEF), '');
});

test('clearFilters: removes filter keys, aliases and page, keeps the rest', () => {
  assert.equal(clearFilters('tab=range&classId=c1&status=paid&page=2&class=x', DEF, { class: 'classId' }), 'tab=range');
  assert.equal(clearFilters('sort=name&classId=c1', DEF, {}, ['sort']), 'sort=name');
});

test('countActive ignores sort by default', () => {
  assert.equal(countActive(DEF, DEF), 0);
  assert.equal(countActive({ ...DEF, classId: 'c', search: 'x', sort: 'name' }, DEF), 2);
  assert.equal(countActive({ ...DEF, sort: 'name' }, DEF, []), 1);
});

test('date helpers', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(startOfWeek('2026-10-04'), '2026-09-28'); // Sunday -> previous Monday
  assert.equal(startOfWeek('2026-10-05'), '2026-10-05'); // Monday
  assert.equal(startOfWeek('2026-10-10'), '2026-10-05'); // Saturday
  assert.deepEqual(monthBounds('2024-02-10'), { from: '2024-02-01', to: '2024-02-29' });
  assert.deepEqual(academicYearBounds('2026-10-04'), { from: '2026-04-01', to: '2027-03-31' });
  assert.deepEqual(academicYearBounds('2027-02-01'), { from: '2026-04-01', to: '2027-03-31' });
  assert.deepEqual(academicYearBounds('2026-05-01', 6), { from: '2025-06-01', to: '2026-05-31' });
  assert.ok(isIsoDate('2026-10-04'));
  assert.ok(!isIsoDate('2026-13-40'));
  assert.ok(!isIsoDate('04-10-2026'));
});

test('presets: ranges and matching', () => {
  const today = '2026-10-04';
  assert.deepEqual(presetRange('today', today), { from: today, to: today });
  assert.deepEqual(presetRange('week', today), { from: '2026-09-28', to: '2026-10-04' });
  assert.deepEqual(presetRange('month', today), { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(presetRange('last_month', '2026-01-15'), { from: '2025-12-01', to: '2025-12-31' });
  assert.deepEqual(presetRange('year', today), { from: '2026-04-01', to: '2027-03-31' });
  const year = { from: '2026-06-01', to: '2027-05-31' };
  assert.deepEqual(presetRange('year', today, year), year);
  assert.deepEqual(presetRange('custom', today), { from: '', to: '' });
  assert.equal(matchPreset('', '', today), '');
  assert.equal(matchPreset('2026-10-01', '2026-10-31', today), 'month');
  assert.equal(matchPreset(today, today, today), 'today');
  assert.equal(matchPreset('2026-10-02', '2026-10-03', today), 'custom');
  assert.equal(matchPreset('2026-10-02', '', today), 'custom');
});

test('describeRange: preset names and readable dates', () => {
  const today = '2026-10-04';
  assert.equal(describeRange('2026-10-01', '2026-10-31', today), 'This month');
  assert.equal(describeRange('2026-09-03', '2026-09-09', today), '3 Sept – 9 Sept 2026'.replace(/Sept/g, new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' }).format(new Date('2026-09-03T00:00:00Z'))));
  assert.match(describeRange('2026-09-03', '', today), /^From 3 /);
  assert.match(describeRange('', '2026-09-09', today), /^Up to 9 /);
  assert.equal(describeRange('', '', today), '');
});
