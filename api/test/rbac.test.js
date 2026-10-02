import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasSection, isClassTeacher, makeTeacherScope, marksAccess, paperSectionsForTeacher, takenPairs, teacherClashes, teaches, uniquePairs,
} from '../src/modules/shared/teacher-scope.helpers.js';

// English teacher of 5A and 6A, class teacher of 5A.
const S5A = 's5a';
const S5B = 's5b';
const S6A = 's6a';
const ENG = 'eng';
const MAT = 'mat';
const english = makeTeacherScope({
  staffId: 'priya',
  classTeacherOf: [S5A],
  assignments: [{ sectionId: S5A, subjectId: ENG }, { sectionId: S6A, subjectId: ENG }],
});
const none = makeTeacherScope();

test('teaches: only the exact (section, subject) pairs', () => {
  assert.equal(teaches(english, S5A, ENG), true);
  assert.equal(teaches(english, S6A, ENG), true);
  assert.equal(teaches(english, S5A, MAT), false);
  assert.equal(teaches(english, S5B, ENG), false);
  assert.equal(teaches(english, S5A, undefined), false);
  assert.equal(teaches(english, null, ENG), false);
  assert.equal(teaches(none, S5A, ENG), false);
});

test('sections = class-teacher sections + assigned sections', () => {
  assert.deepEqual([...english.sectionIds].sort(), [S5A, S6A]);
  assert.equal(hasSection(english, S5B), false);
  assert.equal(isClassTeacher(english, S5A), true);
  assert.equal(isClassTeacher(english, S6A), false);
  const ctOnly = makeTeacherScope({ staffId: 'x', classTeacherOf: [S5B] });
  assert.equal(hasSection(ctOnly, S5B), true);
  assert.equal(none.sectionIds.size, 0);
});

test('marksAccess: subject teacher edits, class teacher views, others nothing', () => {
  assert.equal(marksAccess(english, S5A, ENG), 'edit');
  assert.equal(marksAccess(english, S6A, ENG), 'edit');
  assert.equal(marksAccess(english, S5A, MAT), 'view');   // class teacher of 5A
  assert.equal(marksAccess(english, S6A, MAT), null);     // not class teacher of 6A
  assert.equal(marksAccess(english, S5B, ENG), null);
});

test('paperSectionsForTeacher: class-wide paper', () => {
  const grade5 = [{ id: S5A, label: 'Grade 5 A' }, { id: S5B, label: 'Grade 5 B' }];
  assert.deepEqual(paperSectionsForTeacher(english, { subjectId: ENG, sectionId: null }, grade5), [
    { id: S5A, label: 'Grade 5 A', canEdit: true },
  ]);
  // A Maths paper: the English teacher teaches no Maths in Grade 5 -> not on their marks screen.
  assert.equal(paperSectionsForTeacher(english, { subjectId: MAT, sectionId: null }, grade5), null);
});

test('paperSectionsForTeacher: class-teacher section is added read-only', () => {
  const t = makeTeacherScope({ staffId: 't', classTeacherOf: [S5A], assignments: [{ sectionId: S5B, subjectId: MAT }] });
  const grade5 = [{ id: S5A, label: 'Grade 5 A' }, { id: S5B, label: 'Grade 5 B' }];
  assert.deepEqual(paperSectionsForTeacher(t, { subjectId: MAT, sectionId: null }, grade5), [
    { id: S5A, label: 'Grade 5 A', canEdit: false },
    { id: S5B, label: 'Grade 5 B', canEdit: true },
  ]);
  // Section-specific paper for 5A only: they teach Maths in 5B, not 5A -> not theirs.
  assert.equal(paperSectionsForTeacher(t, { subjectId: MAT, sectionId: S5A }, grade5), null);
  assert.deepEqual(paperSectionsForTeacher(t, { subjectId: MAT, sectionId: S5B }, grade5), [{ id: S5B, label: 'Grade 5 B', canEdit: true }]);
});

test('takenPairs: pairs held by another teacher only', () => {
  const held = [
    { sectionId: S5A, subjectId: ENG, staffId: 'priya' },
    { sectionId: S5A, subjectId: MAT, staffId: 'neha' },
    { sectionId: S6A, subjectId: MAT, staffId: 'neha' },
  ];
  const wanted = [{ sectionId: S5A, subjectId: ENG }, { sectionId: S5A, subjectId: MAT }];
  assert.deepEqual(takenPairs(wanted, held, 'priya'), [{ sectionId: S5A, subjectId: MAT, staffId: 'neha' }]);
  assert.deepEqual(takenPairs(wanted, held, 'neha'), [{ sectionId: S5A, subjectId: ENG, staffId: 'priya' }]);
  assert.deepEqual(takenPairs([], held, 'priya'), []);
});

test('uniquePairs drops duplicates', () => {
  const p = [{ sectionId: S5A, subjectId: ENG }, { sectionId: S5A, subjectId: ENG }, { sectionId: S6A, subjectId: ENG }];
  assert.equal(uniquePairs(p).length, 2);
});

test('teacherClashes: same teacher, same weekday + period, different sections', () => {
  const periods = [
    { id: 1, sectionId: S5A, weekday: 1, periodNo: 2, teacherStaffId: 'priya' },
    { id: 2, sectionId: S6A, weekday: 1, periodNo: 2, teacherStaffId: 'priya' },
    { id: 3, sectionId: S6A, weekday: 2, periodNo: 2, teacherStaffId: 'priya' },
    { id: 4, sectionId: S5A, weekday: 1, periodNo: 3, teacherStaffId: null },
    { id: 5, sectionId: S6A, weekday: 1, periodNo: 3, teacherStaffId: null },
  ];
  const clashes = teacherClashes(periods);
  assert.equal(clashes.length, 1);
  assert.deepEqual(clashes[0].map((p) => p.id), [1, 2]);
  assert.equal(teacherClashes(periods.filter((p) => p.id !== 2)).length, 0);
});
