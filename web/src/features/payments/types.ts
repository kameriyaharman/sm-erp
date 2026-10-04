/** API shapes for online payments and portal logins (docs/api-v2-contract.md section 13). */

export type GatewayMode = 'test' | 'live';

export interface GatewaySettings {
  id: string;
  branchId: string | null;
  provider: 'razorpay';
  keyId: string;
  mode: GatewayMode;
  keySecretSet: boolean;
  keySecretLast4: string;
  webhookSecretSet: boolean;
  webhookSecretLast4: string;
  enabled: boolean;
  allowPartial: boolean;
  minAmount: string;
  verifiedAt: string | null;
  verifyError: string | null;
  lastWebhookAt: string | null;
  updatedAt: string;
  updatedBy: { name: string } | null;
}

export interface PaymentSettingsData {
  schoolCode: string;
  schoolName: string;
  webhook: { url: string; events: string[] };
  canEditSchool: boolean;
  testKeysAllowed: boolean;
  encryptionReady: boolean;
  platform: { configured: boolean; mode: GatewayMode | null };
  school: GatewaySettings | null;
  branches: Array<{
    id: string;
    name: string;
    code: string;
    isHeadOffice: boolean;
    settings: GatewaySettings | null;
    effective: { source: 'branch' | 'school' | 'platform' | 'none'; enabled: boolean; mode: GatewayMode | null };
  }>;
  warning?: string | null;
}

export interface TestResult {
  ok: boolean;
  reason: 'invalid_keys' | 'gateway_error' | 'unreadable' | null;
  message: string;
  mode: GatewayMode;
  verifiedAt: string | null;
}

export type OnlineStatus = 'created' | 'paid' | 'failed' | 'expired' | 'needs_review';

export interface OnlinePaymentRow {
  id: string;
  status: OnlineStatus;
  amount: string;
  currency: string;
  mode: GatewayMode | null;
  createdAt: string;
  paidAt: string | null;
  expiresAt: string;
  gatewayOrderId: string;
  gatewayPaymentId: string | null;
  isDemo: boolean;
  receipt: { id: string; number: string; amount: string; status?: 'active' | 'cancelled'; cancelledAt?: string | null; cancelReason?: string | null } | null;
  /** The office cancelled this payment's receipt: the money stays at Razorpay until refunded there. */
  refundAtGateway?: { amount: string; paymentId: string | null } | null;
  reason: string | null;
  student: { id: string; name: string; admissionNumber: string; classLabel: string };
  branch: { id: string; name: string };
  paidBy: { name: string; role: string } | null;
}

export interface OnlinePaymentDetail extends OnlinePaymentRow {
  reviewReason: string | null;
  failureReason: string | null;
  items: Array<{ invoiceId: string; invoiceNumber: string; periodLabel: string | null; amount: string; invoiceStatus: string; invoiceBalance: string }>;
  events: Array<{ type: string; source: 'webhook' | 'reconcile'; outcome: string; detail: string | null; paymentId: string | null; method: string | null; at: string }>;
  canReconcile: boolean;
}

export interface OnlineSummary {
  today: { amount: string; count: number };
  month: { amount: string; count: number };
  failedThisMonth: number;
  needsReview: number;
  inProgress: number;
  gateway: { source: 'branch' | 'school' | 'platform' | 'none'; enabled: boolean; mode: GatewayMode | null };
}

export interface ReconcileResult {
  outcome: string;
  message: string;
  settled: Array<{ paymentId: string; outcome: string; receiptId: string | null }>;
  order: OnlinePaymentDetail;
}

// ------------------------------------------------------------------ portal logins

export type LoginStatus = 'none' | 'temporary' | 'active' | 'locked' | 'inactive';

export interface PortalRow {
  userId: string;
  type: 'parent' | 'student';
  name: string;
  loginId: string | null;
  status: LoginStatus;
  lastLoginAt: string | null;
  passwordSetAt: string | null;
  student?: { id: string; admissionNumber: string; username: string | null; classLabel: string; branchName: string };
  phone?: string | null;
  email?: string | null;
  children?: Array<{ id: string; name: string; admissionNumber: string; classLabel: string }>;
}

export interface PortalMeta {
  schoolCode: string | null;
  schoolName: string | null;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  counts: Record<LoginStatus, number>;
}

export interface LoginSlip {
  userId: string;
  type: 'parent' | 'student';
  name: string;
  loginId: string;
  alsoWorks: string[];
  classLabel: string | null;
  children?: Array<{ name: string; classLabel: string; admissionNumber: string }>;
  password: string | null;
}

export interface ResetResult {
  schoolCode: string;
  schoolName: string;
  portalUrl: string;
  mustChangePassword: boolean;
  slip: LoginSlip;
}

export interface BulkResult {
  schoolCode: string;
  schoolName: string;
  portalUrl: string;
  classLabel: string;
  issued: number;
  skipped: number;
  slips: LoginSlip[];
}
