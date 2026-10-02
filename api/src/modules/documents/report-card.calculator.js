/**
 * Pure report-card maths: no database, no PDF. Everything here is unit-tested.
 *
 * Marks are scaled per CBSE component weight, summed into a term total out of 100,
 * graded on the 8-point scale, then rolled up into an annual result and ranked.
 *
 * Reference: CBSE Circular Acad-14/2017 (classes VI–VIII): each term =
 * Periodic Test 10 + Notebook 5 + Subject Enrichment 5 + Half-Yearly/Yearly exam 80;
 * grades A1 91–100 … E 32 & below; co-scholastic and discipline on A/B/C.
 */

// ---------------------------------------------------------------- schemes

/**
 * A scheme says which exam components make a term and how much each weighs.
 * `combine: 'average_best'` with `bestOf: 2` = average of the best two periodic tests.
 * Weights are a school setting: change them here, not in the renderer.
 */
export const SCHEMES = Object.freeze({
  cbse_6_8: {
    code: 'cbse_6_8',
    label: 'CBSE Classes VI–VIII (two terms)',
    termsPerYear: 2,
    passPercentage: 33,
    components: [
      { code: 'PT', label: 'Periodic Test', short: 'PT', weight: 10, combine: 'average_best', bestOf: 2 },
      { code: 'NB', label: 'Notebook', short: 'NB', weight: 5, combine: 'average' },
      { code: 'SEA', label: 'Subject Enrichment', short: 'SEA', weight: 5, combine: 'average' },
      { code: 'TERM', label: 'Half-Yearly / Yearly Exam', short: 'Exam', weight: 80, combine: 'latest' },
    ],
  },
  cbse_9_10: {
    code: 'cbse_9_10',
    label: 'CBSE Classes IX–X (annual, 20 internal + 80 exam)',
    termsPerYear: 1,
    passPercentage: 33,
    components: [
      { code: 'PT', label: 'Periodic Tests', short: 'PT', weight: 5, combine: 'average_best', bestOf: 2 },
      { code: 'MA', label: 'Multiple Assessment', short: 'MA', weight: 5, combine: 'average' },
      { code: 'PF', label: 'Portfolio', short: 'PF', weight: 5, combine: 'average' },
      { code: 'SEA', label: 'Subject Enrichment', short: 'SEA', weight: 5, combine: 'average' },
      { code: 'TERM', label: 'Annual Exam', short: 'Exam', weight: 80, combine: 'latest' },
    ],
  },
});

/** CBSE 8-point scale (lower bounds on a percentage rounded to a whole number). */
export const CBSE_GRADE_SCALE = Object.freeze([
  { grade: 'A1', min: 91, gradePoint: 10, passing: true },
  { grade: 'A2', min: 81, gradePoint: 9, passing: true },
  { grade: 'B1', min: 71, gradePoint: 8, passing: true },
  { grade: 'B2', min: 61, gradePoint: 7, passing: true },
  { grade: 'C1', min: 51, gradePoint: 6, passing: true },
  { grade: 'C2', min: 41, gradePoint: 5, passing: true },
  { grade: 'D', min: 33, gradePoint: 4, passing: true },
  { grade: 'E', min: 0, gradePoint: null, passing: false, description: 'Needs improvement' },
]);

export const CO_SCHOLASTIC_GRADES = Object.freeze({ A: 'Outstanding', B: 'Very Good', C: 'Fair' });

/** Subject code used for the Discipline row (graded-only subject). */
export const DISCIPLINE_CODE = 'DISC';

// ---------------------------------------------------------------- helpers

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const roundHalfUp = (n) => Math.floor(n + 0.5 + 1e-9);

/** Pick a scheme by class level when the branch hasn't set one. */
export function schemeForClassLevel(numericLevel) {
  return numericLevel != null && numericLevel >= 9 ? SCHEMES.cbse_9_10 : SCHEMES.cbse_6_8;
}

/**
 * Percentage -> grade row. `scale` rows need { grade, min } (min = lowest whole percentage).
 * The percentage is rounded half-up first, so 90.5 is an A1 and 32.49 is an E.
 */
export function gradeFor(percentage, scale = CBSE_GRADE_SCALE) {
  if (percentage == null || Number.isNaN(percentage)) return null;
  const whole = roundHalfUp(percentage);
  const sorted = [...scale].sort((a, b) => b.min - a.min);
  return sorted.find((row) => whole >= row.min) ?? sorted.at(-1);
}

/**
 * One component (e.g. PT) of one subject in one term.
 * entries: [{ marksObtained, maxMarks, isAbsent, isExempted, examDate }]
 * Returns { score, max, entries } or null when nothing was held / everything exempted.
 * Absent counts as zero; exempted entries are left out.
 */
export function scoreComponent(component, entries) {
  const usable = entries.filter((e) => !e.isExempted);
  if (usable.length === 0) return null;

  const fractions = usable.map((e) => (e.isAbsent || e.marksObtained == null ? 0 : Number(e.marksObtained) / Number(e.maxMarks)));
  let fraction;
  switch (component.combine) {
    case 'average_best': {
      const best = [...fractions].sort((a, b) => b - a).slice(0, component.bestOf ?? fractions.length);
      fraction = best.reduce((s, f) => s + f, 0) / best.length;
      break;
    }
    case 'latest': {
      const latest = usable
        .map((e, i) => ({ date: e.examDate ?? '', i }))
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.i - a.i))[0];
      fraction = fractions[latest.i];
      break;
    }
    default:
      fraction = fractions.reduce((s, f) => s + f, 0) / fractions.length;
  }
  return { score: round2(fraction * component.weight), max: component.weight, entries: usable.length };
}

