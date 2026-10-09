import type { ModuleKey } from '@/lib/entitlements';

export type Channel = 'whatsapp' | 'sms' | 'email';
export type EventKey =
  | 'absentee_alert' | 'late_arrival' | 'attendance_correction' | 'gate_entry'
  | 'fee_due_reminder' | 'fee_receipt' | 'general_notice'
  | 'report_card_published' | 'homework_assigned' | 'birthday_wish';

export interface Branch {
  id: string;
  name: string;
  code: string;
  isHeadOffice: boolean;
}

export interface Limits {
  maxStudents: number | null;
  maxBranches: number | null;
  whatsappPerMonth: number | null;
  smsPerMonth: number | null;
  emailsPerMonth: number | null;
}

export type Usage = Record<Channel, { school: number; platform: number }>;

export interface SettingsOverview {
  school: { name: string; code: string; timezone: string };
  canEditSchool: boolean;
  branches: Branch[];
  subscription: {
    plan: { id: string; code: string; name: string } | null;
    status: 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled';
    trialEndsAt: string | null;
    trialDaysLeft: number | null;
    limits: Limits;
    managed: boolean;
  } | null;
  modules: { enabled: number; total: number };
  channels: Record<Channel, { module: boolean; inPlan: boolean; provider: string; enabled: boolean; verified: boolean; branchOverrides: number }>;
  usage: Usage;
  templates: { custom: number };
  rules: { automaticOn: number; automaticTotal: number };
  devices: { count: number; lastSeenAt: string | null };
}

export interface ModuleRow {
  key: ModuleKey;
  label: string;
  group: string;
  description: string;
  core: boolean;
  inPlan: boolean;
  enabled: boolean;
}
export interface ModulesData {
  canEdit: boolean;
  plan: { id: string; code: string; name: string } | null;
  version: number;
  modules: ModuleRow[];
}

// ------------------------------------------------------------------ sections

export interface AttendancePolicy {
  backdateDays: { teacher: number; branch_admin: number };
  blockTeachersOnHolidays: boolean;
  minPercentage: number;
  device: {
    checkInFrom: string;
    lateAfter: string;
    cutoff: string;
    autoAbsentAtCutoff: boolean;
    staffLateAfter: string;
    minGapMinutes: number;
  };
}
export interface CalendarValue {
  weeklyOffs: number[];
  holidays: Array<{ date: string; name: string }>;
}
export interface MessagingValue {
  displayName: string | null;
  replyToEmail: string | null;
  language: 'en' | 'hi';
}

export interface SectionData<T> {
  section: string;
  label: string;
  branchId: string | null;
  branchable: boolean;
  value: T;
  own: Partial<T> | null;
  inherited: T;
  version: number;
  updatedAt: string | null;
  canEdit: boolean;
  canEditSchool: boolean;
  branches: Branch[];
  defaults: T;
}

// ------------------------------------------------------------------ communication

export interface ChannelSettings {
  id: string;
  branchId: string | null;
  provider: string;
  config: Record<string, unknown>;
  secrets: Record<string, { set: boolean; last4: string }>;
  enabled: boolean;
  verifiedAt: string | null;
  verifyError: string | null;
  lastUsedAt: string | null;
  updatedAt: string;
  updatedBy: { name: string } | null;
}
export interface ProviderInfo {
  key: string;
  label: string;
  help: string;
  secrets: Array<{ key: string; label: string }>;
}
export interface ChannelInfo {
  label: string;
  module: boolean;
  inPlan: boolean;
  platformAvailable: boolean;
  providers: ProviderInfo[];
  school: ChannelSettings | null;
  branches: Array<{
    id: string;
    name: string;
    settings: ChannelSettings | null;
    effective: { source: 'branch' | 'school' | 'platform'; provider: string; enabled: boolean };
  }>;
  usage: { school: number; platform: number; platformLimit: number | null };
}
export interface CommunicationData {
  canEditSchool: boolean;
  encryptionReady: boolean;
  channels: Record<Channel, ChannelInfo>;
  warning?: string | null;
}

// ------------------------------------------------------------------ templates

export interface Template {
  body: string;
  subject?: string | null;
  name?: string | null;
  params?: string[];
  language?: string;
}
export interface SavedTemplate extends Template {
  id: string;
  approvalStatus: 'not_required' | 'draft' | 'pending' | 'approved' | 'rejected' | 'paused';
  approvalNote: string | null;
  submittedAt: string | null;
  syncedAt: string | null;
  updatedAt: string;
}
export interface TemplateEvent {
  key: EventKey;
  label: string;
  group: string;
  description: string;
  variables: string[];
  channels: Record<
    Channel,
    {
      default: Template;
      custom: SavedTemplate | null;
      applies: boolean;
      preview: { text?: string; subject?: string; variables?: string[] | Record<string, string> } | null;
    }
  >;
}
export interface TemplatesData {
  canEdit: boolean;
  ownProviders: Partial<Record<Channel, string>>;
  variables: Record<string, { label: string; sample: string }>;
  events: TemplateEvent[];
}

// ------------------------------------------------------------------ rules

export type Timing =
  | { mode: 'immediate' }
  | { mode: 'delay'; minutes: number }
  | { mode: 'at_time'; time: string }
  | { mode: 'scheduled'; time: string; daysBefore?: number; includeOverdue?: boolean; everyDays?: number; autoRun: boolean };

export interface Rule {
  enabled: boolean;
  channels: Channel[];
  audience: 'guardians' | 'primary_parent';
  timing: Timing;
}
export interface RuleRow {
  key: EventKey;
  label: string;
  group: string;
  description: string;
  alwaysOn: boolean;
  timingModes: Timing['mode'][];
  custom: boolean;
  rule: Rule;
  defaults: Rule;
  unavailableChannels: Channel[];
  updatedAt: string | null;
}
export interface RulesData {
  canEdit: boolean;
  channels: Array<{ key: Channel; available: boolean }>;
  rules: RuleRow[];
}

// ------------------------------------------------------------------ devices

export type DeviceKind = 'rfid' | 'biometric' | 'face' | 'qr' | 'gate_app';
export interface Device {
  id: string;
  branchId: string;
  branchName: string | null;
  name: string;
  kind: DeviceKind;
  kindLabel: string;
  protocol: 'http' | 'adms';
  serialNumber: string | null;
  keyPrefix: string | null;
  location: string | null;
  appliesTo: 'students' | 'staff' | 'both';
  status: 'active' | 'inactive' | 'suspended' | 'archived';
  lastSeenAt: string | null;
  lastIp: string | null;
  punchesToday: number;
  createdAt: string;
}
export interface Punch {
  id: string;
  identifier: string;
  kind: string;
  punchedAt: string;
  result: string;
  detail: string | null;
  device: string;
  person: { type: 'student' | 'staff'; name: string | null } | null;
}
export interface Identifier {
  id: string;
  kind: 'rfid' | 'biometric' | 'face' | 'qr';
  value: string;
  person: { type: 'student' | 'staff'; id: string; number: string; name: string };
}

// ------------------------------------------------------------------ audit

export interface AuditRow {
  id: string;
  area: string;
  action: string;
  summary: string;
  changes: Record<string, [unknown, unknown]> | null;
  branch: { id: string; name: string } | null;
  actor: { name: string; role: string } | null;
  createdAt: string;
}
