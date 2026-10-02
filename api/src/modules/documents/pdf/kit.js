import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

/**
 * Shared building blocks for every official document: letterhead, grid tables
 * with grouped headers and page breaks, signature lines, watermark and the
 * verification footer (QR + code). Renderers compose these; none of them
 * touch the database.
 *
 * Built-in Helvetica only covers Latin-1, so amounts are printed as "Rs." and
 * text is expected in English. Register a Unicode font (doc.registerFont) here
 * if Hindi / bilingual documents are needed.
 */

export const COLORS = Object.freeze({
  ink: '#111827',
  body: '#1f2937',
  muted: '#6b7280',
  rule: '#1e3a8a',          // navy: letterhead + titles
  grid: '#9ca3af',
  headFill: '#e0e7ff',
  groupFill: '#c7d2fe',
  zebra: '#f8fafc',
  fail: '#b91c1c',
  watermark: '#1e3a8a',
});

export const A4 = { width: 595.28, height: 841.89 };

/** Space reserved at the bottom of every page for stampFooters(). */
export const FOOTER_HEIGHT = 62;

export function createDocument({ title, author, subject, margins = { top: 30, left: 32, right: 32, bottom: 30 + FOOTER_HEIGHT }, layout = 'portrait' }) {
  return new PDFDocument({
    size: 'A4',
    layout,
    margins,
    bufferPages: true,                       // lets us stamp page numbers / footers at the end
    info: { Title: title, Author: author, Subject: subject, Creator: 'SM ERP' },
  });
}

/** Content box of the current page. */
export function box(doc) {
  const { margins, width, height } = doc.page;
  return { left: margins.left, right: width - margins.right, top: margins.top, bottom: height - margins.bottom, width: width - margins.left - margins.right };
}

/** 'data:image/png;base64,...' or Buffer -> Buffer | null */
export function imageBuffer(source) {
  if (!source) return null;
  if (Buffer.isBuffer(source)) return source;
  const match = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(String(source));
  return match ? Buffer.from(match[2], 'base64') : null;
}

export async function qrPng(text) {
  return QRCode.toBuffer(text, { errorCorrectionLevel: 'M', margin: 0, width: 240, color: { dark: '#111827', light: '#ffffff' } });
}

function monogram(doc, x, y, size, name) {
  const initials = String(name ?? 'S').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  doc.save();
  doc.circle(x + size / 2, y + size / 2, size / 2).lineWidth(1.5).strokeColor(COLORS.rule).stroke();
  doc.circle(x + size / 2, y + size / 2, size / 2 - 4).lineWidth(0.5).stroke();
  doc.font('Helvetica-Bold').fontSize(size * 0.34).fillColor(COLORS.rule)
    .text(initials, x, y + size / 2 - size * 0.17, { width: size, align: 'center' });
  doc.restore();
}

/**
 * School letterhead. Returns the y below it.
 * school: { name, branchName, address, phone, email, website, affiliationNo, schoolCode, udiseCode, board, logo, secondaryLogo }
 */
export function drawLetterhead(doc, school) {
  const b = box(doc);
  const logoSize = 58;
  const top = b.top;

  const logo = imageBuffer(school.logo);
  if (logo) doc.image(logo, b.left, top, { fit: [logoSize, logoSize], align: 'center', valign: 'center' });
  else monogram(doc, b.left, top, logoSize, school.name);

  // Optional second logo on the right (e.g. the board's logo, if the school is permitted to use it).
  const second = imageBuffer(school.secondaryLogo);
  if (second) doc.image(second, b.right - logoSize, top, { fit: [logoSize, logoSize], align: 'center', valign: 'center' });

  const textX = b.left + logoSize + 10;
  const textW = b.width - 2 * (logoSize + 10);
  doc.font('Helvetica-Bold').fontSize(17).fillColor(COLORS.rule)
    .text(String(school.name).toUpperCase(), textX, top + 2, { width: textW, align: 'center', characterSpacing: 0.5 });
  if (school.branchName && school.branchName !== school.name) {
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COLORS.body).text(school.branchName, { width: textW, align: 'center' });
  }
  const affiliation = [
    school.board ? `Affiliated to ${school.board}` : null,
    school.affiliationNo ? `Affiliation No. ${school.affiliationNo}` : null,
    school.schoolCode ? `School Code ${school.schoolCode}` : null,
    school.udiseCode ? `UDISE ${school.udiseCode}` : null,
  ].filter(Boolean).join('  |  ');
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.body);
  if (affiliation) doc.text(affiliation, { width: textW, align: 'center' });
  if (school.address) doc.text(school.address, { width: textW, align: 'center' });
  const contact = [school.phone && `Ph: ${school.phone}`, school.email, school.website].filter(Boolean).join('  |  ');
  if (contact) doc.fillColor(COLORS.muted).text(contact, { width: textW, align: 'center' });

  const y = Math.max(doc.y, top + logoSize) + 6;
  doc.moveTo(b.left, y).lineTo(b.right, y).lineWidth(1.6).strokeColor(COLORS.rule).stroke();
  doc.moveTo(b.left, y + 2.5).lineTo(b.right, y + 2.5).lineWidth(0.5).stroke();
  return y + 10;
}