// ---------------------------------------------------------------- one student

/**
 * @param {object} input
 * @param {object} input.scheme                  one of SCHEMES
 * @param {Array<{id,name,sequenceNo}>} input.terms   terms included, in order
 * @param {Array<{id,name,code,isGradedOnly,displayOrder}>} input.subjects
 * @param {Array<{subjectId,termId,component,marksObtained,maxMarks,isAbsent,isExempted,grade,examDate}>} input.marks
 * @param {Array} [input.gradeScale]
 */
export function computeStudentResult({ scheme, terms, subjects, marks, gradeScale = CBSE_GRADE_SCALE }) {
  const termIds = terms.map((t) => t.id);
  const bySubject = new Map();
  for (const m of marks) {
    if (!bySubject.has(m.subjectId)) bySubject.set(m.subjectId, []);
    bySubject.get(m.subjectId).push(m);
  }

  const scholastic = [];
  const coScholastic = [];
  let discipline = null;
  const missing = [];

  const ordered = [...subjects].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.name.localeCompare(b.name));

  for (const subject of ordered) {
    const rows = bySubject.get(subject.id) ?? [];

    if (subject.isGradedOnly) {
      // Co-scholastic / discipline: the last grade given in each term.
      const grades = {};
      for (const termId of termIds) {
        const inTerm = rows.filter((r) => r.termId === termId && r.grade).sort((a, b) => String(a.examDate).localeCompare(String(b.examDate)));
        grades[termId] = inTerm.at(-1)?.grade?.toUpperCase() ?? null;
      }
      const row = { subjectId: subject.id, name: subject.name, code: subject.code, grades };
      if (subject.code?.toUpperCase() === DISCIPLINE_CODE) discipline = row;
      else coScholastic.push(row);
      continue;
    }

    if (rows.length === 0) continue; // subject not taken by / not examined for this student

    const termResults = {};
    let obtained = 0;
    let max = 0;
    for (const termId of termIds) {
      const components = {};
      let tObtained = 0;
      let tMax = 0;
      for (const component of scheme.components) {
        const scored = scoreComponent(component, rows.filter((r) => r.termId === termId && r.component === component.code));
        components[component.code] = scored;
        if (scored) {
          tObtained += scored.score;
          tMax += scored.max;
        }
      }
      if (!components.TERM) missing.push({ subject: subject.name, termId });
      const percentage = tMax > 0 ? round2((tObtained * 100) / tMax) : null;
      termResults[termId] = {
        components,
        obtained: tMax > 0 ? round2(tObtained) : null,
        max: tMax,
        percentage,
        grade: gradeFor(percentage, gradeScale)?.grade ?? null,
      };
      obtained += tObtained;
      max += tMax;
    }

    const percentage = max > 0 ? round2((obtained * 100) / max) : null;
    const grade = gradeFor(percentage, gradeScale);
    scholastic.push({
      subjectId: subject.id,
      name: subject.name,
      code: subject.code,
      terms: termResults,
      obtained: round2(obtained),
      max,
      percentage,
      grade: grade?.grade ?? null,
      passed: percentage != null && percentage >= scheme.passPercentage,
    });
  }

  const totalObtained = round2(scholastic.reduce((s, r) => s + r.obtained, 0));
  const totalMax = scholastic.reduce((s, r) => s + r.max, 0);
  const percentage = totalMax > 0 ? round2((totalObtained * 100) / totalMax) : null;
  const overall = gradeFor(percentage, gradeScale);

  return {
    scholastic,
    coScholastic,
    discipline,
    totals: {
      obtained: totalObtained,
      max: totalMax,
      percentage,
      grade: overall?.grade ?? null,
      gradePoint: overall?.gradePoint ?? null,
    },
    failedSubjects: scholastic.filter((s) => !s.passed).map((s) => s.name),
    complete: missing.length === 0 && scholastic.length > 0,
    missing,
  };
}

// ---------------------------------------------------------------- class-level

/**
 * Standard competition ranking ("1224"): equal percentages share a rank, the next
 * rank skips. Students without a complete result get no rank.
 * items: [{ key, percentage, complete }] -> Map(key -> rank|null)
 */
export function rankByPercentage(items) {
  const eligible = items.filter((i) => i.complete && i.percentage != null).sort((a, b) => b.percentage - a.percentage);
  const ranks = new Map(items.map((i) => [i.key, null]));
  let previous = null;
  let rank = 0;
  eligible.forEach((item, index) => {
    if (previous === null || item.percentage < previous) rank = index + 1;
    ranks.set(item.key, rank);
    previous = item.percentage;
  });
  return ranks;
}

/**
 * Attendance from daily statuses. Present, late and half-day count as days attended;
 * absent and leave do not. Every marked day is a working day.
 * counts: { present, late, half_day, absent, leave }
 */
export function attendanceSummary(counts = {}) {
  const attended = (counts.present ?? 0) + (counts.late ?? 0) + (counts.half_day ?? 0);
  const working = attended + (counts.absent ?? 0) + (counts.leave ?? 0);
  return { working, attended, percentage: working > 0 ? round2((attended * 100) / working) : null };
}

/**
 * Suggested result for the final report card. A school can override it (report_cards.result).
 * Not final (term report) or incomplete -> 'pending'.
 */
export function suggestResult({ isFinal, complete, failedSubjects }) {
  if (!isFinal || !complete) return 'pending';
  return failedSubjects.length === 0 ? 'promoted' : 'detained';
}
