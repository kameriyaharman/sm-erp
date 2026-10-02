/**
 * Typed client for the SM ERP attendance API (/api/v1/academics).
 */

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'leave' | 'half_day';
export type NotificationStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled';

export interface SectionOption {
  id: string;
  name: string;
  label: string;                      // "Grade 5 A"
  class: { id: string; name: string };
  branch: { id: string; name: string };
  academicYear: { id: string; name: string };
  classTeacher: string | null;
  isClassTeacher: boolean;
  studentCount: number;
  submission: { submittedAt: string; present: number; absent: number; total: number } | null;
}

export interface RosterStudent {
  studentId: string;
  name: string;
  rollNumber: string | null;
  admissionNumber: string;
  status: AttendanceStatus | null;    // null = not marked yet for this date
  remarks: string | null;
  hasParentContact: boolean;
  notification: { status: NotificationStatus; channel: string; template: string; sentAt: string | null } | null;
}

export interface Roster {
  section: { id: string; name: string; label: string; className: string; branchName: string; academicYear: string; classTeacher: string | null };
  date: string;
  today: string;
  canEdit: boolean;
  editBlockedReason: string | null;
  submission: {
    submittedAt: string;
    submittedBy: string | null;
    updatedAt: string;
    updatedBy: string | null;
    revision: number;
    counts: { total: number; present: number; absent: number; other: number };
  } | null;
  students: RosterStudent[];
}

export interface SubmitAttendanceInput {
  sectionId: string;
  date?: string;
  records: { studentId: string; status: AttendanceStatus; remarks?: string }[];
  notifyParents?: boolean;
}

export interface SubmitAttendanceResult {
  sectionId: string;
  section: string;
  date: string;
  revision: number;
  updated: boolean;
  submittedAt: string;
  counts: { total: number; present: number; absent: number; other: number };
  notifications: { queued: number; corrections: number; cancelled: number; skipped: { studentId: string; reason: string }[] };
}

export interface ParentNotification {
  id: string;
  studentId: string;
  studentName: string;
  parentName: string;
  channel: 'sms' | 'whatsapp' | 'push' | 'email';
  recipient: string;                  // masked
  template: string;
  message: string;
  status: NotificationStatus;
  attempts: number;
  sentAt: string | null;
  lastError: string | null;
}

export interface AttendanceApi {
  listSections(date?: string, signal?: AbortSignal): Promise<SectionOption[]>;
  getRoster(sectionId: string, date?: string, signal?: AbortSignal): Promise<Roster>;
  submitAttendance(input: SubmitAttendanceInput): Promise<SubmitAttendanceResult>;
  listNotifications(sectionId: string, date?: string, signal?: AbortSignal): Promise<ParentNotification[]>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface ClientOptions {
  baseUrl: string;                    // e.g. `${process.env.NEXT_PUBLIC_API_URL}/api/v1`
  getAccessToken: () => string | null | Promise<string | null>;
  onUnauthorized?: () => void;
}

export function createAttendanceApi({ baseUrl, getAccessToken, onUnauthorized }: ClientOptions): AttendanceApi {
  async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const token = await getAccessToken();
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        signal,
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      throw new ApiError(0, 'NETWORK_ERROR', 'No connection. Your marks are still on screen; try submitting again.');
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401) onUnauthorized?.();
      const error = payload?.error ?? {};
      throw new ApiError(response.status, error.code ?? 'HTTP_ERROR', error.message ?? `Request failed (${response.status})`, error.details);
    }
    return (payload as { data: T }).data;
  }

  const qs = (params: Record<string, string | undefined>) => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v && search.set(k, v));
    const text = search.toString();
    return text ? `?${text}` : '';
  };

  return {
    listSections: (date, signal) => request('GET', `/academics/sections${qs({ date })}`, undefined, signal),
    getRoster: (sectionId, date, signal) => request('GET', `/academics/attendance${qs({ sectionId, date })}`, undefined, signal),
    submitAttendance: (input) => request('POST', '/academics/attendance', input),
    listNotifications: (sectionId, date, signal) =>
      request('GET', `/academics/attendance/notifications${qs({ sectionId, date })}`, undefined, signal),
  };
}
