import { createHash, randomBytes } from 'node:crypto';
import { pool, withTransaction } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { ROLES } from '../../config/roles.js';
import { assertBranchAccess, resolveBranchScope } from '../../middleware/scope.js';
import { fromPaise, toPaise } from '../../utils/money.js';
import { isGuardianOf } from '../payments/payments.repository.js';
import { nextDocumentNumber } from '../fees/fees.repository.js';
import * as repo from './documents.repository.js';
import {
  CBSE_GRADE_SCALE, SCHEMES, attendanceSummary, computeStudentResult, rankByPercentage, schemeForClassLevel, suggestResult,
} from './report-card.calculator.js';
import { schoolFromRow } from './pdf/kit.js';
import { MONTHS, classInWords, dateInWords, formatDate, roman } from './pdf/words.js';

const unprocessable = (code, message, details) => new AppError(422, code, message, details);
const conflict = (code, message, details) => new AppError(409, code, message, details);

// ===================================================================== small helpers

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** 12 random Crockford base-32 chars as XXXX-XXXX-XXXX (60 bits; no I/L/O/U to misread). */
export function newVerificationCode() {
  const bytes = randomBytes(12);
  const chars = [...bytes].map((b) => CROCKFORD[b & 31]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

/** JSON with sorted keys, so the hash survives Postgres jsonb key reordering. */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export const contentHash = (content) => createHash('sha256').update(stableStringify(content)).digest('hex');

const todayIn = (timeZone = 'Asia/Kolkata') => new Date().toLocaleDateString('en-CA', { timeZone });
const minDate = (...dates) => dates.filter(Boolean).map((d) => String(d).slice(0, 10)).sort()[0];
const monthYear = (iso) => (iso ? `${MONTHS[Number(String(iso).slice(5, 7)) - 1]} ${String(iso).slice(0, 4)}` : null);
const classLabel = (level, name) => (Number.isInteger(level) && level >= 1 && level <= 12 ? `Class ${roman(level)}` : name);

function pronouns(gender) {
  if (gender === 'male') return { child: 'son', subject: 'He', possessive: 'his' };
  if (gender === 'female') return { child: 'daughter', subject: 'She', possessive: 'her' };
  return { child: 'ward', subject: 'They', possessive: 'their' };
}

function isAdmin(auth) {
  return auth.role === ROLES.SUPER_ADMIN || auth.role === ROLES.BRANCH_ADMIN;
}

function documentSettings(row) {
  return row.branch_settings?.documents ?? {};
}

// ===================================================================== report cards

/**
 * Computes report cards for every student of a section and stores them as
 * 'generated' (published cards are never touched). Class rank needs the whole
 * class, so all sections of the class are computed and only this section saved.
 *
 * @param {{ sectionId: string, termId?: string }} input   termId = progress report up to that term; omit = final annual card
 */
export async function generateReportCards(auth, { sectionId, termId }) {
  const ctx = await repo.getSectionContext(pool, sectionId, auth.userId);
  if (!ctx) throw AppError.notFound('Section not found', 'SECTION_NOT_FOUND');
  assertSectionAccess(auth, ctx);

  const allTerms = await repo.getTerms(pool, ctx.academic_year_id);
  if (allTerms.length === 0) throw unprocessable('NO_TERMS', `Set up the terms of ${ctx.academic_year} before generating report cards.`);
  let terms = allTerms;
  if (termId) {
    const upTo = allTerms.find((t) => t.id === termId);
    if (!upTo) throw unprocessable('TERM_NOT_IN_YEAR', 'That term is not part of this section\'s academic year.');
    terms = allTerms.filter((t) => t.sequence_no <= upTo.sequence_no);
  }
  const isFinal = !termId;
  const settings = documentSettings(ctx);
  const scheme = SCHEMES[settings.scheme] ?? schemeForClassLevel(ctx.numeric_level);
  const gradeScale = (await repo.getGradeScale(pool, ctx.branch_id, settings.gradeScale ?? 'cbse')) ?? CBSE_GRADE_SCALE;
  const showRanks = settings.showRanks !== false;

  const [students, subjects] = await Promise.all([
    repo.getClassStudents(pool, ctx.class_id, ctx.academic_year_id),
    repo.getClassSubjects(pool, ctx.class_id, ctx.academic_year_id),
  ]);
  const sectionStudents = students.filter((s) => s.section_id === sectionId);
  if (sectionStudents.length === 0) throw unprocessable('EMPTY_SECTION', 'No students are placed in this section.');

  const marks = await repo.getClassMarks(pool, ctx.class_id, ctx.academic_year_id, terms.map((t) => t.id));
  const marksByStudent = new Map();
  for (const m of marks) {
    if (!marksByStudent.has(m.student_id)) marksByStudent.set(m.student_id, []);
    marksByStudent.get(m.student_id).push({
      subjectId: m.subject_id, termId: m.term_id, component: m.component, marksObtained: m.marks_obtained, maxMarks: m.max_marks,
      isAbsent: m.is_absent, isExempted: m.is_exempted, grade: m.grade, examDate: m.exam_date,
    });
  }
  const subjectList = subjects.map((s) => ({ id: s.id, name: s.name, code: s.code, isGradedOnly: s.is_graded_only, displayOrder: s.display_order }));
  const termList = terms.map((t) => ({ id: t.id, name: t.name, sequenceNo: t.sequence_no }));

  const results = new Map(students.map((s) => [s.id, computeStudentResult({
    scheme, terms: termList, subjects: subjectList, marks: marksByStudent.get(s.id) ?? [], gradeScale,
  })]));

  const rankInput = (list) => list.map((s) => ({ key: s.id, percentage: results.get(s.id).totals.percentage, complete: results.get(s.id).complete }));
  const classRanks = rankByPercentage(rankInput(students));
  const sectionRanks = rankByPercentage(rankInput(sectionStudents));
  const classSize = [...classRanks.values()].filter(Boolean).length;
  const sectionSize = [...sectionRanks.values()].filter(Boolean).length;

  const until = minDate(isFinal ? ctx.year_end : terms.at(-1).end_date, todayIn(ctx.timezone));
  const attendance = await repo.getAttendanceCounts(pool, sectionStudents.map((s) => s.id), ctx.academic_year_id, until);
  const nextClass = isFinal ? await repo.getNextClass(pool, ctx.branch_id, ctx.numeric_level) : null;
  const school = schoolFromRow(ctx);
  const title = isFinal ? 'Report Card' : `Progress Report - ${terms.at(-1).name}`;

  const outcome = await withTransaction(async (db) => {
    const states = await repo.getReportCardStates(db, sectionStudents.map((s) => s.id), ctx.academic_year_id, termId ?? null);
    const summary = { generated: 0, skippedPublished: 0, incomplete: 0, students: [] };

    for (const student of sectionStudents) {
      if (states.get(student.id)?.status === 'published' || states.get(student.id)?.status === 'revoked') {
        summary.skippedPublished += 1;
        continue;
      }
      const r = results.get(student.id);
      const att = attendanceSummary(attendance.get(student.id));
      const result = suggestResult({ isFinal, complete: r.complete, failedSubjects: r.failedSubjects });
      const ranks = showRanks ? {
        section: sectionRanks.get(student.id), sectionSize, class: classRanks.get(student.id), classSize,
      } : null;

      const snapshot = {
        title,
        session: ctx.academic_year,
        isFinal,
        school,
        scheme: { code: scheme.code, label: scheme.label, passPercentage: scheme.passPercentage, components: scheme.components.map(({ code, label, short, weight }) => ({ code, label, short, weight })) },
        gradeScale,
        terms: termList,
        student: {
          id: student.id, name: student.name, admissionNumber: student.admission_number, rollNumber: student.roll_number,
          className: ctx.class_name, sectionName: ctx.section_name, dateOfBirth: student.date_of_birth,
          fatherName: student.father_name, motherName: student.mother_name, guardianName: student.guardian_name,
          penNumber: student.pen_number, apaarId: student.apaar_id,
        },
        classTeacher: ctx.class_teacher || null,
        scholastic: r.scholastic,
        coScholastic: r.coScholastic,
        discipline: r.discipline,
        totals: r.totals,
        failedSubjects: r.failedSubjects,
        complete: r.complete,
        missing: r.missing,
        ranks,
        attendance: att,
        promotedTo: nextClass ? classLabel(nextClass.numeric_level, nextClass.name) : null,
      };

      const id = await repo.upsertReportCard(db, {
        tenantId: ctx.tenant_id, branchId: ctx.branch_id, studentId: student.id, academicYearId: ctx.academic_year_id,
        termId: termId ?? null, classId: ctx.class_id, sectionId,
        totalMarks: r.totals.max ? r.totals.obtained : null, maxMarks: r.totals.max || null,
        overallGrade: r.totals.grade, gradePoint: r.totals.gradePoint,
        rankInSection: ranks?.section ?? null, rankInClass: ranks?.class ?? null,
        daysPresent: att.working ? att.attended : null, daysTotal: att.working || null,
        subjectSummary: r.scholastic, coScholastic: { areas: r.coScholastic, discipline: r.discipline },
        result, schemeCode: scheme.code, isFinal, snapshot,
      });
      if (!id) { summary.skippedPublished += 1; continue; }
      summary.generated += 1;
      if (!r.complete) summary.incomplete += 1;
      summary.students.push({
        reportCardId: id, studentId: student.id, name: student.name, rollNumber: student.roll_number,
        percentage: r.totals.percentage, grade: r.totals.grade, rankInSection: ranks?.section ?? null, complete: r.complete,
        missing: r.missing.length ? [...new Set(r.missing.map((m) => m.subject))] : undefined,
      });
    }
    return summary;
  });

  return {
    sectionId, academicYear: ctx.academic_year, term: termId ? terms.at(-1).name : null, isFinal, scheme: scheme.code, ...outcome,
  };
}

function assertSectionAccess(auth, ctx) {
  if (auth.role === ROLES.TEACHER) {
    if (auth.tenantId !== ctx.tenant_id || auth.branchId !== ctx.branch_id) throw AppError.notFound('Section not found', 'SECTION_NOT_FOUND');
    if (!ctx.is_class_teacher) throw AppError.forbidden('Only the class teacher can do this for the section', 'NOT_CLASS_TEACHER');
    return;
  }
  assertBranchAccess(auth, { tenantId: ctx.tenant_id, branchId: ctx.branch_id }, 'Section not found');
}

/** Report cards of a section (termId omitted = annual cards). Teacher: class teacher only, as for generate. */
export async function listSectionReportCards(auth, sectionId, { termId }) {
  const ctx = await repo.getSectionContext(pool, sectionId, auth.userId);
  if (!ctx) throw AppError.notFound('Section not found', 'SECTION_NOT_FOUND');
  assertSectionAccess(auth, ctx);
  const rows = await repo.listSectionReportCards(pool, { sectionId, academicYearId: ctx.academic_year_id, termId: termId ?? null });
  return rows.map((r) => ({
    id: r.id,
    studentId: r.student_id,
    name: r.name,
    rollNumber: r.roll_number,
    status: r.status,
    percentage: r.percentage,
    grade: r.overall_grade,
    rankInSection: r.rank_in_section,
    result: r.result,
    teacherRemarks: r.teacher_remarks,
    publishedAt: r.published_at,
  }));
}

/** Admin: publish all generated cards of a section (each gets a verification code). */
export async function publishReportCards(auth, { sectionId, termId }) {
  const ctx = await repo.getSectionContext(pool, sectionId, auth.userId);
  if (!ctx) throw AppError.notFound('Section not found', 'SECTION_NOT_FOUND');
  assertBranchAccess(auth, { tenantId: ctx.tenant_id, branchId: ctx.branch_id }, 'Section not found');
  const published = await withTransaction(async (db) => {
    const ids = await repo.lockPublishable(db, { sectionId, academicYearId: ctx.academic_year_id, termId: termId ?? null });
    if (ids.length === 0) return 0;
    return repo.publishReportCards(db, { ids, codes: ids.map(() => newVerificationCode()), userId: auth.userId });
  });
  if (published === 0) throw unprocessable('NOTHING_TO_PUBLISH', 'There are no generated report cards to publish for this section. Generate them first.');
  return { published };
}

/** Class teacher: remarks. Admin: remarks + result override. Only before publishing. */
export async function updateReportCard(auth, id, patch) {
  const card = await repo.getReportCardForUser(pool, id, auth.userId);
  if (!card) throw AppError.notFound('Report card not found', 'REPORT_CARD_NOT_FOUND');
  if (auth.role === ROLES.TEACHER) {
    if (!card.is_class_teacher || auth.tenantId !== card.tenant_id) throw AppError.notFound('Report card not found', 'REPORT_CARD_NOT_FOUND');
    if ('principalRemarks' in patch || 'result' in patch) throw AppError.forbidden('Only the school office can change the result or the principal\'s remarks');
  } else {
    assertBranchAccess(auth, { tenantId: card.tenant_id, branchId: card.branch_id }, 'Report card not found');
  }
  const updated = await repo.updateReportCard(pool, id, patch);
  if (!updated) throw conflict('REPORT_CARD_PUBLISHED', 'This report card is already published and can no longer be edited.');
  return { id, updated: true };
}

/** Render input for one report card, after access checks. */
export async function getReportCardDocument(auth, id) {
  const card = await repo.getReportCardForUser(pool, id, auth.userId);
  if (!card || !card.snapshot) throw AppError.notFound('Report card not found', 'REPORT_CARD_NOT_FOUND');

  const published = card.status === 'published';
  let allowed = false;
  if (isAdmin(auth)) {
    assertBranchAccess(auth, { tenantId: card.tenant_id, branchId: card.branch_id }, 'Report card not found');
    allowed = true;
  } else if (auth.role === ROLES.TEACHER) {
    allowed = card.is_class_teacher && auth.tenantId === card.tenant_id;
  } else if (auth.role === ROLES.PARENT) {
    allowed = published && auth.tenantId === card.tenant_id && (await isGuardianOf(pool, auth.userId, card.student_id));
  } else if (auth.role === ROLES.STUDENT) {
    allowed = published && card.student_user_id === auth.userId;
  }
  if (!allowed) throw AppError.notFound('Report card not found', 'REPORT_CARD_NOT_FOUND');

  return {
    ...card.snapshot,
    status: card.status,
    result: card.result,
    remarks: { teacher: card.teacher_remarks, principal: card.principal_remarks },
    verificationCode: card.verification_code,
    issueDate: new Date(card.published_at ?? card.generated_at ?? Date.now()).toLocaleDateString('en-CA', { timeZone: card.snapshot.school?.timeZone ?? 'Asia/Kolkata' }),
  };
}

export async function listStudentReportCards(auth, studentId) {
  const student = await repo.getStudentRecord(pool, studentId);
  if (!student) throw AppError.notFound('Student not found', 'STUDENT_NOT_FOUND');
  let publishedOnly = true;
  if (isAdmin(auth)) {
    assertBranchAccess(auth, { tenantId: student.tenant_id, branchId: student.branch_id }, 'Student not found');
    publishedOnly = false;
  } else if (auth.role === ROLES.PARENT) {
    if (auth.tenantId !== student.tenant_id || !(await isGuardianOf(pool, auth.userId, studentId))) throw AppError.notFound('Student not found', 'STUDENT_NOT_FOUND');
  } else if (auth.role === ROLES.STUDENT) {
    if (student.user_id !== auth.userId) throw AppError.notFound('Student not found', 'STUDENT_NOT_FOUND');
  } else {
    throw AppError.forbidden();
  }
  return repo.listReportCardsForStudent(pool, studentId, { publishedOnly });
}

// ===================================================================== certificates

const TC_DEFAULTS = {
  generalConduct: 'Good',
  nccScoutGuide: 'No',
  gamesActivities: 'As per school records',
  otherRemarks: 'Nil',
};

/**
 * Issues a Transfer Certificate in one transaction: locks the student, refuses a
 * second live TC, warns about unpaid dues, takes the next gap-free TC number,
 * freezes the printed content (+ SHA-256) and marks the student as transferred.
 */
export async function issueTransferCertificate(auth, studentId, input) {
  return withTransaction(async (db) => {
    const s = await repo.getStudentRecord(db, studentId, { forUpdate: true });
    if (!s) throw AppError.notFound('Student not found', 'STUDENT_NOT_FOUND');
    assertBranchAccess(auth, { tenantId: s.tenant_id, branchId: s.branch_id }, 'Student not found');

    const existing = await repo.getActiveTc(db, studentId);
    if (existing) throw conflict('TC_ALREADY_ISSUED', `TC ${existing.certificate_number} is already issued for this student. Cancel it before issuing a corrected one.`, { certificateId: existing.id });
    if (!s.class_id) throw unprocessable('NO_CLASS', 'The student is not placed in a class; a TC needs the class last studied.');

    const missing = [['father_name', 'father\'s name'], ['mother_name', 'mother\'s name'], ['nationality', 'nationality'], ['social_category', 'category (SC/ST/OBC/General)']]
      .filter(([k]) => !s[k] && !(k === 'father_name' && s.guardian_name)).map(([, label]) => label);
    if (missing.length) throw unprocessable('STUDENT_RECORD_INCOMPLETE', `Complete the admission record first: ${missing.join(', ')}.`, { missing });

    const fees = await repo.getFeePosition(db, studentId);
    const outstanding = toPaise(fees.outstanding);
    if (outstanding > 0 && !input.acknowledgeDues) {
      throw conflict('DUES_OUTSTANDING', `Rs. ${fromPaise(outstanding)} is still due. Collect it, or confirm issuing the TC with dues recorded on it.`, { outstanding: fromPaise(outstanding) });
    }

    const [lastResult, timesFailed, subjects, attendanceMap] = await Promise.all([
      repo.getLatestFinalResult(db, studentId),
      repo.countDetentionsInClass(db, studentId, s.class_id),
      repo.getSubjectsStudied(db, studentId, s.current_year_id),
      repo.getAttendanceCounts(db, [studentId], s.current_year_id, todayIn(s.timezone)),
    ]);
    const att = attendanceSummary(attendanceMap.get(studentId));
    const issueDate = todayIn(s.timezone);
    const leavingDate = input.leavingDate ?? issueDate;
    if (leavingDate < String(s.admission_date).slice(0, 10)) throw unprocessable('INVALID_LEAVING_DATE', 'Leaving date is before the admission date.');

    const lastExam = input.lastExamResult
      ?? (lastResult ? `School Annual Examination ${lastResult.academic_year} (${classLabel(lastResult.numeric_level, lastResult.class_name)}): ${resultWords(lastResult.result)}` : 'Not applicable');
    const promotion = input.qualifiedForPromotion
      ?? (lastResult && lastResult.class_name === s.class_name && lastResult.academic_year === s.academic_year
        ? (lastResult.result === 'promoted' || lastResult.result === 'pass'
          ? (Number.isInteger(s.numeric_level) ? `Yes, to Class ${classInWords(s.numeric_level + 1, '')}` : 'Yes')
          : 'No')
        : 'Not applicable (left during the session)');
    const rupees = (p) => `Rs. ${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2 }).format(p / 100)}`;
    const paidUpTo = monthYear(fees.paid_up_to);
    const dues = outstanding > 0
      ? `${paidUpTo ?? 'No instalment of the session fully paid'} (${rupees(outstanding)} outstanding)`
      : paidUpTo ?? 'All dues cleared';

    const school = schoolFromRow(s);
    const v = { ...TC_DEFAULTS, ...input };
    const fields = [
      ['Name of the Pupil', s.name],
      ["Mother's Name", s.mother_name],
      ["Father's / Guardian's Name", s.father_name ?? s.guardian_name],
      ['Date of Birth according to the Admission Register (in figures and words)', `${formatDate(s.date_of_birth)} (${dateInWords(s.date_of_birth)})`],
      ['Nationality', s.nationality],
      ['Whether the pupil belongs to SC / ST / OBC / General', s.social_category],
      ['Date of first admission in the school with class', `${formatDate(s.admission_date)}${s.admission_class_name ? `, Class ${classInWords(s.admission_class_level, s.admission_class_name)}` : ''}`],
      ['Class in which the pupil last studied (in figures and words)', classInWords(s.numeric_level, s.class_name)],
      ['School / Board annual examination last taken, with result', lastExam],
      ['Whether failed, if so once / twice in the same class', timesFailed === 0 ? 'No' : timesFailed === 1 ? 'Once' : 'Twice'],
      ['Subjects studied', subjects.length ? subjects.join(', ') : '-'],
      ['Whether qualified for promotion to the higher class; if so, to which class', promotion],
      ['Month up to which the pupil has paid school dues', dues],
      ['Any fee concession availed; if so, the nature of such concession', fees.concessions ? `Yes: ${fees.concessions}` : 'No'],
      ['Total no. of working days in the academic session (till date of leaving)', att.working ? String(att.working) : '-'],
      ['Total no. of working days the pupil was present', att.working ? String(att.attended) : '-'],
      ['Whether NCC Cadet / Boy Scout / Girl Guide (give details)', v.nccScoutGuide],
      ['Games played or extra-curricular activities in which the pupil usually took part (mention achievement level)', v.gamesActivities],
      ['General conduct', v.generalConduct],
      ['Date of application for certificate', formatDate(input.applicationDate)],
      ['Date of issue of certificate', formatDate(issueDate)],
      ['Reasons for leaving the school', input.reasonForLeaving],
      ['Any other remarks', v.otherRemarks],
    ].map(([label, value], i) => ({ no: i + 1, label, value: value ?? '-' }));

    const yearName = s.academic_year ?? String(issueDate).slice(0, 4);
    const seq = await nextDocumentNumber(db, { branchId: s.branch_id, docType: 'tc', periodKey: yearName });
    const number = `${String(s.branch_code).toUpperCase()}/TC/${yearName}/${String(seq).padStart(4, '0')}`;

    const content = {
      title: 'Transfer Certificate',
      subtitle: 'School Leaving Certificate',
      numberLabel: 'TC No.',
      issueDate,
      school,
      references: [
        { label: 'Admission No.', value: s.admission_number },
        { label: 'PEN', value: s.pen_number },
        { label: 'APAAR ID', value: s.apaar_id },
      ],
      student: { id: s.id, name: s.name, admissionNumber: s.admission_number, className: classInWords(s.numeric_level, s.class_name), dateOfBirth: s.date_of_birth },
      fields,
      signatures: [
        { title: 'Prepared by', subtitle: '(Name and designation)' },
        { title: 'Checked by', subtitle: '(Name and designation)' },
        { title: 'Principal', subtitle: school.principalName ? `${school.principalName} (Signature with seal)` : 'Signature with seal' },
      ],
      leavingDate,
    };

    return finishIssue(db, auth, s, { type: 'transfer_certificate', number, content, afterInsert: () => repo.markStudentLeft(db, studentId, { leavingDate }) });
  });
}

/** Bonafide certificate for a currently enrolled student, for a stated purpose. */
export async function issueBonafide(auth, studentId, { purpose }) {
  return withTransaction(async (db) => {
    const s = await repo.getStudentRecord(db, studentId, { forUpdate: true });
    if (!s) throw AppError.notFound('Student not found', 'STUDENT_NOT_FOUND');
    assertBranchAccess(auth, { tenantId: s.tenant_id, branchId: s.branch_id }, 'Student not found');
    if (s.status !== 'enrolled' || !s.class_id) {
      throw unprocessable('NOT_ENROLLED', 'A bonafide certificate can only be issued to a student currently enrolled in a class.');
    }

    const p = pronouns(s.gender);
    const parent = s.father_name ?? s.guardian_name ?? s.parent_name;
    const classText = `${classInWords(s.numeric_level, s.class_name)}${s.section_name ? ` - ${s.section_name}` : ''}`;
    const issueDate = todayIn(s.timezone);
    const school = schoolFromRow(s);

    const body = [
      [
        { text: 'This is to certify that ' }, { text: s.name, bold: true },
        ...(parent ? [{ text: `, ${p.child} of ` }, { text: parent, bold: true }] : []),
        ...(s.mother_name ? [{ text: ' and ' }, { text: s.mother_name, bold: true }] : []),
        { text: ', is a bonafide student of this school, studying in Class ' }, { text: classText, bold: true },
        { text: ' during the academic session ' }, { text: s.academic_year ?? '', bold: true }, { text: '.' },
      ],
      [
        { text: `As per the school's admission register, ${p.possessive} Admission No. is ` }, { text: s.admission_number, bold: true },
        { text: ' and date of birth is ' }, { text: `${formatDate(s.date_of_birth)} (${dateInWords(s.date_of_birth)})`, bold: true }, { text: '.' },
      ],
      [{ text: 'This certificate is issued on request for the purpose of ' }, { text: purpose, bold: true }, { text: '.' }],
    ];

    const yearName = s.academic_year ?? String(issueDate).slice(0, 4);
    const seq = await nextDocumentNumber(db, { branchId: s.branch_id, docType: 'bonafide', periodKey: yearName });
    const number = `${String(s.branch_code).toUpperCase()}/BC/${yearName}/${String(seq).padStart(4, '0')}`;

    const content = {
      title: 'Bonafide Certificate',
      subtitle: null,
      numberLabel: 'Certificate No.',
      issueDate,
      school,
      references: [{ label: 'Admission No.', value: s.admission_number }, { label: 'PEN', value: s.pen_number }],
      student: { id: s.id, name: s.name, admissionNumber: s.admission_number, className: classText, dateOfBirth: s.date_of_birth },
      body,
      purpose,
      signatures: [{ title: 'Principal', subtitle: school.principalName ? `${school.principalName} (Signature with seal)` : 'Signature with seal' }],
    };
    return finishIssue(db, auth, s, { type: 'bonafide', number, content });
  });
}

async function finishIssue(db, auth, s, { type, number, content, afterInsert }) {
  const verificationCode = newVerificationCode();
  const id = await repo.insertCertificate(db, {
    tenantId: s.tenant_id, branchId: s.branch_id, studentId: s.id, type, number, verificationCode,
    content, sha256: contentHash(content), issuedBy: auth.userId,
  });
  await afterInsert?.();
  return { id, type, number, verificationCode, issueDate: content.issueDate, studentId: s.id };
}

function resultWords(result) {
  return { promoted: 'Passed and promoted', pass: 'Passed', detained: 'Not promoted', fail: 'Failed', withheld: 'Result withheld' }[result] ?? 'Awaited';
}

/**
 * Render input for a certificate. The first print is the ORIGINAL; every later
 * print is stamped DUPLICATE (or force one with copy = 'duplicate').
 */
export async function getCertificateDocument(auth, id, { copy } = {}) {
  return withTransaction(async (db) => {
    const cert = await repo.getCertificate(db, id, { forUpdate: true });
    if (!cert) throw AppError.notFound('Certificate not found', 'CERTIFICATE_NOT_FOUND');
    assertBranchAccess(auth, { tenantId: cert.tenant_id, branchId: cert.branch_id }, 'Certificate not found');
    if (contentHash(cert.content) !== cert.content_sha256) {
      // Should be impossible (trigger blocks edits); refuse to print a tampered record.
      throw new AppError(500, 'CERTIFICATE_TAMPERED', 'This certificate record failed its integrity check. Contact support.');
    }
    const printsBefore = cert.print_count;
    if (copy === 'original' && printsBefore > 0) throw conflict('ORIGINAL_ALREADY_PRINTED', 'The original was already printed. Print a duplicate copy instead.');
    if (cert.status === 'issued') await repo.recordPrint(db, id);
    const copyLabel = copy === 'duplicate' || printsBefore > 0 ? 'DUPLICATE' : 'ORIGINAL';
    return {
      copyLabel,
      cert: {
        type: cert.certificate_type, number: cert.certificate_number, verificationCode: cert.verification_code, status: cert.status,
        issuedAt: cert.issued_at, cancelledAt: cert.cancelled_at, cancelReason: cert.cancel_reason, content: cert.content,
      },
    };
  });
}

export async function cancelCertificate(auth, id, { reason }) {
  return withTransaction(async (db) => {
    const cert = await repo.getCertificate(db, id, { forUpdate: true });
    if (!cert) throw AppError.notFound('Certificate not found', 'CERTIFICATE_NOT_FOUND');
    assertBranchAccess(auth, { tenantId: cert.tenant_id, branchId: cert.branch_id }, 'Certificate not found');
    if (cert.status === 'cancelled') throw conflict('ALREADY_CANCELLED', 'This certificate is already cancelled.');
    await repo.cancelCertificate(db, id, { userId: auth.userId, reason });
    return {
      id, status: 'cancelled',
      // Cancelling a TC does not re-admit the student; the office does that explicitly.
      note: cert.certificate_type === 'transfer_certificate' ? 'The student is still marked as transferred. Update their status if they are staying.' : undefined,
    };
  });
}

export async function listCertificates(auth, filters) {
  const scope = await resolveBranchScope(auth, filters);
  return repo.listCertificates(pool, { scope, ...filters });
}

/** Public: what the QR code shows. No login; only what's needed to confirm a printed copy. */
export async function verifyDocument(code) {
  const normalized = String(code).toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (normalized.length !== 12) throw AppError.notFound('No document matches this code', 'NOT_FOUND');
  const doc = await repo.findByVerificationCode(`${normalized.slice(0, 4)}-${normalized.slice(4, 8)}-${normalized.slice(8)}`);
  if (!doc) throw AppError.notFound('No document matches this code', 'NOT_FOUND');
  const valid = doc.status === 'issued' || doc.status === 'published';
  return {
    valid,
    status: doc.status,
    documentType: doc.type,
    documentNumber: doc.number,
    school: doc.school_name,
    studentName: doc.student_name,
    className: doc.class_name,
    issuedOn: doc.issued_at,
    ...(doc.cancelled_at && { cancelledOn: doc.cancelled_at }),
    ...(doc.kind === 'report_card' && { percentage: doc.percentage, grade: doc.overall_grade, result: doc.result }),
    ...(doc.content_sha256 && { fingerprint: doc.content_sha256.slice(0, 16) }),
  };
}