/** Centered document title in a band. Returns y below. */
export function drawTitle(doc, y, title, subtitle) {
  const b = box(doc);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS.ink)
    .text(title.toUpperCase(), b.left, y, { width: b.width, align: 'center', characterSpacing: 0.8 });
  let next = doc.y;
  if (subtitle) {
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text(subtitle, b.left, next + 1, { width: b.width, align: 'center' });
    next = doc.y;
  }
  return next + 8;
}

/**
 * Label/value grid, e.g. student details. fields: [{ label, value }], `columns` per row.
 * Returns y below.
 */
export function drawFieldGrid(doc, y, fields, { columns = 2, labelWidth = 92, fontSize = 9, rowGap = 4 } = {}) {
  const b = box(doc);
  const colW = b.width / columns;
  let rowTop = y;
  for (let i = 0; i < fields.length; i += columns) {
    let rowBottom = rowTop;
    fields.slice(i, i + columns).forEach((f, c) => {
      const x = b.left + c * colW;
      doc.font('Helvetica').fontSize(fontSize).fillColor(COLORS.muted).text(f.label, x, rowTop, { width: labelWidth });
      doc.font('Helvetica-Bold').fontSize(fontSize).fillColor(COLORS.ink)
        .text(f.value == null || f.value === '' ? '-' : String(f.value), x + labelWidth, rowTop, { width: colW - labelWidth - 8 });
      rowBottom = Math.max(rowBottom, doc.y);
    });
    rowTop = rowBottom + rowGap;
  }
  return rowTop;
}

/**
 * Grid table with optional grouped header, zebra rows and page breaks (header repeats).
 *
 * columns: [{ key, label, width, align='center', group? }]   widths in points; null = take the rest
 * rows:    [{ [key]: string | { text, bold, color } }]
 * Returns y below the table.
 */
export function drawTable(doc, y, { columns, rows, fontSize = 8.5, headerFontSize = 7.5, padding = 3.5, x, minRowHeight = 15, onNewPage } = {}) {
  const b = box(doc);
  const left = x ?? b.left;
  const fixed = columns.reduce((s, c) => s + (c.width ?? 0), 0);
  const flexible = columns.filter((c) => !c.width).length;
  const cols = columns.map((c) => ({ align: 'center', ...c, width: c.width ?? (b.width - fixed) / Math.max(flexible, 1) }));
  const offsets = [];
  cols.reduce((acc, c, i) => { offsets[i] = acc; return acc + c.width; }, left);
  const tableWidth = cols.reduce((s, c) => s + c.width, 0);
  const hasGroups = cols.some((c) => c.group);

  const cellText = (v) => (v == null ? '' : typeof v === 'object' ? String(v.text ?? '') : String(v));

  const drawHeader = (top) => {
    let cursor = top;
    if (hasGroups) {
      const groupH = 14;
      let i = 0;
      while (i < cols.length) {
        const g = cols[i].group;
        let j = i;
        let w = 0;
        while (j < cols.length && cols[j].group === g) { w += cols[j].width; j += 1; }
        if (g) {
          doc.rect(offsets[i], cursor, w, groupH).fillAndStroke(COLORS.groupFill, COLORS.grid);
          doc.font('Helvetica-Bold').fontSize(headerFontSize + 0.5).fillColor(COLORS.ink)
            .text(g, offsets[i], cursor + 3.5, { width: w, align: 'center' });
        }
        i = j;
      }
      cursor += groupH;
    }
    doc.font('Helvetica-Bold').fontSize(headerFontSize);
    const headH = Math.max(...cols.map((c) => doc.heightOfString(c.label, { width: c.width - 2 * padding }))) + 2 * padding;
    cols.forEach((c, i) => {
      // Ungrouped columns span the group row too, so the label sits in one tall cell.
      const spanTop = hasGroups && !c.group ? top : cursor;
      const h = headH + (cursor - spanTop);
      doc.rect(offsets[i], spanTop, c.width, h).fillAndStroke(COLORS.headFill, COLORS.grid);
      doc.font('Helvetica-Bold').fontSize(headerFontSize).fillColor(COLORS.ink)
        .text(c.label, offsets[i] + padding, spanTop + (h - doc.heightOfString(c.label, { width: c.width - 2 * padding })) / 2,
          { width: c.width - 2 * padding, align: c.align === 'left' ? 'left' : 'center' });
    });
    return cursor + headH;
  };

  doc.lineWidth(0.5);
  let cursor = drawHeader(y);
  rows.forEach((row, r) => {
    doc.font('Helvetica').fontSize(fontSize);
    const rowH = Math.max(minRowHeight, ...cols.map((c) => {
      const v = row[c.key];
      doc.font(v && typeof v === 'object' && v.bold ? 'Helvetica-Bold' : 'Helvetica');
      return doc.heightOfString(cellText(v), { width: c.width - 2 * padding }) + 2 * padding;
    }));
    if (cursor + rowH > box(doc).bottom) {
      doc.addPage();
      onNewPage?.(doc);
      cursor = drawHeader(box(doc).top);
    }
    if (row._fill || r % 2 === 1) doc.rect(left, cursor, tableWidth, rowH).fill(row._fill ?? COLORS.zebra);
    cols.forEach((c, i) => {
      const v = row[c.key];
      const text = cellText(v);
      doc.rect(offsets[i], cursor, c.width, rowH).lineWidth(0.5).strokeColor(COLORS.grid).stroke();
      doc.font(v && typeof v === 'object' && v.bold ? 'Helvetica-Bold' : row._bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(fontSize).fillColor(v && typeof v === 'object' && v.color ? v.color : COLORS.body);
      const textH = doc.heightOfString(text, { width: c.width - 2 * padding });
      doc.text(text, offsets[i] + padding, cursor + (rowH - textH) / 2, { width: c.width - 2 * padding, align: c.align });
    });
    cursor += rowH;
  });
  return cursor;
}

/**
 * Signature placeholders spread across the width.
 * signatures: [{ title, subtitle? }]. Returns y below.
 */
export function drawSignatures(doc, y, signatures, { lineWidth = 130, gapAbove = 34, sealFor } = {}) {
  const b = box(doc);
  const slot = b.width / signatures.length;
  const lineY = y + gapAbove;
  signatures.forEach((s, i) => {
    const cx = b.left + slot * i + slot / 2;
    if (sealFor === i) {
      // Faint dashed circle where the school seal goes, overlapping the signature as a real seal would.
      doc.save().circle(cx, lineY - 22, 20).dash(2, { space: 2 }).lineWidth(0.6).strokeColor(COLORS.grid).stroke().undash().restore();
      doc.font('Helvetica').fontSize(6).fillColor(COLORS.grid).text('SEAL', cx - 20, lineY - 25, { width: 40, align: 'center' });
    }
    doc.moveTo(cx - lineWidth / 2, lineY).lineTo(cx + lineWidth / 2, lineY).lineWidth(0.7).strokeColor(COLORS.ink).stroke();
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COLORS.ink).text(s.title, cx - slot / 2, lineY + 4, { width: slot, align: 'center' });
    if (s.subtitle) doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted).text(s.subtitle, cx - slot / 2, doc.y + 1, { width: slot, align: 'center' });
  });
  return doc.y + 6;
}

