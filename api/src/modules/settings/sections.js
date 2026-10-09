import { z } from 'zod';
import { CORE_MODULES, OPTIONAL_MODULES } from '../../config/modules.js';

/**
 * Typed settings sections stored in tenant_settings. Each section has:
 *   schema     zod schema of the FULL value (what the settings screen saves)
 *   defaults   used when the school never saved the section
 *   branchable true = a branch may override the school-wide value (attendance timings differ per campus)
 *
 * Reading merges: defaults <- school row <- branch row (objects deep-merged, arrays replaced).
 */

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time, e.g. 08:15');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD').refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date');

const attendance = z
  .object({
    // How many days back each role may record or change the register (teacher: 0 = today only).
    backdateDays: z.object({ teacher: z.number().int().min(0).max(7), branch_admin: z.number().int().min(0).max(90) }).strict(),
    // Teachers cannot mark on a holiday or weekly off (admins still can, e.g. a working Saturday).
    blockTeachersOnHolidays: z.boolean(),
    // Below this, a student's attendance shows in red and on the low-attendance list.
    minPercentage: z.number().int().min(0).max(100),
    // Gate devices (RFID / biometric / face / QR).
    device: z
      .object({
        checkInFrom: hhmm,        // punches before this are ignored (night guard testing cards...)
        lateAfter: hhmm,          // students punching after this are marked late
        cutoff: hhmm,             // after this, morning punches no longer count as arrival
        autoAbsentAtCutoff: z.boolean(), // at the cut-off, students with no punch are marked absent (registers not yet taken)
        staffLateAfter: hhmm,
        minGapMinutes: z.number().int().min(1).max(240), // a second staff punch within this gap is ignored; later = check-out
      })
      .strict(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const d = v.device;
    if (!(d.checkInFrom < d.lateAfter && d.lateAfter <= d.cutoff)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['device', 'lateAfter'], message: 'Times must be in order: check-in opens < late after <= cut-off' });
    }
  });

const calendar = z
  .object({
    weeklyOffs: z.array(z.number().int().min(0).max(6)).max(7).refine((a) => new Set(a).size === a.length, 'Each day once'), // 0 = Sunday
    holidays: z
      .array(z.object({ date: isoDate, name: z.string().trim().min(1).max(80) }).strict())
      .max(366)
      .refine((a) => new Set(a.map((h) => h.date)).size === a.length, 'Each date once'),
  })
  .strict();

const messaging = z
  .object({
    // Name used in messages instead of "School, Branch" (e.g. "DPS Dwarka"). Keep it short for SMS.
    displayName: z.string().trim().max(60).nullable(),
    replyToEmail: z.string().trim().email().max(150).nullable(),
    // Language of templates the school adds (WhatsApp templates are approved per language).
    language: z.enum(['en', 'hi']),
  })
  .strict();

const modules = z
  .object({
    // Optional modules the school switched off (within what its plan includes).
    disabled: z.array(z.enum(OPTIONAL_MODULES)).max(OPTIONAL_MODULES.length),
  })
  .strict();

export const SECTIONS = Object.freeze({
  attendance: {
    label: 'Attendance policy',
    branchable: true,
    schema: attendance,
    defaults: {
      backdateDays: { teacher: 1, branch_admin: 30 },
      blockTeachersOnHolidays: true,
      minPercentage: 75,
      device: { checkInFrom: '06:00', lateAfter: '08:15', cutoff: '10:00', autoAbsentAtCutoff: false, staffLateAfter: '08:00', minGapMinutes: 10 },
    },
  },
  calendar: {
    label: 'Holidays and weekly offs',
    branchable: true,
    schema: calendar,
    defaults: { weeklyOffs: [0], holidays: [] },
  },
  messaging: {
    label: 'Messaging preferences',
    branchable: false,
    schema: messaging,
    defaults: { displayName: null, replyToEmail: null, language: 'en' },
  },
  modules: {
    label: 'Modules',
    branchable: false,
    schema: modules,
    defaults: { disabled: [] },
  },
});

export const SECTION_KEYS = Object.freeze(Object.keys(SECTIONS));

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Deep merge for settings: objects merge, arrays and scalars replace. */
export function mergeSettings(...layers) {
  const out = {};
  for (const layer of layers) {
    if (!isPlainObject(layer)) continue;
    for (const [k, v] of Object.entries(layer)) {
      out[k] = isPlainObject(v) && isPlainObject(out[k]) ? mergeSettings(out[k], v) : structuredClone(v);
    }
  }
  return out;
}

/**
 * Effective value: defaults <- school <- branch. Values saved by an older version of the app
 * may miss newer keys; the defaults fill them, and anything that no longer validates falls back
 * to the defaults rather than breaking the screens that read it.
 */
export function resolveSection(section, schoolValue, branchValue) {
  const def = SECTIONS[section];
  if (!def) throw new Error(`Unknown settings section ${section}`);
  const merged = mergeSettings(def.defaults, schoolValue ?? {}, def.branchable ? branchValue ?? {} : {});
  const parsed = def.schema.safeParse(merged);
  return parsed.success ? parsed.data : structuredClone(def.defaults);
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Is a date a holiday or weekly off?
 * @returns {{ name: string, weeklyOff: boolean, reason: string } | null}
 */
export function dayOff(calendarValue, isoDay) {
  const hit = calendarValue?.holidays?.find((h) => h.date === isoDay);
  if (hit) return { name: hit.name, weeklyOff: false, reason: `${hit.name} is a school holiday` };
  const [y, m, d] = isoDay.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (calendarValue?.weeklyOffs?.includes(weekday)) return { name: DAY_NAMES[weekday], weeklyOff: true, reason: `${DAY_NAMES[weekday]} is a weekly off` };
  return null;
}

export { CORE_MODULES };
