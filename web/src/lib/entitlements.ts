'use client';

/**
 * What the signed-in user's school has (plan, modules). Drives which menu items show; the API
 * enforces the same rules (403 MODULE_DISABLED). Fetched once per tab; `refreshEntitlements()`
 * after the Modules screen changes something.
 */

import { useEffect, useState } from 'react';
import { apiGet, currentUser } from './session';

export type ModuleKey =
  | 'students' | 'staff' | 'attendance' | 'fees'
  | 'exams' | 'report_cards' | 'timetable' | 'homework'
  | 'certificates' | 'notices' | 'transport' | 'device_attendance'
  | 'online_payments' | 'accounts' | 'expenses'
  | 'parent_portal' | 'whatsapp' | 'sms' | 'email';

export interface Entitlements {
  platform: boolean;
  plan: { id: string; code: string; name: string } | null;
  status: 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled';
  trialDaysLeft: number | null;
  modules: ModuleKey[];
}

let cache: { userId: string; promise: Promise<Entitlements> } | null = null;
const listeners = new Set<(e: Entitlements) => void>();

function load(force = false): Promise<Entitlements> {
  const userId = currentUser()?.id ?? '';
  if (!cache || cache.userId !== userId || force) {
    const promise = apiGet<{ data: Entitlements }>('/school/entitlements').then((r) => r.data);
    promise.then((e) => listeners.forEach((fn) => fn(e))).catch(() => {
      if (cache?.promise === promise) cache = null;
    });
    cache = { userId, promise };
  }
  return cache.promise;
}

export function refreshEntitlements(): Promise<Entitlements> {
  return load(true);
}

/** Entitlements, or null while loading (callers show everything until then: the API still guards). */
export function useEntitlements(): Entitlements | null {
  const [value, setValue] = useState<Entitlements | null>(null);
  useEffect(() => {
    let alive = true;
    load()
      .then((e) => alive && setValue(e))
      .catch(() => undefined);
    const on = (e: Entitlements) => alive && setValue(e);
    listeners.add(on);
    return () => {
      alive = false;
      listeners.delete(on);
    };
  }, []);
  return value;
}

export function hasModule(e: Entitlements | null, key: ModuleKey | undefined): boolean {
  if (!key || !e) return true;
  return e.modules.includes(key);
}
