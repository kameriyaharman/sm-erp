/**
 * Message templates.
 *
 * Indian SMS: every business SMS must match a template registered on the DLT
 * portal (TRAI rules), sent from an approved 6-character sender ID. The text
 * below must match the registered template exactly, with variables in place.
 * WhatsApp: business-initiated messages must use a template pre-approved by
 * Meta; on Twilio that is a Content SID with numbered variables.
 *
 * SMS text deliberately uses "Rs." rather than "₹": the rupee sign is not in
 * the GSM-7 alphabet, and one such character switches the whole message to
 * Unicode, cutting a segment from 160 to 70 characters (roughly 2–3x the cost).
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-02" | Date -> "Fri 2 Oct 2026" (calendar date, no timezone shift) */
export function formatDate(value) {
  let y;
  let m;
  let d;
  if (value instanceof Date) {
    [y, m, d] = [value.getFullYear(), value.getMonth() + 1, value.getDate()];
  } else {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
    if (!match) throw new TypeError('Invalid date');
    [y, m, d] = match.slice(1).map(Number);
  }
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (Number.isNaN(weekday)) throw new TypeError('Invalid date');
  return `${WEEKDAYS[weekday]} ${d} ${MONTHS[m - 1]} ${y}`;
}

/** 31000 | "31000.50" -> "31,000" | "31,000.50" (Indian grouping, no currency sign) */
export function formatAmount(value) {
  const n = Number(value);
  return n.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
}

/** True if the text fits the GSM-7 alphabet (cheap 160-char SMS segments). */
export function isGsm7(text) {
  return /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/.test(text);
}

export function smsSegments(text) {
  const gsm = isGsm7(text);
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  return text.length <= single ? 1 : Math.ceil(text.length / multi);
}

// SMS clipping uses "..." because "…" is not GSM-7 and would turn the whole SMS into Unicode.
const clip = (text, max, ellipsis = '...') => (text.length <= max ? text : `${text.slice(0, max - ellipsis.length).trimEnd()}${ellipsis}`);

/**
 * Each template renders:
 *   sms.text        — the full SMS body (must match the DLT-registered template)
 *   sms.variables   — ordered values for gateways that fill variables server-side (MSG91 flows)
 *   whatsapp.variables — {"1": ..., "2": ...} for the approved WhatsApp template
 */
export const TEMPLATES = {
  absentee_alert: {
    render: ({ studentName, date, schoolName }) => {
      const day = formatDate(date);
      return {
        sms: {
          text: `Dear Parent, ${studentName} was marked absent at ${schoolName} on ${day}. If this is unexpected, please contact the school office.`,
          variables: [studentName, schoolName, day],
        },
        whatsapp: { variables: { 1: studentName, 2: schoolName, 3: day } },
      };
    },
  },

  attendance_correction: {
    render: ({ studentName, date, schoolName }) => {
      const day = formatDate(date);
      return {
        sms: {
          text: `Dear Parent, update from ${schoolName}: ${studentName} has been marked present on ${day}. Please ignore the earlier absence message.`,
          variables: [schoolName, studentName, day],
        },
        whatsapp: { variables: { 1: schoolName, 2: studentName, 3: day } },
      };
    },
  },

  fee_due_reminder: {
    render: ({ parentName, amount, dueDate, paymentLink, schoolName }) => {
      const day = formatDate(dueDate);
      const rupees = formatAmount(amount);
      return {
        sms: {
          text: `Dear ${parentName}, fee of Rs.${rupees} is due on ${day} at ${schoolName}. Pay online: ${paymentLink}`,
          variables: [parentName, rupees, day, schoolName, paymentLink],
        },
        whatsapp: { variables: { 1: parentName, 2: `₹${rupees}`, 3: day, 4: schoolName, 5: paymentLink } },
      };
    },
  },

  general_notice: {
    render: ({ noticeTitle, noticeBody, schoolName }) => {
      // SMS: keep within 2 segments; the full notice lives in the app.
      const prefix = `${schoolName}: ${noticeTitle}. `;
      const suffix = ' Details in the school app.';
      const room = 306 - prefix.length - suffix.length;
      return {
        sms: {
          text: `${prefix}${clip(noticeBody.replace(/\s+/g, ' ').trim(), Math.max(room, 40))}${suffix}`,
          variables: [schoolName, noticeTitle, clip(noticeBody, Math.max(room, 40))],
        },
        // WhatsApp templates allow up to 1024 characters per variable.
        whatsapp: { variables: { 1: schoolName, 2: clip(noticeTitle, 200, '…'), 3: clip(noticeBody, 1000, '…') } },
      };
    },
  },
};