/** Big diagonal text behind the content of the current page (e.g. DUPLICATE, CANCELLED, PROVISIONAL). */
export function drawWatermark(doc, text, { opacity = 0.07, color = COLORS.watermark } = {}) {
  const { width, height } = doc.page;
  doc.save();
  doc.rotate(-35, { origin: [width / 2, height / 2] });
  doc.font('Helvetica-Bold').fontSize(80).fillColor(color).opacity(opacity)
    .text(text, 0, height / 2 - 40, { width, align: 'center', lineBreak: false });
  doc.restore();
  doc.opacity(1);
}

/**
 * Verification strip at the bottom of every page: QR to the public verify URL,
 * the code, document number, and page x of n. Call once, after all content.
 */
export function stampFooters(doc, { qr, verifyUrl, code, documentNumber, note }) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const { width, height, margins } = doc.page;
    const bottom = height - 14;
    const size = 46;
    const top = bottom - size;
    const left = margins.left;
    // Keep the footer out of the auto page-break logic.
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    doc.moveTo(left, top - 6).lineTo(width - margins.right, top - 6).lineWidth(0.4).strokeColor(COLORS.grid).stroke();
    if (qr) doc.image(qr, left, top, { width: size, height: size });
    const tx = left + (qr ? size + 8 : 0);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLORS.ink)
      .text(code ? `Verification code: ${code}` : 'Not yet verifiable (draft)', tx, top + 2, { lineBreak: false });
    doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted);
    if (verifyUrl) doc.text(`Verify at ${verifyUrl}`, tx, top + 13, { lineBreak: false });
    if (note) doc.text(note, tx, top + 23, { width: width - tx - margins.right - 90 });
    doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted)
      .text(`${documentNumber ? `${documentNumber}   ` : ''}Page ${i - range.start + 1} of ${range.count}`,
        width - margins.right - 200, bottom - 9, { width: 200, align: 'right', lineBreak: false });

    doc.page.margins.bottom = savedBottom;
  }
}


/** Build the school header object from a joined branch/tenant row. */
export function schoolFromRow(row) {
  const s = row.branch_settings?.documents ?? {};
  return {
    name: s.schoolName ?? row.school_name,
    branchName: s.showBranchName === false ? null : row.branch_name,
    board: s.board ?? 'CBSE, New Delhi',
    affiliationNo: row.affiliation_no,
    schoolCode: row.school_code,
    udiseCode: row.udise_code,
    address: [row.address_line1, row.address_line2, [row.city, row.state].filter(Boolean).join(', '), row.postal_code].filter(Boolean).join(', '),
    phone: row.branch_phone,
    email: row.branch_email,
    website: s.website,
    logo: s.logo,
    secondaryLogo: s.secondaryLogo,
    principalName: s.principalName,
    place: s.place ?? row.city,
    timeZone: row.timezone ?? 'Asia/Kolkata',
  };
}
