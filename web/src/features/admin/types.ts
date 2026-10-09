/**
 * Response shapes of the admin endpoints (docs/api-v2-contract.md + the controllers, which are the truth).
 * Money is a rupee decimal string ("4500.00"). Dates are YYYY-MM-DD, times HH:MM, timestamps ISO-8601.
 */

export type Money = string;
export interface Ref {
  id: string;
  name: string;
}
export interface ListMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
export interface Wrapped<T> {
  data: T;
}
export interface Paged<T, M = ListMeta> {
  data: T[];
  meta: M;
}

// ------------------------------------------------------------------ school masters
export interface ClassTeacherRef {
  staffId: string;
  userId: string;
  name: string;
}
export interface SectionInfo {
  id: string;
  name: string;
  label: string;
  capacity: number | null;
  studentCount: number;
  classTeacher: ClassTeacherRef | null;
}
export interface ClassInfo {
  id: string;
  name: string;
  numericLevel: number | null;
  sections: SectionInfo[];
}
export interface Subject {
  id: string;
  name: string;
  code: string;
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

// ------------------------------------------------------------------ students
export type StudentStatus = 'enrolled' | 'suspended' | 'transferred' | 'withdrawn' | 'graduated';
export type Gender = 'male' | 'female' | 'other';
export const SOCIAL_CATEGORIES = ['General', 'SC', 'ST', 'OBC', 'EWS'] as const;
export type SocialCategory = (typeof SOCIAL_CATEGORIES)[number];

export interface StudentRow {
  id: string;
  name: string;
  firstName: string;
  lastName: string | null;
  admissionNumber: string;
  rollNumber: string | null;
  gender: Gender;
  dateOfBirth: string;
  admissionDate: string;
  status: StudentStatus;
  class: Ref | null;
  section: Ref | null;
  parent: { name: string; phone: string | null } | null;
}

export interface StudentAddress {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
}
export interface ParentInfo {
  name: string | null;
  phone: string | null;
  email: string | null;
  occupation: string | null;
}

export interface StudentDetail {
  id: string;
  name: string;
  firstName: string;
  lastName: string | null;
  admissionNumber: string;
  admissionDate: string;
  rollNumber: string | null;
  gender: Gender;
  dateOfBirth: string;
  status: StudentStatus;
  dateOfLeaving: string | null;
  bloodGroup: string | null;
  address: StudentAddress | null;
  /** Always masked ("XXXX-XXXX-1234"); GET /students/:id/aadhaar reveals it (admins). */
  aadhaarMasked: string | null;
  religion: string | null;
  motherTongue: string | null;
  nationality: string | null;
  house: string | null;
  identificationMarks: string | null;
  photo: { url: string; updatedAt: string } | null;
  class: Ref | null;
  section: Ref | null;
  academicYear: Ref | null;
  fatherName: string | null;
  motherName: string | null;
  guardianName: string | null;
  socialCategory: SocialCategory | null;
  penNumber: string | null;
  apaarId: string | null;
  father: ParentInfo;
  mother: ParentInfo;
  guardian: { name: string | null; relation: string | null; phone: string | null };
  emergencyContact: { name: string | null; relation: string | null; phone: string | null } | null;
  previousSchool: { name: string | null; board: string | null; lastClassPassed: string | null; tcNumber: string | null; tcDate: string | null } | null;
  medical: { bloodGroup: string | null; allergies: string | null; notes: string | null };
  parent: { userId: string; name: string; phone: string | null; email: string | null } | null;
  fees: { totalFee: Money; paid: Money; pending: Money; overdue: Money };
  attendance: { workingDays: number; present: number; absent: number; late: number; leave: number; halfDay: number; percentage: number | null };
  transport: { routeId: string; routeName: string; stopName: string; pickupTime: string | null } | null;
  reportCards: Array<{ id: string; label: string; status: ReportCardStatus; percentage: number | null; grade: string | null; publishedAt: string | null }>;
  certificates: Array<{ id: string; type: CertificateType; number: string; status: CertificateStatus; issuedAt: string }>;
}

// ------------------------------------------------------------------ staff
export type StaffRole = 'teacher' | 'branch_admin' | 'super_admin';
export interface StaffMember {
  id: string;
  userId: string;
  name: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  role: StaffRole;
  employeeCode: string | null;
  designation: string | null;
  department: string | null;
  dateOfJoining: string | null;
  status: 'active' | 'inactive';
  classTeacherOf: Array<{ sectionId: string; label: string }>;
  /** Current-year teaching assignments (one teacher per subject per section). */
  subjects?: Array<{ sectionId: string; sectionLabel: string; subjectId: string; subjectName: string }>;
}

export interface SubjectConflict {
  section: { id: string; label: string };
  subject: { id: string; name: string };
  teacher: { staffId: string; name: string };
}

// ------------------------------------------------------------------ fees / finance
export interface DefaulterRow {
  studentId: string;
  branchId: string;
  admissionNumber: string;
  rollNumber: string | null;
  studentName: string;
  class: Ref | null;
  section: Ref | null;
  parent: { name: string; phone: string | null; email: string | null } | null;
  openInvoices: number;
  totalDue: Money;
  oldestDueDate: string;
  daysOverdue: number;
}
export interface DefaultersMeta extends ListMeta {
  asOf: string;
  totalOutstanding: Money;
}
export interface FeeReminderPreview {
  dryRun: true;
  date: string;
  students: number;
  reminders: number;
  noPhone: number;
  totalDue: Money;
}
export interface BatchStarted {
  batchId: string;
  date?: string;
  statusUrl: string;
}

// ------------------------------------------------------------------ expenses
export const EXPENSE_CATEGORIES = ['salary', 'utilities', 'maintenance', 'transport', 'supplies', 'events', 'other'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export const EXPENSE_MODES = ['cash', 'upi', 'bank_transfer', 'cheque', 'card'] as const;
export type ExpenseMode = (typeof EXPENSE_MODES)[number];
export interface Expense {
  id: string;
  category: ExpenseCategory;
  description: string;
  amount: Money;
  expenseDate: string;
  paymentMode: ExpenseMode;
  vendor: string | null;
  reference: string | null;
  createdBy: { name: string } | null;
  createdAt: string;
}
export interface ExpensesMeta extends ListMeta {
  totalAmount: Money;
  byCategory: Array<{ category: ExpenseCategory; amount: Money }>;
}
export interface ExpenseMonth {
  month: string;
  amount: Money;
}

// ------------------------------------------------------------------ exams
export const EXAM_TYPES = ['unit_test', 'periodic', 'mid_term', 'final', 'practical', 'internal', 'other'] as const;
export type ExamType = (typeof EXAM_TYPES)[number];
export const COMPONENT_CODES = ['PT', 'NB', 'SEA', 'MA', 'PF', 'TERM'] as const;
export type ComponentCode = (typeof COMPONENT_CODES)[number];
export const EXAM_STATUSES = ['draft', 'scheduled', 'ongoing', 'completed', 'results_published'] as const;
export type ExamStatus = (typeof EXAM_STATUSES)[number];

export interface Exam {
  id: string;
  name: string;
  examType: ExamType;
  componentCode: ComponentCode | null;
  term: Ref | null;
  startDate: string | null;
  endDate: string | null;
  status: ExamStatus;
  papers: number;
  marksEntered: number;
  marksExpected: number;
}
export interface Paper {
  id: string;
  examId: string;
  class: Ref;
  section: Ref | null;
  subject: { id: string; name: string; code: string };
  examDate: string | null;
  maxMarks: number;
  passMarks: number | null;
  marksLocked: boolean;
  entered: number;
  students: number;
}
export interface MarkRow {
  studentId: string;
  name: string;
  rollNumber: string | null;
  admissionNumber: string;
  marksObtained: number | null;
  isAbsent: boolean;
  remarks: string | null;
}
export interface MarksSheet {
  paper: Paper & { exam: Ref };
  section: { id: string; name: string; label: string };
  students: MarkRow[];
}

// ------------------------------------------------------------------ report cards
export type ReportCardStatus = 'draft' | 'generated' | 'published' | 'revoked';
export type ReportCardResult = 'pass' | 'fail' | 'promoted' | 'detained' | 'withheld' | 'pending';
export interface SectionReportCard {
  id: string;
  studentId: string;
  name: string;
  rollNumber: string | null;
  status: ReportCardStatus;
  percentage: number | null;
  grade: string | null;
  rankInSection: number | null;
  result: ReportCardResult | null;
  teacherRemarks: string | null;
  publishedAt: string | null;
}
export interface GenerateSummary {
  sectionId: string;
  academicYear: string;
  term: string | null;
  isFinal: boolean;
  scheme: string;
  generated: number;
  skippedPublished: number;
  incomplete: number;
  students: Array<{
    reportCardId: string;
    studentId: string;
    name: string;
    rollNumber: string | null;
    percentage: number | null;
    grade: string | null;
    rankInSection: number | null;
    complete: boolean;
    missing?: string[];
  }>;
}

// ------------------------------------------------------------------ certificates
export type CertificateType = 'transfer_certificate' | 'bonafide';
export type CertificateStatus = 'issued' | 'cancelled';
/** GET /documents/certificates returns database column names. */
export interface CertificateRow {
  id: string;
  certificate_type: CertificateType;
  certificate_number: string;
  status: CertificateStatus;
  issued_at: string;
  print_count: number;
  student_id: string;
  student_name: string | null;
  admission_number: string | null;
}
export interface IssuedCertificate {
  id: string;
  type: CertificateType;
  number: string;
  verificationCode: string;
  issueDate: string;
  studentId: string;
}

// ------------------------------------------------------------------ timetable
export type PeriodKind = 'class' | 'break' | 'assembly' | 'activity';
export interface Period {
  periodNo: number;
  start: string;
  end: string;
  kind: PeriodKind;
  subject: Ref | null;
  label: string | null;
  teacher: { staffId: string; name: string } | null;
  room: string | null;
}
export interface Timetable {
  section: { id: string; label: string };
  days: Record<'1' | '2' | '3' | '4' | '5' | '6', Period[]>;
}
export interface TeacherClash {
  weekday?: number;
  periodNo?: number;
  teacher?: string;
  section?: string;
  [key: string]: unknown;
}

// ------------------------------------------------------------------ notices
export type Audience = 'all' | 'parents' | 'teachers';
export interface NoticeItem {
  id: string;
  title: string;
  body: string;
  audience: Audience;
  class: Ref | null;
  pinned: boolean;
  createdAt: string;
  createdBy: { name: string } | null;
}
export interface NoticeCreated {
  notice: NoticeItem;
  broadcast: { batchId: string; recipients: number } | null;
}

// ------------------------------------------------------------------ transport
export interface RouteStop {
  id: string;
  name: string;
  sequenceNo: number;
  pickupTime: string | null;
  dropTime: string | null;
  studentCount: number;
}
export interface TransportRoute {
  id: string;
  name: string;
  vehicleNumber: string;
  driverName: string;
  driverPhone: string;
  attendantName: string | null;
  capacity: number | null;
  studentCount: number;
  status: 'active' | 'inactive';
  stops: RouteStop[];
}
export interface RouteRider {
  studentId: string;
  name: string;
  admissionNumber: string;
  classLabel: string | null;
  stop: Ref | null;
}

// ------------------------------------------------------------------ notifications
export type LogStatus = 'sending' | 'sent' | 'failed' | 'abandoned';
export type LogEvent =
  | 'absentee_alert' | 'fee_due_reminder' | 'broadcast_notice' | 'attendance_correction'
  | 'late_arrival' | 'gate_entry' | 'fee_receipt' | 'report_card_published' | 'homework_assigned' | 'birthday_wish' | 'test_message';
export interface NotificationLog {
  id: string;
  batchId: string | null;
  eventType: LogEvent;
  template: string | null;
  channel: string | null;
  provider: string | null;
  recipient: { userId: string | null; name?: string | null; phone: string | null; email?: string | null };
  /** Whose account sent it: the school's own provider or the SM ERP platform account. */
  account?: 'school' | 'platform' | null;
  student: Ref | null;
  status: LogStatus;
  attempts: number;
  retryCount: number;
  maxRetries: number;
  nextRetryAt: string | null;
  lastError: { code: string; message: string | null; httpStatus: number | null } | null;
  providerMessageId: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ------------------------------------------------------------------ attendance (dashboard)
export interface AttendanceSection {
  id: string;
  name: string;
  label: string;
  class: Ref;
  classTeacher: string | null;
  studentCount: number;
  submission: { submittedAt: string; present: number; absent: number; total: number } | null;
}
