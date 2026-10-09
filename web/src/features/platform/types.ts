import type { ModuleKey } from '@/lib/entitlements';
import type { Limits, Usage } from '@/features/settings/types';

export type SubStatus = 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled';

export interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  modules: ModuleKey[];
  limits: Limits;
  priceMonthly: string | null;
  priceYearly: string | null;
  priceNote: string | null;
  isActive: boolean;
  sortOrder: number;
  schools: number;
  updatedAt: string;
}

export interface ModuleDef {
  key: ModuleKey;
  label: string;
  group: string;
  core?: boolean;
  description: string;
}

export interface TenantRow {
  id: string;
  name: string;
  code: string;
  status: 'active' | 'inactive' | 'suspended' | 'archived';
  contactEmail: string | null;
  contactPhone: string | null;
  plan: { id: string; name: string; code: string } | null;
  subscriptionStatus: SubStatus | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  branches: number;
  students: number;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface TenantDetail {
  id: string;
  name: string;
  code: string;
  legalName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  timezone: string;
  status: TenantRow['status'];
  createdAt: string;
  subscription: {
    planId: string;
    status: SubStatus;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    moduleOverrides: Partial<Record<ModuleKey, boolean>>;
    limitOverrides: Partial<Limits>;
    notes: string | null;
  } | null;
  entitlements: { modules: ModuleKey[]; availableModules: ModuleKey[]; limits: Limits; plan: { name: string } | null } | null;
  usage: Usage;
  students: number;
  branches: Array<{ id: string; name: string; code: string; city: string | null; state: string | null; isHeadOffice: boolean; status: string }>;
  admins: Array<{ id: string; name: string; email: string | null; phone: string | null; role: string; lastLoginAt: string | null; mustChangePassword: boolean }>;
}

export interface PlatformOverview {
  schools: { active: number; inactive: number; trial: number };
  students: number;
  plans: Array<{ code: string; name: string; schools: number }>;
  trialsEnding: Array<{ id: string; name: string; code: string; trialEndsAt: string }>;
  messagesThisMonth: Array<{ channel: string; account: string; sent: number }>;
}
