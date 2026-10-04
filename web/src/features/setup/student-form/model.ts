/**
 * Admission / edit form model: the flat form state, conversion from the API's student detail,
 * per-step validation and the request bodies (POST /students, PATCH /students/:id).
 */
import type { StudentDetail } from '@/features/admin/types';
import { aadhaarError, digitsOnly, emailError, mobileError, pincodeError } from '../india';

export type Mode = 'create' | 'edit';
export type StepId = 'student' | 'address' | 'family' | 'previous' | 'health' | 'fees';
export type Primary = 'father' | 'mother' | 'guardian';

export const STEPS: Array<{ id: StepId; title: string; hint: string; modes: Mode[] }> = [
  { id: 'student', title: 'Student', hint: 'Name, class, identity', modes: ['create', 'edit'] },
  { id: 'address', title: 'Address', hint: 'Where the family lives', modes: ['create', 'edit'] },
  { id: 'family', title: 'Parents & guardian', hint: 'Contacts and parent login', modes: ['create', 'edit'] },
  { id: 'previous', title: 'Previous school', hint: 'Last school and TC', modes: ['create', 'edit'] },
  { id: 'health', title: 'Health & emergency', hint: 'Allergies, emergency contact', modes: ['create', 'edit'] },
  { id: 'fees', title: 'Fees & transport', hint: 'Fee structure, school bus', modes: ['create'] },
];

export interface FormState {
  // student
  firstName: string; lastName: string; gender: string; dateOfBirth: string;
  bloodGroup: string; religion: string; motherTongue: string; nationality: string; socialCategory: string;
  house: string; identificationMarks: string; aadhaar: string; clearAadhaar: boolean; penNumber: string; apaarId: string;
  classId: string; sectionId: string; rollNumber: string; admissionNumber: string; admissionDate: string;
  // address
  line1: string; line2: string; city: string; state: string; pincode: string;
  // family
  fatherName: string; fatherPhone: string; fatherEmail: string; fatherOccupation: string;
  motherName: string; motherPhone: string; motherEmail: string; motherOccupation: string;
  guardianName: string; guardianRelation: string; guardianPhone: string;
  primary: Primary;
  /** edit: the parent-login account's mobile (links siblings) */
  parentPhone: string;
  // previous school
  prevName: string; prevBoard: string; prevClass: string; tcNumber: string; tcDate: string;
  // health
  allergies: string; medicalNotes: string; emergencyName: string; emergencyRelation: string; emergencyPhone: string;
  // fees & transport (create only)
  applyFeeStructure: boolean; routeId: string; stopId: string;
}

export type Errors = Partial<Record<keyof FormState, string>>;

export function emptyForm(today: string): FormState {
  return {
    firstName: '', lastName: '', gender: '', dateOfBirth: '', bloodGroup: '', religion: '', motherTongue: '', nationality: 'Indian',
    socialCategory: '', house: '', identificationMarks: '', aadhaar: '', clearAadhaar: false, penNumber: '', apaarId: '',
    classId: '', sectionId: '', rollNumber: '', admissionNumber: '', admissionDate: today,
    line1: '', line2: '', city: '', state: '', pincode: '',
    fatherName: '', fatherPhone: '', fatherEmail: '', fatherOccupation: '',
    motherName: '', motherPhone: '', motherEmail: '', motherOccupation: '',
    guardianName: '', guardianRelation: '', guardianPhone: '', primary: 'father', parentPhone: '',
    prevName: '', prevBoard: '', prevClass: '', tcNumber: '', tcDate: '',
    allergies: '', medicalNotes: '', emergencyName: '', emergencyRelation: '', emergencyPhone: '',
    applyFeeStructure: true, routeId: '', stopId: '',
  };
}

/** "+919810055555" -> "9810055555" for the input. */
const national = (p: string | null | undefined) => (p ? p.replace(/^\+91/, '') : '');
const s = (v: string | null | undefined) => v ?? '';

