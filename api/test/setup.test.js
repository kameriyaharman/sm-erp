import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aadhaarError, addressIn, addressOut, checkImage, cleanAadhaar, describeUsage, formatAddress, maskAadhaar, nextAcademicYear,
  passwordProblem, sniffImage, usedBy, verhoeffDigit, verhoeffValid, yearName, INDIAN_STATES, MAX_LOGO_BYTES,
} from '../src/modules/setup/profile.helpers.js';
import { profileColumns } from '../src/modules/students/student-profile.js';
import { createBody, updateBody } from '../src/modules/students/students.schemas.js';
import { createYearBody, schoolProfileBody, updateSectionBody } from '../src/modules/setup/setup.schemas.js';

// A valid Aadhaar-format number: 11 digits + Verhoeff check digit.
const AADHAAR = (() => {
  const body = '23456789012';
  return body + verhoeffDigit(body);
})();

test('Verhoeff: known vectors and the generated check digit', () => {
  assert.equal(verhoeffValid('2363'), true);          // classic example: 236 -> check digit 3
  assert.equal(verhoeffValid('2364'), false);
  assert.equal(verhoeffDigit('236'), 3);
  assert.equal(verhoeffValid(AADHAAR), true);
  // Any single-digit typo is caught.
  for (let i = 0; i < 12; i++) {
    const d = (Number(AADHAAR[i]) + 1) % 10;
    assert.equal(verhoeffValid(AADHAAR.slice(0, i) + d + AADHAAR.slice(i + 1)), false, `typo at ${i}`);
  }
  // Swapping two neighbouring digits is caught too.
  assert.equal(verhoeffValid(AADHAAR[1] + AADHAAR[0] + AADHAAR.slice(2)), false);
});

test('Aadhaar: cleaning, rules and masking', () => {
  assert.equal(cleanAadhaar(' 2345 6789-0123 '), '234567890123');
  assert.equal(cleanAadhaar(''), null);
  assert.equal(aadhaarError(AADHAAR), null);
  assert.match(aadhaarError('12345'), /12 digits/);
  assert.match(aadhaarError('1' + AADHAAR.slice(1)), /do not start with 0 or 1/);
  assert.match(aadhaarError(AADHAAR.slice(0, 11) + ((Number(AADHAAR[11]) + 1) % 10)), /check digit/);
  assert.equal(maskAadhaar(AADHAAR), `XXXX-XXXX-${AADHAAR.slice(-4)}`);
  assert.equal(maskAadhaar(null), null);
});

test('address: stored shape <-> API shape, one-line format', () => {
  const stored = addressIn({ line1: ' 12, MG Road ', line2: '', city: 'Gurugram', state: 'Haryana', pincode: '122001' });
  assert.deepEqual(stored, { line1: '12, MG Road', city: 'Gurugram', state: 'Haryana', pincode: '122001' });
  assert.deepEqual(addressOut(stored), { line1: '12, MG Road', line2: null, city: 'Gurugram', state: 'Haryana', pincode: '122001' });
  assert.equal(addressOut({}), null);
  assert.equal(addressOut(null), null);
  assert.equal(addressOut('Delhi'), null);
  assert.deepEqual(addressIn(null), {});
  assert.equal(formatAddress(stored), '12, MG Road, Gurugram, Haryana 122001');
  assert.equal(INDIAN_STATES.length, 36);
  assert.ok(INDIAN_STATES.includes('Delhi') && INDIAN_STATES.includes('Ladakh'));
});

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);

