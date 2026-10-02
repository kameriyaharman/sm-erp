/**
 * Pure helpers for the school-operations modules (no database). Unit-tested in
 * test/school-ops.test.js.
 */

const round1 = (n) => Math.round((n + Number.EPSILON) * 10) / 10;

/**
 * Attendance summary from status counts. Every marked day is a working day.
 * percentage = (present + late + 0.5 * halfDay) / marked days * 100, one decimal (null if none).
 * Accepts half_day or halfDay.
 */
export function attendanceStats(counts = {}) {
  const present = Number(counts.present ?? 0);
  const absent = Number(counts.absent ?? 0);
  const late = Number(counts.late ?? 0);
  const leave = Number(counts.leave ?? 0);
  const halfDay = Number(counts.halfDay ?? counts.half_day ?? 0);
  const workingDays = present + absent + late + leave + halfDay;
  return {
    workingDays,
    present,
    absent,
    late,
    leave,
    halfDay,
    percentage: workingDays > 0 ? round1(((present + late + 0.5 * halfDay) * 100) / workingDays) : null,
  };
}

/**
 * Next code in an existing numbering pattern, e.g. admission numbers or employee codes.
 *   ['DPS-1001', 'DPS-1027']  -> 'DPS-1028'
 *   ['ADM/2024/009']          -> 'ADM/2024/010'   (zero padding kept)
 *   []                        -> fallback ('ADM-0001')
 * `existing` should be ordered newest first: the newest code's prefix wins when
 * a school has used more than one pattern over the years.
 */
export function nextSequenceCode(existing, fallback = 'ADM-0001') {
  const parsed = (existing ?? [])
    .map((code) => /^(.*?)(\d+)$/.exec(String(code ?? '').trim()))
    .filter(Boolean)
    .map(([, prefix, digits]) => ({ prefix, digits, n: Number(digits) }));
  if (parsed.length === 0) return fallback;

  const prefix = parsed[0].prefix;
  const same = parsed.filter((p) => p.prefix === prefix);
  const max = same.reduce((a, b) => (b.n > a.n ? b : a));
  const width = Math.max(...same.map((p) => p.digits.length));
  return `${prefix}${String(max.n + 1).padStart(width, '0')}`;
}

/** Next roll number in a section: highest numeric roll + 1 ("1" for an empty section). */
export function nextRollNumber(rolls) {
  const numbers = (rolls ?? []).map((r) => Number(String(r ?? '').replace(/\D/g, ''))).filter((n) => Number.isInteger(n) && n > 0);
  return String(numbers.length ? Math.max(...numbers) + 1 : 1);
}

/** "08:05" | "08:05:00" -> minutes since midnight */
export const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

/** Postgres time "08:05:00" -> "08:05" (null-safe). */
export const hhmm = (value) => (value == null ? null : String(value).slice(0, 5));

/**
 * Structural checks for a whole-week timetable (PUT /timetable).
 * periods: [{ weekday, periodNo, start, end, kind, subjectId? }]
 * Returns [] when valid, else [{ path: 'periods.3.end', message }].
 */
export function validateTimetable(periods) {
  const issues = [];
  const byDay = new Map();
  periods.forEach((p, index) => {
    const at = (field) => `periods.${index}.${field}`;
    if (toMinutes(p.end) <= toMinutes(p.start)) issues.push({ path: at('end'), message: 'End time must be after the start time' });
    if (p.kind === 'class' && !p.subjectId) issues.push({ path: at('subjectId'), message: 'A class period needs a subject' });
    if (!byDay.has(p.weekday)) byDay.set(p.weekday, []);
    byDay.get(p.weekday).push({ ...p, index });
  });

  for (const day of byDay.values()) {
    const seen = new Map();
    for (const p of day) {
      if (seen.has(p.periodNo)) {
        issues.push({ path: `periods.${p.index}.periodNo`, message: `Period ${p.periodNo} appears twice on the same day` });
      }
      seen.set(p.periodNo, p);
    }
    const sorted = [...day].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
    for (let i = 1; i < sorted.length; i += 1) {
      if (toMinutes(sorted[i].start) < toMinutes(sorted[i - 1].end)) {
        issues.push({ path: `periods.${sorted[i].index}.start`, message: `Overlaps period ${sorted[i - 1].periodNo}` });
      }
    }
  }
  return issues;
}

/** Two time ranges on the same day overlap (touching ends do not). */
export const overlaps = (a, b) => toMinutes(a.start) < toMinutes(b.end) && toMinutes(b.start) < toMinutes(a.end);

/** Keys "1".."6" (Mon..Sat), always present. */
export function emptyWeek() {
  return { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
}

/** "2026-09" -> { from: '2026-09-01', to: '2026-09-30' } */
export function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** Months from `startIso` to `endIso` inclusive, as 'YYYY-MM', oldest first. */
export function monthsBetween(startIso, endIso) {
  let [y, m] = startIso.slice(0, 7).split('-').map(Number);
  const [ey, em] = endIso.slice(0, 7).split('-').map(Number);
  const out = [];
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** "Rakesh Kumar Sharma" -> { firstName: 'Rakesh Kumar', lastName: 'Sharma' }; one word -> lastName null. */
export function splitName(full) {
  const parts = String(full ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? '', lastName: null };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1) };
}

/** Escapes LIKE wildcards in user search text and wraps it in %...%. */
export const likePattern = (search) => (search ? `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null);
