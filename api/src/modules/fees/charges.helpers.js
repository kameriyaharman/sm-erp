/** Pure helpers of one-off charges (charges.service.js); unit-tested without a database. */

/**
 * Who gets billed. Pure: `students` are the targets, `alreadyBilled` the student ids that
 * already have an invoice from this batch.
 * @returns {{ toBill: object[], skipped: number, total: number }}  total in paise
 */
export function planCharge({ students, alreadyBilled = [], amount }) {
  const done = new Set(alreadyBilled);
  const toBill = students.filter((s) => !done.has(s.id));
  return { toBill, skipped: students.length - toBill.length, total: toBill.length * amount };
}