test('images: the bytes decide the type; declared type must agree', () => {
  assert.equal(sniffImage(PNG), 'png');
  assert.equal(sniffImage(JPG), 'jpeg');
  assert.equal(sniffImage(WEBP), 'webp');
  assert.equal(sniffImage(Buffer.from('%PDF-1.4')), null);

  assert.deepEqual(checkImage({ buffer: PNG, mimetype: 'image/png' }), { ok: true, mime: 'image/png' });
  assert.deepEqual(checkImage({ buffer: JPG, mimetype: 'application/octet-stream' }), { ok: true, mime: 'image/jpeg' });
  assert.equal(checkImage({ buffer: PNG, mimetype: 'image/jpeg' }).code, 'FILE_TYPE_NOT_ALLOWED');
  assert.equal(checkImage({ buffer: Buffer.from('%PDF-1.4 ...'), mimetype: 'image/png' }).code, 'FILE_TYPE_NOT_ALLOWED');
  assert.equal(checkImage({ buffer: Buffer.alloc(0), mimetype: 'image/png' }).code, 'FILE_EMPTY');
  const big = checkImage({ buffer: PNG, size: 3 * 1024 * 1024, mimetype: 'image/png' });
  assert.equal(big.code, 'FILE_TOO_LARGE');
  assert.equal(big.status, 413);
  // Logos: no WebP (PDFKit cannot embed it), 1 MB.
  const logo = checkImage({ buffer: WEBP, mimetype: 'image/webp' }, { kinds: ['png', 'jpeg'], maxBytes: MAX_LOGO_BYTES, label: 'The logo' });
  assert.equal(logo.code, 'FILE_TYPE_NOT_ALLOWED');
  assert.match(logo.message, /PNG or JPG/);
});

