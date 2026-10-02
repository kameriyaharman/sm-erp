/** API shapes used by the teacher screens (see docs/api-v2-contract.md). */

export interface ClassTeacherRef {
  staffId: string;
  userId: string;
  name: string;
}

export interface SchoolSection {
  id: string;
  name: string;
  label: string;              // "Grade 5 A"
  capacity: number | null;
  studentCount: number;
  classTeacher: ClassTeacherRef | null;
}

export interface SchoolClass {
  id: string;
  name: string;
  numericLevel: number | null;
  sections: SchoolSection[];
}

/** A section flattened with its class, as the pickers use it. */
export interface SectionChoice extends SchoolSection {
  classId: string;
  className: string;
  mine: boolean;              // the signed-in user is its class teacher
}

export interface Subject {
  id: string;
  name: string;
  code: string | null;
  isGradedOnly: boolean;
  displayOrder: number;
}

export interface Term {
  id: string;
  name: string;
  sequenceNo: number;
  startDate: string;
  endDate: string;
}

export type ExamStatus = 'draft' | 'scheduled' | 'ongoing' | 'completed' | 'results_published';

export interface TeacherPaper {
  id: string;
  examId: string;
  exam: { id: string; name: string; status: ExamStatus };
  class: { id: string; name: string };
  section: { id: string; name: string } | null;
  subject: { id: string; name: string; code: string | null };
  examDate: string | null;
  maxMarks: number;
  passMarks: number | null;
  marksLocked: boolean;
  entered: number;
  students: number;
  /** Sections of the paper's class the teacher may open: subject sections (canEdit) + their class-teacher section (view only). */
  sections?: Array<{ id: string; label: string; canEdit: boolean }>;
}

export interface MarksStudent {
  studentId: string;
  name: string;
  rollNumber: string | null;
  admissionNumber: string;
  marksObtained: number | null;
  isAbsent: boolean;
  remarks: string | null;
}

export interface MarksSheet {
  paper: Omit<TeacherPaper, 'exam'> & { exam: { id: string; name: string } };
  section: { id: string; name: string; label: string };
  /** false = view only (class teacher looking at another subject). */
  canEdit?: boolean;
  students: MarksStudent[];
}

export interface MarksEntryInput {
  studentId: string;
  marksObtained: number | null;
  isAbsent: boolean;
  remarks?: string;
}

export type ReportCardStatus = 'generated' | 'published' | 'draft' | 'revoked';

export interface SectionReportCard {
  id: string;
  studentId: string;
  name: string;
  rollNumber: string | null;
  status: ReportCardStatus;
  percentage: number | null;
  grade: string | null;
  rankInSection: number | null;
  result: string | null;
  teacherRemarks: string | null;
  publishedAt: string | null;
}

export interface AttendanceHistoryDay {
  date: string;
  total: number;
  present: number;
  absent: number;
  late: number;
  leave: number;
  halfDay: number;
  submittedAt: string | null;
}

export interface AttendanceHistoryStudent {
  studentId: string;
  name: string;
  rollNumber: string | null;
  present: number;
  absent: number;
  late: number;
  leave: number;
  halfDay: number;
  percentage: number | null;
}

export interface AttendanceHistory {
  section: { id: string; label: string };
  month: string;
  days: AttendanceHistoryDay[];
  students: AttendanceHistoryStudent[];
}

export interface HomeworkRow {
  id: string;
  section: { id: string; label: string };
  subject: { id: string; name: string } | null;
  title: string;
  details: string | null;
  assignedAt: string;
  dueDate: string;
  teacher: { name: string | null };
  createdBy?: { userId: string; name: string } | null;
  /** The caller may delete it and add/remove files. */
  canEdit?: boolean;
  attachments?: HomeworkAttachment[];
}

export interface HomeworkAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;              // "/api/v1/homework/attachments/<id>"
  uploadedAt: string;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface StudentRow {
  id: string;
  name: string;
  firstName: string;
  lastName: string | null;
  admissionNumber: string;
  rollNumber: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  admissionDate: string | null;
  status: string;
  class: { id: string; name: string } | null;
  section: { id: string; name: string } | null;
  parent: { name: string; phone: string | null } | null;
}

export type PeriodKind = 'class' | 'break' | 'assembly' | 'activity';

export interface TimetableSlot {
  periodNo: number;
  start: string;
  end: string;
  kind: PeriodKind;
  subject: { id: string; name: string } | null;
  label: string;
  teacher: { staffId: string; name: string } | null;
  room: string | null;
  /** Only in the teacher's own week (GET /teacher/timetable). */
  section?: { id: string; label: string };
}

export interface SectionTimetable {
  section: { id: string; label: string } | null;
  days: Record<string, TimetableSlot[]>;
}
