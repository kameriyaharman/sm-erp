export interface Term {
  id: string;
  name: string;
  sequenceNo: number;
  startDate: string;
  endDate: string;
  examCount: number;
}
export interface AcademicYear {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  sectionCount: number;
  studentCount: number;
  terms: Term[];
}
export interface YearsResponse {
  data: AcademicYear[];
  meta: { branchId: string; suggestedNext: { name: string; startDate: string; endDate: string } };
}

export interface SetupSection {
  id: string;
  name: string;
  capacity: number | null;
  roomNumber: string | null;
  studentCount: number;
  classTeacher: { staffId: string; name: string } | null;
}
export interface SetupClass {
  id: string;
  name: string;
  code: string | null;
  numericLevel: number | null;
  displayOrder: number;
  status: 'active' | 'inactive';
  studentCount: number;
  sections: SetupSection[];
}
export interface StaffChoice {
  staffId: string;
  name: string;
  designation: string | null;
  role: string;
}
export interface ClassesResponse {
  data: SetupClass[];
  meta: { branchId: string; academicYear: { id: string; name: string } | null; staff: StaffChoice[] };
}

export interface SetupSubject {
  id: string;
  name: string;
  code: string;
  subjectType: 'theory' | 'practical' | 'both' | 'activity';
  isGradedOnly: boolean;
  displayOrder: number;
  status: 'active' | 'inactive';
  teacherAssignments: number;
  examPapers: number;
}
