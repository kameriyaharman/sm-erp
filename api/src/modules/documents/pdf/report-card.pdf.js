import {
  COLORS, box, createDocument, drawFieldGrid, drawLetterhead, drawSignatures, drawTable, drawTitle, drawWatermark, qrPng, stampFooters,
} from './kit.js';
import { CBSE_GRADE_SCALE, CO_SCHOLASTIC_GRADES, gradeFor } from '../report-card.calculator.js';
import { formatDate } from './words.js';

/**
 * CBSE-style report card (A4 portrait), rendered from a report-card snapshot:
 *   Part 1 Scholastic areas — per term: components (PT/NB/SEA/Exam), total, grade; overall
 *   Part 2 Co-scholastic areas and Discipline (A/B/C, term-wise)
 *   Summary — overall %, grade, rank, attendance, result; remarks; grading key; signatures
 *
 * @param {object} rc       snapshot built by documents.service (see buildReportCardSnapshot)
 * @param {Writable} out    HTTP response or file stream
 * @param {{ verifyBaseUrl?: string }} options
 */
export async function renderReportCard(rc, out, { verifyBaseUrl } = {}) {
  const published = rc.status === 'published';
  const verifyUrl = published && rc.verificationCode && verifyBaseUrl ? `${verifyBaseUrl}/${rc.verificationCode}` : null;
  const qr = verifyUrl ? await qrPng(verifyUrl) : null;

  const doc = createDocument({ title: `${rc.title} - ${rc.student.name}`, author: rc.school.name, subject: `Report card ${rc.session}` });
  doc.pipe(out);

  const watermark = () => {
    if (!published) drawWatermark(doc, 'DRAFT');
    else if (rc.result === 'withheld') drawWatermark(doc, 'WITHHELD', { color: COLORS.fail });
  };
  watermark();

  // ---------------------------------------------------------------- header + student
  let y = drawLetterhead(doc, rc.school);
  y = drawTitle(doc, y, rc.title, `Academic Session ${rc.session}${rc.scheme?.label ? `  -  ${rc.scheme.label}` : ''}`);

  const s = rc.student;
  y = drawFieldGrid(doc, y, [
    { label: "Student's Name", value: s.name },
    { label: 'Admission No.', value: s.admissionNumber },
    { label: "Mother's Name", value: s.motherName },
    { label: 'Class / Section', value: [s.className, s.sectionName].filter(Boolean).join(' - ') },
    { label: "Father's / Guardian", value: s.fatherName ?? s.guardianName },
    { label: 'Roll No.', value: s.rollNumber },
    { label: 'Date of Birth', value: formatDate(s.dateOfBirth) },
    { label: 'PEN / APAAR', value: [s.penNumber, s.apaarId].filter(Boolean).join(' / ') || null },
  ], { columns: 2, labelWidth: 96 });
  y += 4;

  // ---------------------------------------------------------------- Part 1: scholastic
  const b = box(doc);
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COLORS.rule).text('PART 1 : SCHOLASTIC AREAS', b.left, y);
  y = doc.y + 4;

  const comps = rc.scheme.components;
  const multiTerm = rc.terms.length > 1;
  // Width: subject column fixed, the rest shared by weight (component 1, total 1.3, grade 1.15, overall 1.4).
  const subjectW = multiTerm ? 104 : 150;
  const units = rc.terms.length * (comps.length + 1.3 + 1.15) + (multiTerm ? 1.4 + 1.15 : 0);
  const unit = (b.width - subjectW) / units;
  const termMax = comps.reduce((sum, c) => sum + c.weight, 0);
  const columns = [{ key: 'subject', label: 'Subject', width: subjectW, align: 'left' }];
  for (const term of rc.terms) {
    for (const c of comps) columns.push({ key: `${term.id}:${c.code}`, label: `${c.short}\n(${c.weight})`, width: unit, group: term.name });
    columns.push({ key: `${term.id}:total`, label: `Total\n(${termMax})`, width: unit * 1.3, group: term.name });
    columns.push({ key: `${term.id}:grade`, label: 'Grade', width: unit * 1.15, group: term.name });
  }
  if (multiTerm) {
    columns.push({ key: 'overall', label: `Marks\n(${rc.terms.length * termMax})`, width: unit * 1.4, group: 'Overall' });
    columns.push({ key: 'overallGrade', label: 'Grade', width: unit * 1.15, group: 'Overall' });
  }

  const num = (v) => (v == null ? '' : Number(v).toFixed(Number.isInteger(Number(v)) ? 0 : 1));
  const gradeCell = (g) => (g ? { text: g, bold: true, color: g === 'E' ? COLORS.fail : COLORS.ink } : '');

  const rows = rc.scholastic.map((subj) => {
    const row = { subject: { text: subj.name, bold: true } };
    for (const term of rc.terms) {
      const t = subj.terms[term.id];
      for (const c of comps) {
        const comp = t?.components?.[c.code];
        row[`${term.id}:${c.code}`] = comp ? num(comp.score) : '-';
      }
      row[`${term.id}:total`] = t?.obtained != null ? { text: num(t.obtained), bold: true } : '';
      row[`${term.id}:grade`] = gradeCell(t?.grade);
    }
    row.overall = { text: num(subj.obtained), bold: true };
    row.overallGrade = gradeCell(subj.grade);
    return row;
  });

  // Grand total row
  const termMaxes = rc.terms.map((term) => rc.scholastic.reduce((sum, subj) => sum + (subj.terms[term.id]?.max ?? 0), 0));
  const grand = {
    subject: { text: `Grand Total (out of ${multiTerm ? `${termMaxes.join(' / ')} / ${rc.totals.max}` : rc.totals.max})`, bold: true },
    _fill: COLORS.headFill,
    _bold: true,
  };
  for (const term of rc.terms) {
    const obtained = rc.scholastic.reduce((sum, subj) => sum + (subj.terms[term.id]?.obtained ?? 0), 0);
    const termGrade = gradeFor(rc.totals.max ? (obtained * 100) / rc.scholastic.reduce((sum, subj) => sum + (subj.terms[term.id]?.max ?? 0), 0) : null, rc.gradeScale ?? CBSE_GRADE_SCALE);
    grand[`${term.id}:total`] = num(obtained);
    grand[`${term.id}:grade`] = gradeCell(termGrade?.grade);
  }
  grand.overall = num(rc.totals.obtained);
  grand.overallGrade = gradeCell(rc.totals.grade);
  rows.push(grand);

  y = drawTable(doc, y, { columns, rows, onNewPage: watermark });
  y += 10;

  // ---------------------------------------------------------------- Part 2: co-scholastic + discipline
  const half = (b.width - 14) / 2;
  const termCols = rc.terms.map((t) => ({ key: t.id, label: `${t.name}\nGrade`, width: 52 }));
  const coRows = rc.coScholastic.map((a) => ({ area: { text: a.name, bold: true }, ...Object.fromEntries(rc.terms.map((t) => [t.id, a.grades[t.id] ?? '-'])) }));
  const discRows = rc.discipline
    ? [{ area: { text: rc.discipline.name, bold: true }, ...Object.fromEntries(rc.terms.map((t) => [t.id, rc.discipline.grades[t.id] ?? '-'])) }]
    : [];

  if (y + 90 > b.bottom) { doc.addPage(); watermark(); y = box(doc).top; }
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COLORS.rule).text('PART 2 : CO-SCHOLASTIC AREAS', b.left, y);
  if (discRows.length) doc.text('DISCIPLINE', b.left + half + 14, y);
  y = doc.y + 4;
  const coEnd = coRows.length
    ? drawTable(doc, y, { x: b.left, columns: [{ key: 'area', label: 'Area', width: half - termCols.length * 52, align: 'left' }, ...termCols], rows: coRows })
    : y;
  let rightEnd = discRows.length
    ? drawTable(doc, y, { x: b.left + half + 14, columns: [{ key: 'area', label: 'Element', width: half - termCols.length * 52, align: 'left' }, ...termCols], rows: discRows })
    : y;
  doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted)
    .text(`Grading: ${Object.entries(CO_SCHOLASTIC_GRADES).map(([g, d]) => `${g} = ${d}`).join(',  ')}`, b.left + half + 14, rightEnd + 4, { width: half });
  rightEnd = doc.y;
  y = Math.max(coEnd, rightEnd) + 10;

  // ---------------------------------------------------------------- summary
  if (y + 150 > b.bottom) { doc.addPage(); watermark(); y = box(doc).top; }
  const att = rc.attendance;
  const summary = [
    { label: 'Overall Percentage', value: rc.totals.percentage != null ? `${Number(rc.totals.percentage).toFixed(2)} %` : '-' },
    { label: 'Overall Grade', value: rc.totals.grade },
    ...(rc.ranks ? [
      { label: 'Rank in Section', value: rc.ranks.section ? `${rc.ranks.section} of ${rc.ranks.sectionSize}` : '-' },
      { label: 'Rank in Class', value: rc.ranks.class ? `${rc.ranks.class} of ${rc.ranks.classSize}` : '-' },
    ] : []),
    { label: 'Attendance', value: att?.working ? `${att.attended} / ${att.working} days (${Number(att.percentage).toFixed(1)}%)` : '-' },
    { label: 'Result', value: resultText(rc) },
  ];
  doc.rect(b.left, y, b.width, Math.ceil(summary.length / 2) * 17 + 10).fillAndStroke('#f8fafc', COLORS.grid);
  y = drawFieldGrid(doc, y + 6, summary.map((f) => ({ ...f, label: f.label })), { columns: 2, labelWidth: 100, rowGap: 6 }) + 6;

  if (rc.failedSubjects?.length && rc.isFinal) {
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.fail)
      .text(`Needs improvement in: ${rc.failedSubjects.join(', ')} (below ${rc.scheme.passPercentage}%).`, b.left, y, { width: b.width });
    y = doc.y + 4;
  }

  // ---------------------------------------------------------------- remarks
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COLORS.ink).text("Class Teacher's Remarks:", b.left, y + 2);
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.body);
  if (rc.remarks?.teacher) {
    doc.text(rc.remarks.teacher, b.left + 120, y + 2, { width: b.width - 120 });
  } else {
    doc.moveTo(b.left + 120, y + 12).lineTo(b.right, y + 12).lineWidth(0.4).strokeColor(COLORS.grid).stroke();
  }
  y = Math.max(doc.y, y + 14) + 4;
  if (rc.remarks?.principal) {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COLORS.ink).text("Principal's Remarks:", b.left, y);
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.body).text(rc.remarks.principal, b.left + 120, y, { width: b.width - 120 });
    y = doc.y + 4;
  }

  // ---------------------------------------------------------------- grading key + signatures
  const scale = rc.gradeScale ?? CBSE_GRADE_SCALE;
  const sorted = [...scale].sort((a, c) => c.min - a.min);
  const key = sorted.map((g, i) => `${g.grade}: ${i === 0 ? `${g.min}-100` : i === sorted.length - 1 ? `${sorted[i - 1].min - 1} & below` : `${g.min}-${sorted[i - 1].min - 1}`}`).join('   ');
  doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted)
    .text(`Scholastic grading (marks %):  ${key}.  Components: ${comps.map((c) => `${c.short} = ${c.label} (${c.weight})`).join(', ')}.`, b.left, y + 2, { width: b.width });
  y = doc.y + 4;

  if (y + 60 > b.bottom) { doc.addPage(); watermark(); y = box(doc).top; }
  const place = rc.school.place ? `Place: ${rc.school.place}   ` : '';
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.body).text(`${place}Date of Issue: ${formatDate(rc.issueDate)}`, b.left, y + 4);
  drawSignatures(doc, y + 2, [
    { title: 'Class Teacher', subtitle: rc.classTeacher ?? undefined },
    { title: 'Principal', subtitle: rc.school.principalName ?? undefined },
    { title: 'Parent / Guardian' },
  ], { gapAbove: 38, sealFor: 1 });

  stampFooters(doc, {
    qr,
    verifyUrl,
    code: published ? rc.verificationCode : null,
    documentNumber: `${rc.student.admissionNumber} / ${rc.session}`,
    note: published ? 'Computer-generated report card. Scan the QR code to confirm it matches the school record.' : 'Draft: not valid until published by the school.',
  });

  doc.end();
  return doc;
}

function resultText(rc) {
  switch (rc.result) {
    case 'promoted': return rc.promotedTo ? `Promoted to ${rc.promotedTo}` : 'Promoted';
    case 'pass': return 'Passed';
    case 'detained': return 'Essential Repeat';
    case 'fail': return 'Not qualified';
    case 'withheld': return 'Result withheld';
    default: return rc.isFinal ? 'Awaited' : 'Progress report (term)';
  }
}
