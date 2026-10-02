/**
 * Typed client for the SM ERP fees API (/api/v1/fees).
 * Money is always a decimal string in rupees ("4500.00"), exactly as the API sends it.
 */

export type Money = string;

export type StudentFeeStatus = 'paid' | 'partially_paid' | 'unpaid' | 'overdue' | 'no_fees';
export type InvoiceStatus = 'unpaid' | 'partially_paid' | 'paid' | 'cancelled';
export type PaymentMode = 'cash' | 'upi' | 'card' | 'bank_transfer' | 'cheque' | 'demand_draft';

export interface StudentFeeRow {
  studentId: string;
  branchId: string;
  studentName: string;
  admissionNumber: string;
  rollNumber: string | null;
  class: { id: string; name: string } | null;
  section: { id: string; name: string } | null;
  academicYear: { id: string; name: string };
  totalFee: Money;
  paid: Money;
  pending: Money;
  overdue: Money;
  notYetInvoiced: Money;
  openInvoices: number;
  status: StudentFeeStatus;
}

export interface ListStudentsParams {
  search?: string;
  status?: 'all' | 'pending' | 'overdue' | 'paid';
  sort?: 'pending' | 'name' | 'admission';
  page?: number;
  limit?: number;
  classId?: string;
  sectionId?: string;
  branchId?: string;
  academicYearId?: string;
}

export interface StudentFeeList {
  data: StudentFeeRow[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    totals: { totalFee: Money; paid: Money; pending: Money };
  };
}

export interface OpenInvoice {
  id: string;
  invoiceNumber: string;
  periodLabel: string | null;
  issueDate: string;
  dueDate: string;
  netAmount: Money;
  paidAmount: Money;
  balanceAmount: Money;
  status: InvoiceStatus;
  feeHeads?: string | null;
}

export interface StudentDues {
  student: {
    id: string;
    name: string;
    admissionNumber: string;
    rollNumber: string | null;
    className: string | null;
    sectionName: string | null;
    parent: { name: string; phone: string | null } | null;
  };
  openInvoices: OpenInvoice[];
  notYetInvoiced: {
    amount: Money;
    allocations: { id: string; feeHead: string; installmentNo: number; dueDate: string; netAmount: Money }[];
  };
  totals: { invoicedDue: Money; totalDue: Money };
}

export interface CreateInvoiceInput {
  studentId: string;
  allocationIds?: string[];
  billUpTo?: string;
  items?: { feeHeadId: string; description?: string; amount: Money; concessionAmount?: Money }[];
  dueDate?: string;
  periodLabel?: string;
  notes?: string;
}

export interface Invoice extends OpenInvoice {
  studentId: string;
  items?: { id: string; feeHead: string; description: string | null; amount: Money; concessionAmount: Money; netAmount: Money }[];
}

export interface CollectPaymentInput {
  studentId: string;
  amount: Money;
  paymentMode: PaymentMode;
  invoiceIds?: string[];
  instrumentNumber?: string;
  instrumentDate?: string;
  bankName?: string;
  remarks?: string;
}

export interface Receipt {
  id: string;
  receiptNumber: string;
  studentId: string;
  amount: Money;
  paymentMode: PaymentMode;
  instrumentNumber: string | null;
  receivedAt: string;
  collectedBy: string | null;
  appliedTo: {
    invoiceId: string;
    invoiceNumber: string;
    periodLabel: string | null;
    amountApplied: Money;
    invoiceBalance: Money;
    invoiceStatus: InvoiceStatus;
  }[];
}

export interface FeesApi {
  listStudents(params: ListStudentsParams, signal?: AbortSignal): Promise<StudentFeeList>;
  getStudentDues(studentId: string, signal?: AbortSignal): Promise<StudentDues>;
  createInvoice(input: CreateInvoiceInput): Promise<Invoice>;
  /** Pass the same key when retrying the same payment; the server never charges twice. */
  collectPayment(input: CollectPaymentInput, idempotencyKey: string): Promise<Receipt>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly requestId?: string;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

interface ClientOptions {
  /** e.g. process.env.NEXT_PUBLIC_API_URL + '/api/v1' */
  baseUrl: string;
  /** Returns the current access token (or null). Refreshing is the caller's concern. */
  getAccessToken: () => string | null | Promise<string | null>;
  /** Called on 401 so the app can refresh the session or redirect to sign-in. */
  onUnauthorized?: () => void;
}

export function createFeesApi({ baseUrl, getAccessToken, onUnauthorized }: ClientOptions): FeesApi {
  async function request<T>(method: string, path: string, init: { body?: unknown; headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<T> {
    const token = await getAccessToken();
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        credentials: 'include',
        signal: init.signal,
        headers: {
          Accept: 'application/json',
          ...(init.body !== undefined && { 'Content-Type': 'application/json' }),
          ...(token && { Authorization: `Bearer ${token}` }),
          ...init.headers,
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection and try again.');
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401) onUnauthorized?.();
      const error = payload?.error ?? {};
      throw new ApiError(
        response.status,
        error.code ?? 'HTTP_ERROR',
        error.message ?? `Request failed (${response.status})`,
        error.details,
        error.requestId,
      );
    }
    return payload as T;
  }

  return {
    listStudents(params, signal) {
      const query = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== '') query.set(key, String(value));
      });
      return request<StudentFeeList>('GET', `/fees/students?${query}`, { signal });
    },
    async getStudentDues(studentId, signal) {
      return (await request<{ data: StudentDues }>('GET', `/fees/students/${studentId}/dues`, { signal })).data;
    },
    async createInvoice(input) {
      return (await request<{ data: Invoice }>('POST', '/fees/invoices', { body: input })).data;
    },
    async collectPayment(input, idempotencyKey) {
      return (
        await request<{ data: Receipt }>('POST', '/fees/payments', {
          body: input,
          headers: { 'Idempotency-Key': idempotencyKey },
        })
      ).data;
    },
  };
}