test('academic years: next year and names', () => {
  assert.deepEqual(nextAcademicYear({ startDate: '2026-04-01', endDate: '2027-03-31' }), { name: '2027-28', startDate: '2027-04-01', endDate: '2028-03-31' });
  // 29 Feb rolls back to 28 Feb.
  assert.deepEqual(nextAcademicYear({ startDate: '2027-03-01', endDate: '2028-02-29' }), { name: '2028-29', startDate: '2028-03-01', endDate: '2029-02-28' });
  assert.deepEqual(nextAcademicYear(null, '2026-10-04'), { name: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31' });
  assert.deepEqual(nextAcademicYear(null, '2027-02-10'), { name: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31' });
  assert.equal(yearName('2027-01-05', '2027-12-20'), '2027');
  assert.equal(yearName('2099-06-01', '2100-03-31'), '2099-00');
});

test('safe deletes: usage is described in plain words', () => {
  assert.deepEqual(usedBy({ students: '27', exams: 0, feeStructures: 4 }), { students: 27, feeStructures: 4 });
  assert.equal(describeUsage({ students: 27, feeStructures: 4, exams: 1 }), '27 students, 4 fee structure lines and 1 exam');
  assert.equal(describeUsage({ students: 1 }), '1 student');
  assert.equal(describeUsage({ homework: 2, timetable: 1 }), '2 homework and 1 timetable period');
  assert.equal(describeUsage({}), '');
});

test('password rule', () => {
  assert.match(passwordProblem('short1'), /10 characters/);
  assert.match(passwordProblem('onlyletterspass'), /letters and numbers/);
  assert.match(passwordProblem('Demo@School2026', { current: 'Demo@School2026' }), /different/);
  assert.match(passwordProblem('anita12345xyz', { email: 'anita@demo.school' }), /email name/);
  assert.equal(passwordProblem('Saffron-Kite-2031', { current: 'Demo@School2026', email: 'admin@demo.school' }), null);
});

// ---------------------------------------------------------------- student input

const BASE = {
  firstName: 'Tara', gender: 'female', dateOfBirth: '2016-06-15',
  classId: '6f1c6f3e-4a59-4a59-8a59-6f1c6f3e4a59', sectionId: '7f1c6f3e-4a59-4a59-8a59-6f1c6f3e4a59',
  parent: { name: 'Vikram Mehta', phone: '9876543210' },
};

test('admission schema: nested profile, Indian formats, strict', () => {
  const ok = createBody.safeParse({
    ...BASE,
    aadhaarNumber: `${AADHAAR.slice(0, 4)} ${AADHAAR.slice(4, 8)} ${AADHAAR.slice(8)}`,
    bloodGroup: 'B+',
    address: { line1: 'H-12, Sector 7', city: 'Dwarka', state: 'Delhi', pincode: '110075' },
    father: { name: 'Vikram Mehta', phone: '98765 43210', occupation: 'Engineer', email: '' },
    mother: { name: 'Meena Mehta' },
    emergencyContact: { name: 'Rekha', relation: 'Aunt', phone: '9811122233' },
    previousSchool: { name: 'Little Angels', lastClassPassed: 'UKG', tcDate: '' },
    medical: { allergies: 'Peanuts' },
  });
  assert.equal(ok.success, true, JSON.stringify(ok.error?.flatten()));
  assert.equal(ok.data.aadhaarNumber, AADHAAR);
  assert.equal(ok.data.father.email, null);
  assert.equal(ok.data.previousSchool.tcDate, null);

  const bad = createBody.safeParse({
    ...BASE,
    aadhaarNumber: '123456789012',
    address: { line1: 'x', city: 'y', state: 'Delhi NCR', pincode: '01234' },
    bloodGroup: 'C+',
  });
  assert.equal(bad.success, false);
  const fe = bad.error.flatten().fieldErrors;
  assert.ok(fe.aadhaarNumber && fe.address && fe.bloodGroup, JSON.stringify(fe));

  assert.equal(createBody.safeParse({ ...BASE, father: { name: 'X', salary: 5 } }).success, false);   // strict nested
  assert.equal(createBody.safeParse({ ...BASE, hobby: 'chess' }).success, false);                    // strict top level
});

test('edit schema: blanks clear, class change needs a section', () => {
  const r = updateBody.safeParse({ religion: '', address: null, guardian: { phone: '' } });
  assert.equal(r.success, true);
  assert.deepEqual(r.data, { religion: null, address: null, guardian: { phone: null } });
  assert.equal(updateBody.safeParse({ classId: BASE.classId }).success, false);
  assert.equal(updateBody.safeParse({ classId: BASE.classId, sectionId: BASE.sectionId }).success, true);
  assert.equal(updateBody.safeParse({}).success, false);
});

test('profile columns: only what was sent, phones normalised, nested name wins', () => {
  const cols = profileColumns({
    fatherName: 'Old Style',
    father: { name: 'Vikram Mehta', phone: '098765 43210', occupation: undefined },
    mother: { phone: null },
    address: { line1: 'H-12', city: 'Dwarka', state: 'Delhi', pincode: '110075' },
    medical: { allergies: 'Dust' },
    aadhaarNumber: null,
  });
  assert.deepEqual(cols, {
    aadhaar_number: null,
    address: JSON.stringify({ line1: 'H-12', city: 'Dwarka', state: 'Delhi', pincode: '110075' }),
    father_name: 'Vikram Mehta',
    father_phone: '+919876543210',
    mother_phone: null,
    allergies: 'Dust',
  });
  assert.deepEqual(profileColumns({ fatherName: 'Flat Name' }), { father_name: 'Flat Name' });
  assert.deepEqual(profileColumns({ address: null }), { address: '{}' });
  assert.throws(() => profileColumns({ guardian: { phone: '12345' } }), (e) => e.code === 'VALIDATION_ERROR' && Array.isArray(e.details.body.guardian));
});

test('setup schemas: years, sections, school profile', () => {
  assert.equal(createYearBody.safeParse({ startDate: '2027-04-01', endDate: '2027-03-31' }).success, false);
  assert.equal(createYearBody.safeParse({ startDate: '2027-04-01', endDate: '2029-03-31' }).success, false);   // too long
  const y = createYearBody.safeParse({ startDate: '2027-04-01', endDate: '2028-03-31' });
  assert.equal(y.success, true);
  assert.equal(y.data.makeCurrent, false);
  assert.equal(updateSectionBody.safeParse({ capacity: 0 }).success, false);
  assert.equal(updateSectionBody.safeParse({ classTeacherStaffId: null }).success, true);

  const school = {
    branchName: 'Main Campus',
    address: { line1: 'Sector 7', city: 'Dwarka', state: 'Delhi', pincode: '110075' },
    phone: '011-4567 8900', email: 'Office@School.IN', website: 'www.school.edu.in',
    affiliationNo: '2730123', schoolCode: '27123', udiseCode: '07060101234',
    principalName: 'Dr. Meenakshi Rao', board: 'CBSE', establishedYear: 1998, mediumOfInstruction: 'English',
  };
  const ok = schoolProfileBody.safeParse(school);
  assert.equal(ok.success, true, JSON.stringify(ok.error?.flatten()));
  assert.equal(ok.data.email, 'office@school.in');
  assert.equal(schoolProfileBody.safeParse({ ...school, udiseCode: '0706' }).success, false);
  assert.equal(schoolProfileBody.safeParse({ ...school, establishedYear: 3000 }).success, false);
  assert.equal(schoolProfileBody.safeParse({ ...school, website: 'not a site' }).success, false);
  assert.equal(schoolProfileBody.safeParse({ ...school, website: '' }).data.website, null);
});