export function fromStudent(d: StudentDetail): FormState {
  return {
    ...emptyForm(d.admissionDate),
    firstName: s(d.firstName), lastName: s(d.lastName), gender: d.gender, dateOfBirth: s(d.dateOfBirth).slice(0, 10),
    bloodGroup: s(d.bloodGroup), religion: s(d.religion), motherTongue: s(d.motherTongue), nationality: s(d.nationality),
    socialCategory: s(d.socialCategory), house: s(d.house), identificationMarks: s(d.identificationMarks),
    aadhaar: '', penNumber: s(d.penNumber), apaarId: s(d.apaarId),
    classId: d.class?.id ?? '', sectionId: d.section?.id ?? '', rollNumber: s(d.rollNumber),
    admissionNumber: d.admissionNumber, admissionDate: s(d.admissionDate).slice(0, 10),
    line1: s(d.address?.line1), line2: s(d.address?.line2), city: s(d.address?.city), state: s(d.address?.state), pincode: s(d.address?.pincode),
    fatherName: s(d.father?.name), fatherPhone: national(d.father?.phone), fatherEmail: s(d.father?.email), fatherOccupation: s(d.father?.occupation),
    motherName: s(d.mother?.name), motherPhone: national(d.mother?.phone), motherEmail: s(d.mother?.email), motherOccupation: s(d.mother?.occupation),
    guardianName: s(d.guardian?.name), guardianRelation: s(d.guardian?.relation), guardianPhone: national(d.guardian?.phone),
    parentPhone: national(d.parent?.phone),
    prevName: s(d.previousSchool?.name), prevBoard: s(d.previousSchool?.board), prevClass: s(d.previousSchool?.lastClassPassed),
    tcNumber: s(d.previousSchool?.tcNumber), tcDate: s(d.previousSchool?.tcDate),
    allergies: s(d.medical?.allergies), medicalNotes: s(d.medical?.notes),
    emergencyName: s(d.emergencyContact?.name), emergencyRelation: s(d.emergencyContact?.relation), emergencyPhone: national(d.emergencyContact?.phone),
  };
}

/** Which step shows each field (to jump to the first error). */
export const FIELD_STEP: Partial<Record<keyof FormState, StepId>> = {
  firstName: 'student', lastName: 'student', gender: 'student', dateOfBirth: 'student', bloodGroup: 'health', religion: 'student',
  motherTongue: 'student', nationality: 'student', socialCategory: 'student', house: 'student', identificationMarks: 'student',
  aadhaar: 'student', penNumber: 'student', apaarId: 'student', classId: 'student', sectionId: 'student', rollNumber: 'student',
  admissionNumber: 'student', admissionDate: 'student',
  line1: 'address', line2: 'address', city: 'address', state: 'address', pincode: 'address',
  fatherName: 'family', fatherPhone: 'family', fatherEmail: 'family', fatherOccupation: 'family',
  motherName: 'family', motherPhone: 'family', motherEmail: 'family', motherOccupation: 'family',
  guardianName: 'family', guardianRelation: 'family', guardianPhone: 'family', primary: 'family', parentPhone: 'family',
  prevName: 'previous', prevBoard: 'previous', prevClass: 'previous', tcNumber: 'previous', tcDate: 'previous',
  allergies: 'health', medicalNotes: 'health', emergencyName: 'health', emergencyRelation: 'health', emergencyPhone: 'health',
  routeId: 'fees', stopId: 'fees',
};

