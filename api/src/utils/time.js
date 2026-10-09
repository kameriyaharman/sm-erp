/**
 * Small time-zone helpers (schools run on their own clock: tenants.timezone, usually Asia/Kolkata).
 * No dependencies: Intl does the zone maths.
 */

function parts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });
  return Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
}

/** Offset of `timeZone` from UTC at `date`, in ms (IST = +19 800 000). */
export function zoneOffsetMs(date, timeZone) {
  const v = parts(date, timeZone);
  const asUtc = Date.UTC(Number(v.year), Number(v.month) - 1, Number(v.day), Number(v.hour) % 24, Number(v.minute), Number(v.second));
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Wall-clock date + "HH:MM" in a zone -> the UTC instant. */
export function zonedToUtc(dateIso, hhmm, timeZone) {
  const [y, m, d] = dateIso.split('-').map(Number);
  const [H, M] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, H, M);
  const first = guess - zoneOffsetMs(new Date(guess), timeZone);
  // Second pass settles DST edges (not needed for India, but schools elsewhere exist).
  return new Date(guess - zoneOffsetMs(new Date(first), timeZone));
}

/** { date: 'YYYY-MM-DD', time: 'HH:MM', weekday: 0-6 } of an instant in a zone. */
export function localParts(instant, timeZone) {
  const v = parts(instant instanceof Date ? instant : new Date(instant), timeZone);
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(v.weekday);
  return { date: `${v.year}-${v.month}-${v.day}`, time: `${String(Number(v.hour) % 24).padStart(2, '0')}:${v.minute}`, weekday };
}

/** A valid IANA zone, or the fallback. */
export function safeZone(timeZone, fallback = 'Asia/Kolkata') {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return fallback;
  }
}

/**
 * When a queued message should go out, per the rule's timing:
 *   immediate        -> now
 *   delay N minutes  -> now + N
 *   at_time HH:MM    -> that time today (school's zone); now if it has passed
 */
export function sendAtFor(timing, { now = new Date(), timeZone = 'Asia/Kolkata', date } = {}) {
  if (!timing || timing.mode === 'immediate') return now;
  if (timing.mode === 'delay') return new Date(now.getTime() + Math.max(0, Number(timing.minutes) || 0) * 60_000);
  if (timing.mode === 'at_time' && /^\d{2}:\d{2}$/.test(timing.time ?? '')) {
    const day = date ?? localParts(now, timeZone).date;
    const at = zonedToUtc(day, timing.time, timeZone);
    return at > now ? at : now;
  }
  return now;
}
