/**
 * Data shape for the parent home screen. One entry per child, so parents with
 * siblings in the school switch between them without reloading.
 *
 * Fee and attendance fields map onto existing APIs:
 *   fee        <- /fees/students/:id/dues  (totals.totalDue, overdue = open invoices past due)
 *   attendance <- student_attendance for today (status + parent_notifications)
 * Timetable, homework and bus are not in the backend yet; these types are the contract to build them to.
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
  parentName: string;
  schoolName: string;
  schoolPhone: string | null;
  children: ChildHome[];
}
