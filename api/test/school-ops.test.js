import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  attendanceStats, emptyWeek, monthRange, monthsBetween, nextRollNumber, nextSequenceCode, overlaps, splitName, validateTimetable,
} from '../src/modules/shared/school-ops.helpers.js';

test('attendance percentage counts late as present and half day as half', () => {
  const s = attendanceStats({ present: 20, absent: 1, late: 1, leave: 0, half_day: 0 });
  assert.deepEqual(s, { workingDays: 22, present: 20, absent: 1, late: 1, leave: 0, halfDay: 0, percentage: 95.5 });
  assert.equal(attendanceStats({ present: 9, half_day: 1 }).percentage, 95);
  assert.equal(attendanceStats({ present: 2, absent: 1 }).percentage, 66.7);
  assert.equal(attendanceStats({ halfDay: 1, leave: 1 }).percentage, 25);
});

test('attendance with no marked days has no percentage', () => {
  assert.equal(attendanceStats({}).percentage, null);
  assert.equal(attendanceStats({}).workingDays, 0);
});

test('next admission number follows the newest pattern and keeps padding', () => {
  assert.equal(nextSequenceCode(['DPS-1027', 'DPS-1001', 'DPS-1015']), 'DPS-1028');
  assert.equal(nextSequenceCode(['ADM/2024/009', 'ADM/2024/003']), 'ADM/2024/010');
  assert.equal(nextSequenceCode(['EMP-099']), 'EMP-100');
  // Newest first: the newest code's prefix wins over an older scheme with bigger numbers.
  assert.equal(nextSequenceCode(['NEW-0005', 'OLD-9999', 'NEW-0002']), 'NEW-0006');
  assert.equal(nextSequenceCode(['1200', '1199']), '1201');
});

test('next admission number falls back when nothing parses', () => {
  assert.equal(nextSequenceCode([]), 'ADM-0001');
  assert.equal(nextSequenceCode(['ABC', '']), 'ADM-0001');
  assert.equal(nextSequenceCode([], 'EMP-001'), 'EMP-001');
});

test('next roll number is the highest numeric roll + 1', () => {
  assert.equal(nextRollNumber(['1', '2', '15', '3']), '16');
  assert.equal(nextRollNumber([]), '1');
  assert.equal(nextRollNumber(['A-4', null, '2']), '5');
});

const period = (weekday, periodNo, start, end, extra = {}) => ({ weekday, periodNo, start, end, kind: 'class', subjectId: 's1', ...extra });

test('a valid week has no timetable issues', () => {
  const week = [
    period(1, 1, '08:00', '08:20', { kind: 'assembly', subjectId: undefined, label: 'Assembly' }),
    period(1, 2, '08:20', '09:00'),
    period(1, 3, '09:00', '09:40'),
    period(2, 1, '08:00', '08:40'),
    period(2, 2, '11:00', '11:30', { kind: 'break', subjectId: undefined }),
  ];
  assert.deepEqual(validateTimetable(week), []);
});

test('timetable validation reports bad times, overlaps, duplicates and missing subjects', () => {
  const issues = validateTimetable([
    period(1, 1, '08:00', '08:40'),
    period(1, 2, '08:30', '09:10'),                         // overlaps period 1
    period(1, 2, '10:00', '10:40'),                         // period 2 twice on Monday
    period(2, 1, '09:00', '08:00'),                         // ends before it starts
    period(3, 1, '08:00', '08:40', { subjectId: undefined }), // class without subject
  ]);
  const paths = issues.map((i) => i.path).sort();
  assert.deepEqual(paths, ['periods.1.start', 'periods.2.periodNo', 'periods.3.end', 'periods.4.subjectId']);
});

test('time ranges that only touch do not overlap', () => {
  assert.equal(overlaps({ start: '08:00', end: '08:40' }, { start: '08:40', end: '09:20' }), false);
  assert.equal(overlaps({ start: '08:00', end: '08:40' }, { start: '08:39', end: '09:20' }), true);
});

test('calendar helpers', () => {
  assert.deepEqual(monthRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(monthRange('2028-02'), { from: '2028-02-01', to: '2028-02-29' });
  assert.deepEqual(monthsBetween('2026-11-15', '2027-02-01'), ['2026-11', '2026-12', '2027-01', '2027-02']);
  assert.deepEqual(monthsBetween('2026-04-01', '2026-03-31'), []);
  assert.deepEqual(Object.keys(emptyWeek()), ['1', '2', '3', '4', '5', '6']);
});

test('parent names split into first and last name', () => {
  assert.deepEqual(splitName('Rakesh Kumar Sharma'), { firstName: 'Rakesh Kumar', lastName: 'Sharma' });
  assert.deepEqual(splitName('  Meera  '), { firstName: 'Meera', lastName: null });
});