export function validateStep(step: StepId, f: FormState, mode: Mode, ctx: { today: string; sectionCount: number }): Errors {
  const e: Errors = {};
  if (step === 'student') {
    if (!f.firstName.trim()) e.firstName = 'Enter the first name';
    if (!f.gender) e.gender = 'Choose a gender';
    if (!f.dateOfBirth) e.dateOfBirth = 'Enter the date of birth';
    else if (f.dateOfBirth >= (f.admissionDate || ctx.today)) e.dateOfBirth = 'Date of birth must be before the admission date';
    if (!f.classId) e.classId = 'Choose a class';
    if (!f.sectionId) e.sectionId = f.classId && ctx.sectionCount === 0 ? 'This class has no section this year. Add one under Settings → Classes.' : 'Choose a section';
    if (f.rollNumber && !/^[A-Za-z0-9-]{1,20}$/.test(f.rollNumber.trim())) e.rollNumber = 'Up to 20 letters, digits or -';
    if (mode === 'create' && f.admissionNumber && !/^[A-Za-z0-9/_-]{1,30}$/.test(f.admissionNumber.trim())) e.admissionNumber = 'Up to 30 letters, digits, / _ or -';
    const a = aadhaarError(f.aadhaar);
    if (a) e.aadhaar = a;
    if (f.apaarId && !/^\d{12}$/.test(f.apaarId.trim())) e.apaarId = 'APAAR ID is 12 digits';
    if (f.penNumber && !/^[A-Za-z0-9]{1,20}$/.test(f.penNumber.trim())) e.penNumber = 'Letters and digits only';
  }
  if (step === 'address') {
    const any = [f.line1, f.line2, f.city, f.state, f.pincode].some((v) => v.trim());
    const required = mode === 'create' || any;
    if (required) {
      if (!f.line1.trim()) e.line1 = 'Enter the house / flat and street';
      if (!f.city.trim()) e.city = 'Enter the city or town';
      if (!f.state) e.state = 'Choose the state';
    }
    const p = pincodeError(f.pincode, required);
    if (p) e.pincode = p;
  }
  if (step === 'family') {
    for (const who of ['father', 'mother'] as const) {
      const m = mobileError(f[`${who}Phone`]);
      if (m) e[`${who}Phone`] = m;
      const em = emailError(f[`${who}Email`]);
      if (em) e[`${who}Email`] = em;
    }
    const g = mobileError(f.guardianPhone);
    if (g) e.guardianPhone = g;
    if (!f.fatherName.trim() && !f.motherName.trim() && !f.guardianName.trim()) e.fatherName = "Enter at least one parent's or the guardian's name";
    if (mode === 'create') {
      const p = f.primary;
      if (f[`${p}Name`].trim().length < 2) e[`${p}Name`] = 'The primary contact needs a name';
      const pm = mobileError(f[`${p}Phone`], true);
      if (pm) e[`${p}Phone`] = pm;
    } else {
      const pm = mobileError(f.parentPhone);
      if (pm) e.parentPhone = pm;
    }
  }
  if (step === 'health') {
    const m = mobileError(f.emergencyPhone);
    if (m) e.emergencyPhone = m;
    if (f.emergencyPhone.trim() && !f.emergencyName.trim()) e.emergencyName = 'Whom should the school call?';
  }
  if (step === 'previous') {
    if (f.tcDate && f.tcDate > ctx.today) e.tcDate = 'The TC date cannot be in the future';
  }
  return e;
}

export function validateAll(f: FormState, mode: Mode, ctx: { today: string; sectionCount: number }): Errors {
  return STEPS.filter((st) => st.modes.includes(mode)).reduce<Errors>((acc, st) => ({ ...acc, ...validateStep(st.id, f, mode, ctx) }), {});
}

// ------------------------------------------------------------------ request bodies

const t = (v: string) => v.trim();
const opt = (v: string) => (v.trim() ? v.trim() : undefined);
const nul = (v: string) => (v.trim() ? v.trim() : null);

function groups(f: FormState, blank: (v: string) => string | null | undefined) {
  return {
    address: [f.line1, f.city, f.state, f.pincode].every((v) => v.trim())
      ? { line1: t(f.line1), line2: blank(f.line2) ?? undefined, city: t(f.city), state: f.state, pincode: t(f.pincode) }
      : null,
    father: { name: blank(f.fatherName), phone: blank(f.fatherPhone), email: blank(f.fatherEmail), occupation: blank(f.fatherOccupation) },
    mother: { name: blank(f.motherName), phone: blank(f.motherPhone), email: blank(f.motherEmail), occupation: blank(f.motherOccupation) },
    guardian: { name: blank(f.guardianName), relation: blank(f.guardianRelation), phone: blank(f.guardianPhone) },
    emergencyContact: { name: blank(f.emergencyName), relation: blank(f.emergencyRelation), phone: blank(f.emergencyPhone) },
    previousSchool: { name: blank(f.prevName), board: blank(f.prevBoard), lastClassPassed: blank(f.prevClass), tcNumber: blank(f.tcNumber), tcDate: blank(f.tcDate) },
    medical: { allergies: blank(f.allergies), notes: blank(f.medicalNotes) },
  };
}

export function createBody(f: FormState) {
  const g = groups(f, opt);
  const p = f.primary;
  return {
    firstName: t(f.firstName),
    lastName: opt(f.lastName),
    gender: f.gender,
    dateOfBirth: f.dateOfBirth,
    classId: f.classId,
    sectionId: f.sectionId,
    rollNumber: opt(f.rollNumber),
    admissionNumber: opt(f.admissionNumber),
    admissionDate: opt(f.admissionDate),
    socialCategory: opt(f.socialCategory),
    penNumber: opt(f.penNumber),
    apaarId: opt(f.apaarId),
    bloodGroup: opt(f.bloodGroup),
    aadhaarNumber: digitsOnly(f.aadhaar) || undefined,
    religion: opt(f.religion),
    motherTongue: opt(f.motherTongue),
    nationality: opt(f.nationality),
    house: opt(f.house),
    identificationMarks: opt(f.identificationMarks),
    parent: { name: t(f[`${p}Name`]), phone: t(f[`${p}Phone`]), email: p === 'guardian' ? undefined : opt(f[`${p}Email`]) },
    applyFeeStructure: f.applyFeeStructure,
    ...g,
    address: g.address ?? undefined,
  };
}

