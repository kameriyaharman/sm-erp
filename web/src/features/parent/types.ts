/**
 * Data shape for the parent home screen. One entry per child, so parents with
 * siblings in the school switch between them without reloading.
 *
 * Fee and attendance fields map onto existing APIs:
 *   fee        <- /fees/students/:id/dues  (totals.totalDue, overdue = open invoices past due)
 *   attendance <- student_attendance for today (status + parent_notifications)
 * Timetable, homework and bus come from the section timetable, homework and transport tables
 * (API contract §11). The per-child screens below use the /parent/children/:id/* endpoints.
 */

export type Money = string; // rupees, "31000.00"

export interface ChildSummary {
  id: string;
  name: string;
  firstName: string;
  className: string;          // "Grade 5"
  sectionName: string;        // "A"
  rollNumber: string | null;
  classTeacher: { name: string; phone: string | null } | null;
}

export interface FeeStatus {
  totalDue: Money;            // everything not yet paid (incl. not-yet-invoiced instalments)
  overdue: Money;             // part of totalDue already past its due date
  nextDueDate: string | null; // earliest open due date, YYYY-MM-DD
  oldestOverdueDate: string | null;
}

export interface TodayAttendance {
  date: string;               // YYYY-MM-DD
  status: 'present' | 'absent' | 'late' | 'leave' | 'half_day' | 'not_marked';
  markedAt: string | null;    // ISO timestamp
}

export interface ReportCardSummary {
  label: string;              // "Term 1"
  publishedAt: string;        // ISO
  percentage: number | null;
  grade: string | null;
  isNew: boolean;             // not opened by the parent yet
}

export interface Period {
  id: string;
  start: string;              // "08:00"
  end: string;                // "08:40"
  kind: 'class' | 'break' | 'assembly' | 'activity';
  subject: string;            // "Mathematics" / "Lunch break"
  teacher?: string;
  room?: string;
}

export interface HomeworkItem {
  id: string;
  subject: string;
  title: string;
  details?: string;
  teacher: string;
  assignedAt: string;         // ISO
  dueDate: string;            // YYYY-MM-DD
  attachments: { name: string; url: string; sizeKb?: number }[];
}

export interface BusStatus {
  routeName: string;          // "Route 7, Sector 12"
  state: 'not_running' | 'to_school' | 'at_school' | 'to_home' | 'delayed';
  etaMinutes: number | null;  // to the child's stop
  stopName: string;
  updatedAt: string;          // ISO
  pickupTime?: string;        // "07:12"
  dropTime?: string;
  driverName?: string | null;
  driverPhone?: string | null;
  vehicleNumber?: string | null;
}

export interface ChildHome {
  child: ChildSummary;
  fee: FeeStatus;
  attendance: TodayAttendance;
  reportCard: ReportCardSummary | null;
  /** Keyed by ISO weekday, 1 = Monday ... 6 = Saturday */
  timetable: Record<number, Period[]>;
  homework: HomeworkItem[];
  bus: BusStatus | null;
}

export interface ParentHomeData {
  /** 'student' = a student signed in to the family portal: one child, themself. */
  viewer?: 'parent' | 'student';
  /** The signed-in person's name (the student's own name for a student). */
  parentName: string;
  schoolName: string;
  schoolPhone: string | null;
  children: ChildHome[];
}

/* ============================================================================
 * Per-child screens (GET /parent/children/:studentId/*)
 * ========================================================================== */

export interface FeeInvoiceItem {
  feeHead: string;
  description: string | null;
  amount: Money;
}

export interface FeeInvoice {
  id: string;
  invoiceNumber: string;
  periodLabel: string | null;
  issueDate: string;
  dueDate: string;
  netAmount: Money;
  paidAmount: Money;
  balanceAmount: Money;
  status: 'unpaid' | 'partially_paid' | 'paid';
  overdue: boolean;
  items: FeeInvoiceItem[];
}

export interface UpcomingInstallment {
  feeHead: string;
  installmentNo: number;
  dueDate: string;
  netAmount: Money;
}

export interface FeeReceipt {
  id: string;
  receiptNumber: string;
  receivedAt: string;         // ISO
  amount: Money;
  paymentMode: string;
}

export interface ChildFees {
  child: { id: string; name: string; className: string; sectionName: string };
  totals: { totalFee: Money; paid: Money; pending: Money; overdue: Money };
  invoices: FeeInvoice[];
  upcoming: UpcomingInstallment[];
  receipts: FeeReceipt[];
  /** The school's own Razorpay account (Settings -> Online payments). mode 'test' = no real money moves. */
  onlinePayment: { enabled: boolean; mode?: 'test' | 'live' | null; keyId?: string | null; allowPartial?: boolean; minAmount?: Money | null };
}

export type AttendanceDayStatus = 'present' | 'absent' | 'late' | 'leave' | 'half_day';

export interface AttendanceStats {
  workingDays: number;
  present: number;
  absent: number;
  late: number;
  leave: number;
  halfDay: number;
  percentage: number | null;
}

export interface ChildAttendance {
  month: string;              // YYYY-MM
  days: { date: string; status: AttendanceDayStatus }[];
  summary: AttendanceStats;
  year: AttendanceStats;
}

/** Homework row as /homework and /parent/children/:id/homework return it. */
export interface HomeworkRow {
  id: string;
  section: { id: string; label: string };
  subject: { id: string; name: string } | null;
  title: string;
  details: string | null;
  assignedAt: string;
  dueDate: string;
  teacher: { name: string | null };
  attachments?: Array<{ id: string; fileName: string; mimeType: string; sizeBytes: number; url: string; uploadedAt: string }>;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface TimetablePeriod {
  periodNo: number;
  start: string;
  end: string;
  kind: Period['kind'];
  subject: { id: string; name: string } | null;
  label: string;
  teacher: { staffId: string; name: string } | null;
  room: string | null;
}

export interface SectionTimetable {
  section: { id: string; label: string } | null;
  /** "1" (Monday) ... "6" (Saturday), always present. */
  days: Record<string, TimetablePeriod[]>;
}

export interface ChildTransport {
  route: { name: string; vehicleNumber: string | null; driverName: string | null; driverPhone: string | null; attendantName: string | null };
  stop: { name: string; pickupTime: string | null; dropTime: string | null };
  stops: { name: string; pickupTime: string | null; dropTime: string | null; isMine: boolean }[];
}

/** GET /documents/students/:studentId/report-cards (raw rows, snake_case). */
export interface StudentReportCard {
  id: string;
  academic_year_id: string;
  academic_year: string;
  term_id: string | null;
  term_name: string | null;
  is_final: boolean;
  percentage: string | null;
  overall_grade: string | null;
  result: string | null;
  status: string;
  published_at: string | null;
}

export interface SchoolNotice {
  id: string;
  title: string;
  body: string;
  audience: 'all' | 'parents' | 'teachers';
  class: { id: string; name: string } | null;
  pinned: boolean;
  createdAt: string;
  createdBy: { name: string | null } | null;
}
