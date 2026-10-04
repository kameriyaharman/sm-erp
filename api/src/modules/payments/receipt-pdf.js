import PDFDocument from 'pdfkit';
import { toPaise } from '../../utils/money.js';
import { rupeesInWords } from './amount-in-words.js';

/**
 * Renders a fee receipt as an A4 PDF and streams it into `out` (an HTTP response
 * or any writable stream). Built from the receipt row that the webhook created in
 * the same transaction as the payment, so the PDF can never disagree with the ledger.
 *
 * Built-in Helvetica has no rupee glyph, so amounts are printed as "Rs.".
 */
const C = {
  ink: '#0f172a',
  muted: '#64748b',
  line: '#e2e8f0',
  band: '#f1f5f9',
  accent: '#4f46e5',
  ok: '#047857',
  bad: '#b91c1c',
  badBand: '#fef2f2',
};

const MODE_LABEL = {
  upi: 'UPI', card: 'Card', net_banking: 'Net banking', wallet: 'Wallet', bank_transfer: 'Bank transfer',
  cash: 'Cash', cheque: 'Cheque', demand_draft: 'Demand draft', other: 'Online',
};

const inr = (value) => `Rs. ${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value))}`;

function formatDateTime(date, timeZone = 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(new Date(date));
}

export function renderReceiptPdf(r, out) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    info: { Title: `Fee receipt ${r.receipt_number}${r.status === 'cancelled' ? ' (CANCELLED)' : ''}`, Author: r.school_name, Subject: 'Fee receipt' },
  });
  doc.pipe(out);

  const left = 40;
  const width = doc.page.width - 80;
  const right = left + width;
  const top = 40;

  // ---------------------------------------------------------------- outer frame + header
  doc.lineWidth(1).strokeColor(C.line);

  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(17).text(r.school_name, left + 18, top + 18, { width: width - 180 });
  doc.font('Helvetica').fontSize(9).fillColor(C.muted);
  const address = [r.branch_name, [r.address_line1, r.address_line2].filter(Boolean).join(', '),
    [r.city, r.state, r.postal_code].filter(Boolean).join(', ')].filter(Boolean);
  doc.text(address.join('\n'), { width: width - 180 });
  const contact = [r.branch_phone && `Ph: ${r.branch_phone}`, r.branch_email].filter(Boolean).join('   ');
  if (contact) doc.text(contact, { width: width - 180 });
  if (r.affiliation_no) doc.text(`Affiliation No. ${r.affiliation_no}`, { width: width - 180 });
  const headerBottom = doc.y;

  // Title block on the right
  doc.font('Helvetica-Bold').fontSize(13).fillColor(C.accent).text('FEE RECEIPT', right - 170, top + 20, { width: 152, align: 'right' });
  const paidOnline = Boolean(r.gateway_payment_id);
  const cancelled = r.status === 'cancelled';
  const stamp = cancelled ? 'CANCELLED' : paidOnline ? 'PAID ONLINE' : 'PAID';
  const stampColor = cancelled ? C.bad : C.ok;
  doc.roundedRect(right - 98, top + 40, 80, 20, 4).lineWidth(1.2).strokeColor(stampColor).stroke();
  doc.font('Helvetica-Bold').fontSize(9).fillColor(stampColor).text(stamp, right - 98, top + 46, { width: 80, align: 'center' });

  let y = Math.max(headerBottom, top + 70) + 12;
  doc.moveTo(left, y).lineTo(right, y).lineWidth(1.5).strokeColor(cancelled ? C.bad : C.accent).stroke();
  y += 14;

  // ---------------------------------------------------------------- cancellation notice
  if (cancelled) {
    const by = r.cancelled_by_name ? ` by ${r.cancelled_by_name}` : '';
    const note = [
      `This receipt was cancelled on ${formatDateTime(r.cancelled_at, r.timezone)}${by}. The amount is not counted as paid.`,
      `Reason: ${r.cancel_reason ?? '-'}`,
      paidOnline ? 'Paid online: any refund of this payment is made by the school through Razorpay, separately.' : null,
    ].filter(Boolean).join('\n');
    doc.font('Helvetica').fontSize(9.5);
    const h = doc.heightOfString(note, { width: width - 56 }) + 30;
    doc.rect(left + 10, y, width - 20, h).fill(C.badBand);
    doc.rect(left + 10, y, 3, h).fill(C.bad);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(C.bad).text('RECEIPT CANCELLED', left + 24, y + 8, { width: width - 56 });
    doc.font('Helvetica').fontSize(9.5).fillColor(C.ink).text(note, left + 24, y + 22, { width: width - 56 });
    y += h + 12;
  }

  // ---------------------------------------------------------------- meta grid (2 columns)
  const colW = (width - 36) / 2;
  const field = (label, value, x, yy) => {
    doc.font('Helvetica').fontSize(8).fillColor(C.muted).text(label.toUpperCase(), x, yy, { width: colW, characterSpacing: 0.4 });
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(C.ink).text(value || '-', x, yy + 11, { width: colW });
  };
  const leftX = left + 18;
  const rightX = left + 18 + colW;
  const classLabel = [r.class_name, r.section_name].filter(Boolean).join(' - ');

  field('Receipt No.', r.receipt_number, leftX, y);
  field('Date', formatDateTime(r.received_at, r.timezone), rightX, y);
  y += 34;
  field('Student', r.student_name, leftX, y);
  field('Admission No.', r.admission_number, rightX, y);
  y += 34;
  field('Class', classLabel + (r.roll_number ? `   (Roll ${r.roll_number})` : ''), leftX, y);
  field('Academic Year', r.academic_year, rightX, y);
  y += 34;
  if (r.parent_name) {
    field('Parent / Guardian', r.parent_name, leftX, y);
    y += 34;
  }
  y += 4;

  // ---------------------------------------------------------------- line items
  const cols = [
    { key: 'n', label: '#', x: left + 18, w: 22, align: 'left' },
    { key: 'inv', label: 'Invoice', x: left + 40, w: 150, align: 'left' },
    { key: 'desc', label: 'Period / Fee heads', x: left + 194, w: width - 194 - 18 - 104, align: 'left' },
    { key: 'amt', label: 'Amount', x: right - 18 - 100, w: 100, align: 'right' },
  ];
  doc.rect(left + 10, y, width - 20, 22).fill(C.band);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.muted);
  cols.forEach((c) => doc.text(c.label.toUpperCase(), c.x, y + 7, { width: c.w, align: c.align, characterSpacing: 0.4 }));
  y += 28;

  const lines = r.lines ?? [];
  doc.font('Helvetica').fontSize(10).fillColor(C.ink);
  lines.forEach((line, i) => {
    const desc = [line.periodLabel, line.heads].filter(Boolean).join(' - ') || '-';
    const rowH = Math.max(doc.heightOfString(desc, { width: cols[2].w }), doc.heightOfString(line.invoiceNumber, { width: cols[1].w }), 12) + 10;
    doc.font('Helvetica').fontSize(10).fillColor(C.ink);
    doc.text(String(i + 1), cols[0].x, y, { width: cols[0].w });
    doc.text(line.invoiceNumber, cols[1].x, y, { width: cols[1].w });
    doc.text(desc, cols[2].x, y, { width: cols[2].w });
    doc.text(inr(line.applied), cols[3].x, y, { width: cols[3].w, align: 'right' });
    if (Number(line.balanceAfter) > 0) {
      doc.font('Helvetica').fontSize(8).fillColor(C.muted)
        .text(`Balance on invoice: ${inr(line.balanceAfter)}`, cols[2].x, y + rowH - 9, { width: cols[2].w });
      y += 10;
    }
    y += rowH;
    doc.moveTo(left + 10, y - 4).lineTo(right - 10, y - 4).lineWidth(0.6).strokeColor(C.line).stroke();
  });

  // Total
  y += 4;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.ink).text(cancelled ? 'Total (cancelled)' : 'Total received', cols[2].x, y, { width: cols[2].w });
  doc.fontSize(13).text(inr(r.amount), cols[3].x - 40, y - 1, { width: cols[3].w + 40, align: 'right' });
  y += 22;
  doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(C.muted)
    .text(rupeesInWords(toPaise(r.amount)), left + 18, y, { width: width - 36 });
  y = doc.y + 14;

  // ---------------------------------------------------------------- payment details
  doc.rect(left + 10, y, width - 20, 40).fill(C.band);
  const detail = (label, value, x, yy, w) => {
    doc.font('Helvetica').fontSize(8).fillColor(C.muted).text(label.toUpperCase(), x, yy, { width: w, characterSpacing: 0.4 });
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.ink).text(value || '-', x, yy + 11, { width: w });
  };
  const third = (width - 36) / 3;
  const methodLabel = MODE_LABEL[r.payment_mode] ?? r.payment_mode;
  detail('Payment mode', paidOnline ? `${methodLabel} (Razorpay)` : methodLabel, left + 18, y + 9, third);
  detail(paidOnline ? 'Payment ID' : 'Reference', r.gateway_payment_id ?? r.instrument_number, left + 18 + third, y + 9, third);
  detail(paidOnline ? 'Order ID' : 'Collected by', paidOnline ? r.gateway_order_id : r.collected_by, left + 18 + third * 2, y + 9, third);
  y += 48;

  // ---------------------------------------------------------------- footer
  doc.font('Helvetica').fontSize(8.5).fillColor(C.muted).text(
    'This is a computer-generated receipt and does not require a signature. Please keep it for your records.',
    left + 18, y + 6, { width: width - 36 },
  );
  y = doc.y + 14;

  // Frame around the whole receipt block (drawn last so it fits the content).
  doc.roundedRect(left, top, width, y - top, 8).lineWidth(1).strokeColor(C.line).stroke();

  // Small generated-at stamp under the block.
  doc.font('Helvetica').fontSize(7.5).fillColor('#94a3b8')
    .text(`Generated ${formatDateTime(new Date(), r.timezone)}`, left, y + 8, { width, align: 'right' });

  // Diagonal watermark across the receipt, drawn last so it sits over everything.
  if (cancelled) {
    const cx = left + width / 2;
    const cy = top + (y - top) / 2;
    doc.save();
    doc.rotate(-30, { origin: [cx, cy] });
    doc.fillOpacity(0.13).fillColor(C.bad).font('Helvetica-Bold').fontSize(84)
      .text('CANCELLED', cx - 300, cy - 42, { width: 600, align: 'center', lineBreak: false });
    doc.restore();
  }

  doc.end();
  return doc;
}