/** Only what changed. Nested groups are sent whole when any of their fields changed. */
export function patchBody(f: FormState, o: FormState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const changed = (...keys: Array<keyof FormState>) => keys.some((k) => String(f[k]).trim() !== String(o[k]).trim());
  const simple: Array<[keyof FormState, string]> = [
    ['lastName', 'lastName'], ['bloodGroup', 'bloodGroup'], ['religion', 'religion'], ['motherTongue', 'motherTongue'],
    ['nationality', 'nationality'], ['house', 'house'], ['identificationMarks', 'identificationMarks'], ['penNumber', 'penNumber'],
    ['apaarId', 'apaarId'],
  ];
  if (changed('firstName') && t(f.firstName)) out.firstName = t(f.firstName);
  for (const [k, api] of simple) if (changed(k)) out[api] = nul(String(f[k]));
  if (changed('socialCategory')) out.socialCategory = f.socialCategory || null;
  if (changed('gender')) out.gender = f.gender;
  if (changed('dateOfBirth')) out.dateOfBirth = f.dateOfBirth;
  if (changed('admissionDate') && f.admissionDate) out.admissionDate = f.admissionDate;
  if (f.clearAadhaar) out.aadhaarNumber = null;
  else if (digitsOnly(f.aadhaar)) out.aadhaarNumber = digitsOnly(f.aadhaar);
  if (changed('classId')) {
    out.classId = f.classId;
    out.sectionId = f.sectionId;
  } else if (changed('sectionId')) out.sectionId = f.sectionId;
  if (changed('rollNumber') && t(f.rollNumber)) out.rollNumber = t(f.rollNumber);
  if (changed('parentPhone') && t(f.parentPhone)) out.parentPhone = t(f.parentPhone);

  const g = groups(f, nul);
  if (changed('line1', 'line2', 'city', 'state', 'pincode')) out.address = g.address;
  if (changed('fatherName', 'fatherPhone', 'fatherEmail', 'fatherOccupation')) out.father = g.father;
  if (changed('motherName', 'motherPhone', 'motherEmail', 'motherOccupation')) out.mother = g.mother;
  if (changed('guardianName', 'guardianRelation', 'guardianPhone')) out.guardian = g.guardian;
  if (changed('emergencyName', 'emergencyRelation', 'emergencyPhone')) out.emergencyContact = g.emergencyContact;
  if (changed('prevName', 'prevBoard', 'prevClass', 'tcNumber', 'tcDate')) out.previousSchool = g.previousSchool;
  if (changed('allergies', 'medicalNotes')) out.medical = g.medical;
  return out;
}

/** Server field errors (keys of the request body) -> form fields. */
export function mapServerErrors(fe: Record<string, string>, code: string | null, message: string, primary: Primary): Errors {
  const e: Errors = {};
  const map: Record<string, keyof FormState> = {
    firstName: 'firstName', lastName: 'lastName', gender: 'gender', dateOfBirth: 'dateOfBirth', admissionDate: 'admissionDate',
    classId: 'classId', sectionId: 'sectionId', rollNumber: 'rollNumber', admissionNumber: 'admissionNumber',
    aadhaarNumber: 'aadhaar', penNumber: 'penNumber', apaarId: 'apaarId', bloodGroup: 'bloodGroup', religion: 'religion',
    address: 'pincode', father: 'fatherPhone', mother: 'motherPhone', guardian: 'guardianPhone', emergencyContact: 'emergencyPhone',
    previousSchool: 'prevName', medical: 'allergies', parentPhone: 'parentPhone', parent: `${primary}Phone`,
  };
  for (const [k, msg] of Object.entries(fe)) if (map[k]) e[map[k]] = msg;
  if (code === 'AADHAAR_TAKEN') e.aadhaar = message;
  if (code === 'ROLL_NUMBER_TAKEN') e.rollNumber = message;
  if (code === 'CONFLICT') e.admissionNumber = message;
  if (code === 'SECTION_NOT_IN_CLASS' || code === 'SECTION_NOT_CURRENT' || code === 'SECTION_NOT_IN_YEAR') e.sectionId = message;
  if (code === 'PARENT_NOT_FOUND') e.parentPhone = message;
  return e;
}
