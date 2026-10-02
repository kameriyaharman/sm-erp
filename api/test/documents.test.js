import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEMES, attendanceSummary, computeStudentResult, gradeFor, rankByPercentage, scoreComponent, suggestResult,
} from '../src/modules/documents/report-card.calculator.js';
import { classInWords, dateInWords, formatDate, numberInWords } from '../src/modules/documents/pdf/words.js';

const scheme = SCHEMES.cbse_6_8;
const T1 = 't1';
const T2 = 't2';
const terms = [{ id: T1, name: 'Term 1' }, { id: T2, name: 'Term 2' }];
const subjects = [
  { id: 'eng', name: 'English', code: 'ENG', isGradedOnly: false, displayOrder: 1 },
  { id: 'mat', name: 'Mathematics', code: 'MAT', isGradedOnly: false, displayOrder: 2 },
  { id: 'art', name: 'Art Education', code: 'ART', isGradedOnly: true, displayOrder: 10 },
  { id: 'disc', name: 'Discipline', code: 'DISC', isGradedOnly: true, displayOrder: 11 },
];
const m = (subjectId, termId, component, marksObtained, maxMarks, extra = {}) => ({ subjectId, termId, component, marksObtained, maxMarks, isAbsent: false, isExempted: false, ...extra });

test('CBSE grade boundaries (rounded half-up to a whole percentage)', () => {
  assert.equal(gradeFor(100).grade, 'A1');
  assert.equal(gradeFor(91).grade, 'A1');
  assert.equal(gradeFor(90.5).grade, 'A1');
  assert.equal(gradeFor(90.49).grade, 'A2');
  assert.equal(gradeFor(81).grade, 'A2');
  assert.equal(gradeFor(71).grade, 'B1');
  assert.equal(gradeFor(61).grade, 'B2');
  assert.equal(gradeFor(51).grade, 'C1');
  assert.equal(gradeFor(41).grade, 'C2');
  assert.equal(gradeFor(33).grade, 'D');
  assert.equal(gradeFor(32.49).grade, 'E');
  assert.equal(gradeFor(0).grade, 'E');
  assert.equal(gradeFor(null), null);
});

test('periodic test = average of best two, scaled to 10; absent counts as zero; exempt is skipped', () => {
  const pt = scheme.components.find((c) => c.code === 'PT');
  const r = scoreComponent(pt, [
    { marksObtained: 36, maxMarks: 40 }, { marksObtained: 20, maxMarks: 40 }, { marksObtained: 32, maxMarks: 40 },
  ]);
  assert.deepEqual(r, { score: 8.5, max: 10, entries: 3 }); // (0.9 + 0.8) / 2 * 10
  assert.equal(scoreComponent(pt, [{ isAbsent: true, marksObtained: null, maxMarks: 40 }]).score, 0);
  assert.equal(scoreComponent(pt, [{ isExempted: true, maxMarks: 40 }]), null);
});

test('term totals out of 100, overall out of 200, co-scholastic and discipline separated', () => {
  const marks = [
    m('eng', T1, 'PT', 18, 20), m('eng', T1, 'NB', 5, 5), m('eng', T1, 'SEA', 4, 5), m('eng', T1, 'TERM', 72, 80),
    m('eng', T2, 'PT', 20, 20), m('eng', T2, 'NB', 5, 5), m('eng', T2, 'SEA', 5, 5), m('eng', T2, 'TERM', 76, 80),
    m('mat', T1, 'PT', 10, 20), m('mat', T1, 'NB', 3, 5), m('mat', T1, 'SEA', 3, 5), m('mat', T1, 'TERM', 20, 80),
    m('mat', T2, 'PT', 8, 20), m('mat', T2, 'NB', 3, 5), m('mat', T2, 'SEA', 2, 5), m('mat', T2, 'TERM', 16, 80),
    { subjectId: 'art', termId: T1, component: 'TERM', grade: 'a', examDate: '2026-09-20' },
    { subjectId: 'art', termId: T2, component: 'TERM', grade: 'B', examDate: '2027-03-01' },
    { subjectId: 'disc', termId: T1, component: 'TERM', grade: 'A', examDate: '2026-09-20' },
  ];
  const r = computeStudentResult({ scheme, terms, subjects, marks });
  const eng = r.scholastic.find((s) => s.code === 'ENG');
  assert.equal(eng.terms[T1].obtained, 90); // 9 + 5 + 4 + 72
  assert.equal(eng.terms[T1].grade, 'A2');
  assert.equal(eng.terms[T2].obtained, 96);
  assert.equal(eng.obtained, 186);
  assert.equal(eng.max, 200);
  assert.equal(eng.grade, 'A1'); // 93%
  const mat = r.scholastic.find((s) => s.code === 'MAT');
  assert.equal(mat.terms[T1].obtained, 31); // 5 + 3 + 3 + 20
  assert.equal(mat.grade, 'E');
  assert.equal(mat.passed, false);
  assert.deepEqual(r.failedSubjects, ['Mathematics']);
  assert.equal(r.totals.max, 400);
  assert.deepEqual(r.coScholastic.map((c) => [c.name, c.grades[T1], c.grades[T2]]), [['Art Education', 'A', 'B']]);
  assert.equal(r.discipline.grades[T1], 'A');
  assert.equal(r.discipline.grades[T2], null);
  assert.equal(r.complete, true);
  assert.equal(suggestResult({ isFinal: true, ...r }), 'detained');
  assert.equal(suggestResult({ isFinal: false, ...r }), 'pending');
});

test('missing half-yearly exam makes the result incomplete (no rank, result pending)', () => {
  const r = computeStudentResult({ scheme, terms: [terms[0]], subjects, marks: [m('eng', T1, 'PT', 18, 20)] });
  assert.equal(r.complete, false);
  assert.equal(r.scholastic[0].terms[T1].max, 10);
  assert.equal(suggestResult({ isFinal: true, ...r }), 'pending');
});

test('competition ranking: ties share a rank, incomplete students are unranked', () => {
  const ranks = rankByPercentage([
    { key: 'a', percentage: 91.5, complete: true },
    { key: 'b', percentage: 88, complete: true },
    { key: 'c', percentage: 91.5, complete: true },
    { key: 'd', percentage: 99, complete: false },
    { key: 'e', percentage: 70, complete: true },
  ]);
  assert.deepEqual(Object.fromEntries(ranks), { a: 1, b: 3, c: 1, d: null, e: 4 });
});

test('attendance: present + late + half-day attended; leave and absent are working days', () => {
  assert.deepEqual(attendanceSummary({ present: 170, late: 5, half_day: 2, absent: 10, leave: 3 }), { working: 190, attended: 177, percentage: 93.16 });
  assert.deepEqual(attendanceSummary({}), { working: 0, attended: 0, percentage: null });
});

test('dates and classes in words for certificates', () => {
  assert.equal(dateInWords('2014-03-12'), 'Twelfth March Two Thousand Fourteen');
  assert.equal(dateInWords('2013-11-21'), 'Twenty-First November Two Thousand Thirteen');
  assert.equal(dateInWords('2010-01-30'), 'Thirtieth January Two Thousand Ten');
  assert.equal(dateInWords('1999-12-31'), 'Thirty-First December One Thousand Nine Hundred Ninety-Nine');
  assert.equal(formatDate('2014-03-02'), '02-03-2014');
  assert.equal(numberInWords(2026), 'Two Thousand Twenty-Six');
  assert.equal(classInWords(7, 'Grade 7'), 'VII (Seven)');
  assert.equal(classInWords(-1, 'LKG'), 'LKG');
});
