import {
  COLORS, box, createDocument, drawLetterhead, drawSignatures, drawTitle, drawWatermark, qrPng, stampFooters,
} from './kit.js';
import { formatDate } from './words.js';

/**
 * Transfer Certificate and Bonafide Certificate, rendered from the frozen
 * `certificates.content` snapshot (never from live student data), so every
 * reprint is word-for-word the certificate that was issued.
 *
 * @param {object} cert   { type, number, verificationCode, status, issuedAt, cancelledAt, cancelReason, content }
 * @param {Writable} out
 * @param {{ verifyBaseUrl?: string, copyLabel?: 'ORIGINAL' | 'DUPLICATE' }} options
 */
export async function renderCertificate(cert, out, { verifyBaseUrl, copyLabel = 'ORIGINAL' } = {}) {
  const c = cert.content;
  const verifyUrl = verifyBaseUrl ? `${verifyBaseUrl}/${cert.verificationCode}` : null;
  const qr = verifyUrl ? await qrPng(verifyUrl) : null;
  const cancelled = cert.status === 'cancelled';

  const doc = createDocument({
    title: `${c.title} ${cert.number}`,
    author: c.school.name,
    subject: `${c.title} - ${c.student.name}`,
  });
  doc.pipe(out);

  const marks = () => {
    if (cancelled) drawWatermark(doc, 'CANCELLED', { color: COLORS.fail, opacity: 0.12 });
    else if (copyLabel === 'DUPLICATE') drawWatermark(doc, 'DUPLICATE');
  };
  marks();

  let y = drawLetterhead(doc, c.school);
  const b = box(doc);

  // Reference line: certificate no. left, copy label + date right.
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.ink).text(`${c.numberLabel}: ${cert.number}`, b.left, y);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(cancelled ? COLORS.fail : COLORS.rule)
    .text(cancelled ? 'CANCELLED' : copyLabel === 'DUPLICATE' ? 'DUPLICATE COPY' : 'ORIGINAL', b.left, y, { width: b.width, align: 'right' });
  y = doc.y + 2;
  if (c.references?.length) {
    doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.body)
      .text(c.references.map((r) => `${r.label}: ${r.value || '-'}`).join('     '), b.left, y, { width: b.width });
    y = doc.y;
  }
  y = drawTitle(doc, y + 8, c.title, c.subtitle);

  if (cert.type === 'transfer_certificate') y = drawNumberedFields(doc, y, c.fields, marks);
  else y = drawBody(doc, y, c);

  // ---------------------------------------------------------------- signatures
  if (y + 80 > box(doc).bottom) { doc.addPage(); marks(); y = box(doc).top; }
  doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.body)
    .text(`Place: ${c.school.place ?? ''}`, b.left, y + 8)
    .text(`Date: ${formatDate(c.issueDate)}`, b.left, doc.y + 2);
  drawSignatures(doc, y + 8, c.signatures, { gapAbove: 46, sealFor: c.signatures.length - 1 });

  if (cancelled) {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COLORS.fail)
      .text(`This certificate was cancelled on ${formatDate(String(cert.cancelledAt).slice(0, 10))}: ${cert.cancelReason}`, b.left, doc.y + 8, { width: b.width });
  }

  stampFooters(doc, {
    qr,
    verifyUrl,
    code: cert.verificationCode,
    documentNumber: cert.number,
    note: 'Any alteration or overwriting makes this certificate invalid. Scan the QR code to confirm it matches the school register.',
  });

  doc.end();
  return doc;
}

/** "1. Name of the Pupil ......  VALUE" rows, value underlined, wrapping on both sides. */
function drawNumberedFields(doc, y, fields, onNewPage) {
  const b = box(doc);
  const noW = 20;
  const labelW = 238;
  const valueX = b.left + noW + labelW + 8;
  const valueW = b.right - valueX;
  let cursor = y;
  for (const f of fields) {
    doc.font('Helvetica').fontSize(9);
    const labelH = doc.heightOfString(f.label, { width: labelW });
    doc.font('Helvetica-Bold').fontSize(9.5);
    const value = f.value == null || f.value === '' ? '-' : String(f.value);
    const valueH = doc.heightOfString(value, { width: valueW });
    const rowH = Math.max(labelH, valueH) + 5.5;
    if (cursor + rowH > box(doc).bottom) { doc.addPage(); onNewPage?.(); cursor = box(doc).top; }

    doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text(`${f.no}.`, b.left, cursor, { width: noW });
    doc.fillColor(COLORS.body).text(f.label, b.left + noW, cursor, { width: labelW });
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COLORS.ink).text(value, valueX, cursor - 0.5, { width: valueW });
    const lineY = cursor + Math.max(labelH, valueH) + 1.5;
    doc.moveTo(valueX, lineY).lineTo(b.right, lineY).lineWidth(0.3).dash(1, { space: 1.5 }).strokeColor(COLORS.grid).stroke().undash();
    cursor += rowH;
  }
  return cursor;
}

/** Bonafide body: paragraphs of segments [{ text, bold }], justified. */
function drawBody(doc, y, c) {
  const b = box(doc);
  let cursor = y + 10;
  for (const paragraph of c.body) {
    doc.x = b.left;
    doc.y = cursor;
    paragraph.forEach((seg, i) => {
      doc.font(seg.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(11).fillColor(COLORS.ink)
        .text(seg.text, { width: b.width, align: 'left', lineGap: 5, continued: i < paragraph.length - 1 });
    });
    cursor = doc.y + 12;
  }
  if (c.details?.length) {
    cursor += 2;
    for (const d of c.details) {
      doc.font('Helvetica').fontSize(9.5).fillColor(COLORS.muted).text(d.label, b.left + 20, cursor, { width: 150 });
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COLORS.ink).text(d.value || '-', b.left + 175, cursor, { width: b.width - 175 });
      cursor = doc.y + 4;
    }
  }
  return cursor + 6;
}
