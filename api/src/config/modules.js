/**
 * SaaS module catalog: the features a school can have, how they are grouped on the plans
 * screen, and which ones every school always gets.
 *
 * A school's effective modules =
 *   CORE  ∪  ((plan.modules ∪ granted overrides) − revoked overrides)  − modules the school switched off
 *
 * Keys are stored in plans.modules, tenant_subscriptions.module_overrides and the school's
 * own "modules" settings, so never rename one: add a new key and migrate the data instead.
 */

export const MODULES = Object.freeze([
  // ---- always on
  { key: 'students', label: 'Students & admissions', group: 'Core', core: true, description: 'Student records, admissions, guardians, ID numbers.' },
  { key: 'staff', label: 'Staff', group: 'Core', core: true, description: 'Staff records and teacher logins.' },
  { key: 'attendance', label: 'Attendance', group: 'Core', core: true, description: 'Daily class register marked by the class teacher.' },
  { key: 'fees', label: 'Fee collection', group: 'Core', core: true, description: 'Fee structure, invoices, counter receipts, defaulters.' },

  // ---- academics
  { key: 'exams', label: 'Exams & marks', group: 'Academics', description: 'Exam schedules, papers and marks entry.' },
  { key: 'report_cards', label: 'Report cards', group: 'Academics', description: 'CBSE-style report cards with QR verification.' },
  { key: 'timetable', label: 'Timetable', group: 'Academics', description: 'Class and teacher timetables.' },
  { key: 'homework', label: 'Homework', group: 'Academics', description: 'Homework with attachments for each section.' },

  // ---- office
  { key: 'certificates', label: 'Certificates', group: 'Office', description: 'Transfer and bonafide certificates.' },
  { key: 'notices', label: 'Notices', group: 'Office', description: 'Notice board for parents and staff.' },
  { key: 'transport', label: 'Transport', group: 'Office', description: 'Routes, stops and riders.' },
  { key: 'device_attendance', label: 'Device attendance', group: 'Office', description: 'RFID, biometric, face and QR attendance from devices at the gate.' },

  // ---- finance
  { key: 'online_payments', label: 'Online fee payment', group: 'Finance', description: "Parents pay from the portal into the school's Razorpay account." },
  { key: 'accounts', label: 'Day book & ledger', group: 'Finance', description: 'Cash and bank day book, ledger accounts.' },
  { key: 'expenses', label: 'Expenses', group: 'Finance', description: 'Expense vouchers and categories.' },

  // ---- communication
  { key: 'parent_portal', label: 'Parent & student portal', group: 'Communication', description: 'Parent app: attendance, fees, homework, report cards.' },
  { key: 'whatsapp', label: 'WhatsApp messages', group: 'Communication', description: 'Alerts and notices on WhatsApp.' },
  { key: 'sms', label: 'SMS', group: 'Communication', description: 'Alerts and notices by SMS (DLT templates).' },
  { key: 'email', label: 'Email', group: 'Communication', description: 'Alerts, receipts and notices by email.' },
]);

export const MODULE_KEYS = Object.freeze(MODULES.map((m) => m.key));
export const CORE_MODULES = Object.freeze(MODULES.filter((m) => m.core).map((m) => m.key));
export const OPTIONAL_MODULES = Object.freeze(MODULES.filter((m) => !m.core).map((m) => m.key));

/** Message channels are modules too: a channel the school doesn't have is never used. */
export const CHANNEL_MODULE = Object.freeze({ whatsapp: 'whatsapp', sms: 'sms', email: 'email' });

/**
 * Plan limits. null = unlimited. Message limits apply to messages sent through the SM ERP
 * platform account; a school that connects its own WhatsApp / SMS / email account pays its
 * provider directly and is not counted.
 */
export const LIMIT_KEYS = Object.freeze(['maxStudents', 'maxBranches', 'whatsappPerMonth', 'smsPerMonth', 'emailsPerMonth']);
export const LIMIT_FOR_CHANNEL = Object.freeze({ whatsapp: 'whatsappPerMonth', sms: 'smsPerMonth', email: 'emailsPerMonth' });

/**
 * Effective modules for a school. Pure, so it can be tested and reused by the web preview.
 * @param {object} p
 * @param {string[]} p.planModules
 * @param {Record<string, boolean>} [p.overrides]   platform admin: true = grant, false = revoke
 * @param {string[]} [p.schoolDisabled]             modules the school itself switched off
 * @returns {{ enabled: string[], available: string[] }}  available = what the plan allows
 */
export function effectiveModules({ planModules = [], overrides = {}, schoolDisabled = [] }) {
  const available = new Set([...CORE_MODULES, ...planModules.filter((k) => MODULE_KEYS.includes(k))]);
  for (const [key, on] of Object.entries(overrides ?? {})) {
    if (!MODULE_KEYS.includes(key) || CORE_MODULES.includes(key)) continue;
    if (on === true) available.add(key);
    else if (on === false) available.delete(key);
  }
  const off = new Set((schoolDisabled ?? []).filter((k) => !CORE_MODULES.includes(k)));
  const enabled = [...available].filter((k) => !off.has(k));
  const order = (k) => MODULE_KEYS.indexOf(k);
  return { enabled: enabled.sort((a, b) => order(a) - order(b)), available: [...available].sort((a, b) => order(a) - order(b)) };
}

/** Plan limits with the platform admin's per-school overrides on top (undefined = keep the plan's). */
export function effectiveLimits(planLimits = {}, overrides = {}) {
  const out = {};
  for (const key of LIMIT_KEYS) {
    const o = overrides?.[key];
    out[key] = o !== undefined ? o : planLimits?.[key] ?? null;
  }
  return out;
}
