import { EVENTS } from './catalog.js';
import { TEMPLATES, formatAmount, formatDate } from './templates.js';

/**
 * Turns an event + its data into the text each channel sends, using the school's own templates
 * when it has saved them and the catalog defaults otherwise.
 *
 *   renderEvent('absentee_alert', { studentName, schoolName, date }, { sms: tpl, whatsapp: tpl })
 *     -> { sms: { text, variables }, whatsapp: { variables: {1: ..}, name, language, params }, email: { subject, text, html } }
 *
 * For the four original messages (absentee alert, correction, fee reminder, notice) the SMS and
 * WhatsApp parts come from templates.js unless the school saved its own text, so nothing changes
 * for schools that never touch their templates.
 */

const CAMEL_TO_SNAKE = {
  studentName: 'student_name',
  parentName: 'parent_name',
  className: 'class_name',
  schoolName: 'school_name',
  date: 'date',
  time: 'time',
  amount: 'amount',
  dueDate: 'due_date',
  paymentLink: 'payment_link',
  receiptNumber: 'receipt_number',
  noticeTitle: 'notice_title',
  noticeBody: 'notice_body',
  termName: 'term_name',
  portalLink: 'portal_link',
  subjectName: 'subject_name',
  homeworkTitle: 'homework_title',
};

/** "09:24" | "09:24:10" -> "9:24 am" */
export function formatTime(value) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value ?? ''));
  if (!m) return String(value ?? '');
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'am' : 'pm'}`;
}

const isIsoDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);

/**
 * Raw event data (camelCase or snake_case) -> display strings for one channel.
 * Amounts: "Rs.31,000" on SMS (keeps the SMS in the cheap GSM alphabet), "₹31,000" elsewhere.
 */
export function templateVars(vars = {}, channel = 'sms') {
  const out = {};
  for (const [key, value] of Object.entries(vars ?? {})) {
    if (value === undefined || value === null) continue;
    const name = CAMEL_TO_SNAKE[key] ?? key;
    out[name] = value;
  }
  for (const key of ['date', 'due_date']) {
    if (out[key] instanceof Date || isIsoDate(out[key])) out[key] = formatDate(out[key]);
  }
  if (out.amount !== undefined && /^\d+(\.\d+)?$/.test(String(out.amount))) {
    out.amount = `${channel === 'sms' ? 'Rs.' : '₹'}${formatAmount(out.amount)}`;
  }
  if (out.time !== undefined) out.time = formatTime(out.time);
  for (const key of Object.keys(out)) out[key] = String(out[key]);
  return out;
}

/** Replaces {{name}} placeholders. Unknown placeholders become empty (and are refused when the template is saved). */
export function fill(text, values) {
  return String(text ?? '').replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, name) => values[name] ?? '');
}

const clip = (text, max, ellipsis = '...') => (text.length <= max ? text : `${text.slice(0, Math.max(0, max - ellipsis.length)).trimEnd()}${ellipsis}`);

/** Keeps an SMS within 2 segments (306 GSM characters) by shortening the longest variable. */
function fitSms(text, values, body) {
  const LIMIT = 306;
  if (text.length <= LIMIT) return text;
  const longest = Object.keys(values).sort((a, b) => values[b].length - values[a].length)[0];
  if (!longest) return clip(text, LIMIT);
  const over = text.length - LIMIT;
  const shortened = { ...values, [longest]: clip(values[longest], Math.max(20, values[longest].length - over)) };
  return clip(fill(body, shortened), LIMIT);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Plain text -> a small, safe HTML email (paragraphs, links). */
export function emailHtml(text, { schoolName } = {}) {
  const paragraphs = String(text)
    .split(/\n{2,}/)
    .map((p) => escapeHtml(p).replace(/\n/g, '<br>').replace(/(https:\/\/[^\s<]+)/g, '<a href="$1">$1</a>'))
    .map((p) => `<p style="margin:0 0 14px">${p}</p>`)
    .join('');
  const header = schoolName ? `<p style="margin:0 0 18px;font-weight:600;color:#0e1a33">${escapeHtml(schoolName)}</p>` : '';
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1e293b"><div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:24px">${header}${paragraphs}</div></body></html>`;
}

/**
 * One channel's rendering from a template ({ body, subject?, name?, language?, params? }).
 */
export function renderChannel(channel, template, rawVars) {
  const values = templateVars(rawVars, channel);
  if (channel === 'sms') {
    const text = fitSms(fill(template.body, values), values, template.body);
    return { text, variables: (template.params ?? []).map((p) => values[p] ?? ''), templateId: template.custom ? template.name || null : null };
  }
  if (channel === 'whatsapp') {
    const params = template.params ?? [];
    // Meta allows up to 1024 characters per body parameter.
    const variables = Object.fromEntries(params.map((p, i) => [String(i + 1), clip(values[p] ?? '', 1000, '…')]));
    return {
      variables,
      // `name` only for the school's own template: providers then use it instead of their configured default.
      name: template.custom ? template.name || null : null,
      defaultName: template.custom ? null : template.name ?? null,
      language: template.language ?? 'en',
      params,
      text: fill(template.body ?? '', values),
    };
  }
  if (channel === 'email') {
    const text = fill(template.body, values);
    return { subject: clip(fill(template.subject ?? '', values).replace(/\s+/g, ' ').trim(), 200, '…'), text, html: emailHtml(text, { schoolName: values.school_name }) };
  }
  throw new Error(`Unknown channel ${channel}`);
}

/** The catalog default template for an event + channel. */
export function defaultTemplate(eventType, channel) {
  return EVENTS[eventType]?.templates?.[channel] ?? null;
}

/**
 * Every channel's rendering for an event.
 * @param {string} eventType       catalog key (or a legacy template key with a templates.js renderer)
 * @param {object} vars            camelCase or snake_case values
 * @param {Record<string, object>} [custom]  the school's saved templates by channel
 */
export function renderEvent(eventType, vars, custom = {}) {
  const legacy = TEMPLATES[eventType];
  const out = {};
  const legacyRendered = legacy && (!custom.sms || !custom.whatsapp) ? legacy.render(vars) : null;

  for (const channel of ['sms', 'whatsapp', 'email']) {
    const own = custom[channel];
    if (own) {
      out[channel] = renderChannel(channel, { ...own, custom: true }, vars);
      continue;
    }
    if (legacyRendered && channel !== 'email') {
      const base = defaultTemplate(eventType, channel);
      out[channel] = channel === 'whatsapp'
        ? { ...legacyRendered.whatsapp, name: null, defaultName: base?.name ?? null, language: base?.language ?? 'en', params: base?.params ?? [] }
        : { ...legacyRendered.sms, templateId: null };
      continue;
    }
    const base = defaultTemplate(eventType, channel);
    if (base) out[channel] = renderChannel(channel, base, vars);
  }
  return out;
}
