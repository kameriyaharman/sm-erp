/** Types for the fee setup screens (`/fees/heads`, `/fees/structure*`, `/students/:id/fee-concession`). */

export type Money = string;
export type Frequency = 'monthly' | 'quarterly' | 'half_yearly' | 'annual' | 'one_time';
export const FREQUENCIES: Frequency[] = ['monthly', 'quarterly', 'half_yearly', 'annual', 'one_time'];
export const RECURRING: Frequency[] = ['monthly', 'quarterly', 'half_yearly', 'annual'];
export const FREQUENCY_LABEL: Record<Frequency, string> = {
  monthly: 'Monthly (12)',
  quarterly: 'Quarterly (4)',
  half_yearly: 'Half-yearly (2)',
  annual: 'Annual (1)',
  one_time: 'One-time',
};
export const FREQUENCY_SHORT: Record<Frequency, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  half_yearly: 'Half-yearly',
  annual: 'Annual',
  one_time: 'One-time',
};

export interface FeeHead {
  id: string;
  name: string;
  code: string;
  description: string | null;
  type: 'recurring' | 'one_time';
  defaultFrequency: Frequency;
  refundable: boolean;
  optional: boolean;
  displayOrder: number;
  isActive: boolean;
  usage?: { classes: number; allocations: number };
}

export interface AcademicYear {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
}

export interface Overview {
  academicYear: AcademicYear;
  years: AcademicYear[];
  classes: Array<{ id: string; name: string; annual: Money; heads: number; installments: number; students: number; studentsSetUp: number }>;
}

export interface StructureRow {
  id: string;
  feeHead: { id: string; name: string; code: string };
  frequency: Frequency;
  installmentNo: number;
  label: string | null;
  amount: Money;
  dueDate: string;
  allocations: number;
  invoiced: number;
}

export interface Structure {
  class: { id: string; name: string };
  academicYear: AcademicYear;
  students: number;
  rows: StructureRow[];
  heads: Array<{ id: string; name: string; code: string; isActive: boolean; frequency: Frequency; annual: Money }>;
  totals: { annual: Money; byInstallment: Record<string, Money> };
}

export interface Impact {
  rowsAdded: number;
  rowsChanged: number;
  rowsRemoved: number;
  allocationsUpdated: number;
  studentsUpdated: number;
  allocationsRemoved: number;
  invoicedUnchanged: number;
}

export interface ScheduleRow {
  installmentNo: number;
  label: string;
  dueDate: string;
  amount: Money;
}

export interface ApplyPreview {
  class: { id: string; name: string };
  academicYear: AcademicYear;
  structureRows: number;
  students: number;
  upToDate: number;
  willChange: number;
  withInvoices: number;
  newAllocations: number;
  gross: Money;
  concession: Money;
  net: Money;
  rows: Array<{
    studentId: string;
    name: string;
    admissionNumber: string;
    section: string | null;
    rollNumber: string | null;
    hasInvoices: boolean;
    status: 'new' | 'partial' | 'up_to_date' | 'no_structure';
    newAllocations: number;
    gross: Money;
    concession: Money;
    net: Money;
  }>;
}

export type ConcessionType = 'percentage' | 'flat' | 'full_waiver';
export const CONCESSION_LABEL: Record<ConcessionType | 'none', string> = {
  percentage: 'Percentage',
  flat: 'Flat ₹ per instalment',
  full_waiver: 'Full waiver',
  none: 'None',
};

export interface ConcessionRule {
  id: string;
  feeHead: { id: string; name: string } | null;
  type: ConcessionType;
  value: Money;
  reason: string;
  approvedBy: string | null;
  recordedBy: string | null;
  approvedAt: string;
}

export interface StudentAllocation {
  id: string;
  feeHead: { id: string; name: string };
  installmentNo: number;
  label: string | null;
  dueDate: string;
  baseAmount: Money;
  concessionType: ConcessionType | 'none';
  concessionAmount: Money;
  netAmount: Money;
  concessionReason: string | null;
  invoiced: boolean;
  invoiceNumber: string | null;
}

export interface ConcessionView {
  student: { id: string; name: string; admissionNumber: string; className: string | null; sectionName: string | null };
  academicYear: AcademicYear;
  concessions: ConcessionRule[];
  allocations: StudentAllocation[];
  totals: { gross: Money; concession: Money; net: Money; unInvoicedNet: Money };
}
