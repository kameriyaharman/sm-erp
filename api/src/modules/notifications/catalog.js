/**
 * Event catalog: every automatic message SM ERP can send, the variables each one offers, the
 * school's default rule, and the default text per channel.
 *
 * A school changes the rule (on/off, channels in fallback order, who gets it, when) under
 * Settings -> Notification rules, and the text under Settings -> Message templates. Without a
 * saved template the defaults below are used; they match the DLT-registered SMS texts and the
 * WhatsApp template names already used by the platform account (wati.provider.js).
 *
 * Variables are snake_case placeholders: {{student_name}}. In WhatsApp templates the ordered
 * `params` list says which variable goes into {{1}}, {{2}}, ... of the approved template.
 */

export const CHANNELS = Object.freeze(['whatsapp', 'sms', 'email']);
export const AUDIENCES = Object.freeze(['guardians', 'primary_parent']);

/** Shared variable descriptions (label + sample value for previews). */
export const VARIABLES = Object.freeze({
  student_name: { label: 'Student name', sample: 'Aarav Sharma' },
  parent_name: { label: 'Parent name', sample: 'Ravi Sharma' },
  class_name: { label: 'Class and section', sample: 'Class 7 A' },
  school_name: { label: 'School name', sample: 'Demo Public School, Main Campus' },
  date: { label: 'Date', sample: 'Fri 2 Oct 2026' },
  time: { label: 'Time', sample: '9:24 am' },
  amount: { label: 'Amount', sample: 'Rs.31,000' },
  due_date: { label: 'Due date', sample: 'Sat 10 Oct 2026' },
  payment_link: { label: 'Payment link', sample: 'https://app.example.in/parent/fees' },
  receipt_number: { label: 'Receipt number', sample: 'MAIN/RCT/2026-27/00042' },
  notice_title: { label: 'Notice title', sample: 'School closed on Monday' },
  notice_body: { label: 'Notice text', sample: 'The school will remain closed on Monday for Dussehra.' },
  term_name: { label: 'Term', sample: 'Term 1' },
  portal_link: { label: 'Portal link', sample: 'https://app.example.in/parent' },
  subject_name: { label: 'Subject', sample: 'Mathematics' },
  homework_title: { label: 'Homework title', sample: 'Exercise 4.2, questions 1-10' },
});

/**
 * @typedef {{ body: string, name?: string, language?: string, params?: string[], subject?: string }} DefaultTemplate
 * @typedef {{ mode: 'immediate' } | { mode: 'delay', minutes: number } | { mode: 'at_time', time: string }
 *          | { mode: 'scheduled', time: string, daysBefore?: number, includeOverdue?: boolean, autoRun?: boolean }} Timing
 */
export const EVENTS = Object.freeze({
  absentee_alert: {
    label: 'Student absent',
    group: 'Attendance',
    description: 'When a student is marked absent (by the class teacher, or by the device cut-off).',
    variables: ['student_name', 'class_name', 'school_name', 'date'],
    timingModes: ['immediate', 'delay', 'at_time'],
    defaultRule: { enabled: true, channels: ['whatsapp', 'sms'], audience: 'guardians', timing: { mode: 'immediate' } },
    templates: {
      sms: { body: 'Dear Parent, {{student_name}} was marked absent at {{school_name}} on {{date}}. If this is unexpected, please contact the school office.', params: ['student_name', 'school_name', 'date'] },
      whatsapp: { name: 'absentee_alert', language: 'en', params: ['student_name', 'school_name', 'date'], body: 'Dear Parent, {{student_name}} was marked absent at {{school_name}} on {{date}}. If this is unexpected, please contact the school office.' },
      email: { subject: '{{student_name}} was absent on {{date}}', body: 'Dear Parent,\n\n{{student_name}} ({{class_name}}) was marked absent at {{school_name}} on {{date}}.\n\nIf this is unexpected, please contact the school office.' },
    },
  },
  late_arrival: {
    label: 'Late arrival',
    group: 'Attendance',
    description: 'When a student is marked late, or reaches the gate after the late time.',
    variables: ['student_name', 'class_name', 'school_name', 'date', 'time'],
    timingModes: ['immediate', 'delay'],
    defaultRule: { enabled: false, channels: ['whatsapp', 'sms'], audience: 'guardians', timing: { mode: 'immediate' } },
    templates: {
      sms: { body: 'Dear Parent, {{student_name}} reached {{school_name}} late on {{date}} at {{time}}.', params: ['student_name', 'school_name', 'date', 'time'] },
      whatsapp: { name: 'late_arrival', language: 'en', params: ['student_name', 'school_name', 'date', 'time'], body: 'Dear Parent, {{student_name}} reached {{school_name}} late on {{date}} at {{time}}.' },
      email: { subject: '{{student_name}} was late on {{date}}', body: 'Dear Parent,\n\n{{student_name}} ({{class_name}}) reached {{school_name}} late on {{date}} at {{time}}.' },
    },
  },
  attendance_correction: {
    label: 'Absence corrected',
    group: 'Attendance',
    description: 'When an absence that was already reported is changed to present.',
    variables: ['student_name', 'school_name', 'date'],
    timingModes: ['immediate'],
    defaultRule: { enabled: true, channels: ['whatsapp', 'sms'], audience: 'guardians', timing: { mode: 'immediate' } },
    templates: {
      sms: { body: 'Dear Parent, update from {{school_name}}: {{student_name}} has been marked present on {{date}}. Please ignore the earlier absence message.', params: ['school_name', 'student_name', 'date'] },
      whatsapp: { name: 'attendance_correction', language: 'en', params: ['school_name', 'student_name', 'date'], body: 'Dear Parent, update from {{school_name}}: {{student_name}} has been marked present on {{date}}. Please ignore the earlier absence message.' },
      email: { subject: 'Correction: {{student_name}} was present on {{date}}', body: 'Dear Parent,\n\nUpdate from {{school_name}}: {{student_name}} has been marked present on {{date}}. Please ignore the earlier absence message.' },
    },
  },
  gate_entry: {
    label: 'Reached school',
    group: 'Attendance',
    description: 'When a student taps their card or face at the gate device in the morning.',
    variables: ['student_name', 'school_name', 'date', 'time'],
    timingModes: ['immediate'],
    defaultRule: { enabled: false, channels: ['whatsapp'], audience: 'guardians', timing: { mode: 'immediate' } },
    templates: {
      sms: { body: 'Dear Parent, {{student_name}} reached {{school_name}} at {{time}} on {{date}}.', params: ['student_name', 'school_name', 'time', 'date'] },
      whatsapp: { name: 'gate_entry', language: 'en', params: ['student_name', 'school_name', 'time', 'date'], body: 'Dear Parent, {{student_name}} reached {{school_name}} at {{time}} on {{date}}.' },
      email: { subject: '{{student_name}} reached school at {{time}}', body: 'Dear Parent,\n\n{{student_name}} reached {{school_name}} at {{time}} on {{date}}.' },
    },
  },
  fee_due_reminder: {
    label: 'Fee due reminder',
    group: 'Fees',
    description: 'Before and after the due date of open fee instalments, with a link to pay online.',
    alwaysOn: true, // "Send reminders now" always works; the rule sets channels and the automatic daily run
    variables: ['parent_name', 'student_name', 'amount', 'due_date', 'school_name', 'payment_link'],
    timingModes: ['scheduled'],
    defaultRule: { enabled: true, channels: ['whatsapp', 'sms'], audience: 'guardians', timing: { mode: 'scheduled', time: '09:00', daysBefore: 3, includeOverdue: true, everyDays: 3, autoRun: false } },
    templates: {
      sms: { body: 'Dear {{parent_name}}, fee of {{amount}} is due on {{due_date}} at {{school_name}}. Pay online: {{payment_link}}', params: ['parent_name', 'amount', 'due_date', 'school_name', 'payment_link'] },
      whatsapp: { name: 'fee_due_reminder', language: 'en', params: ['parent_name', 'amount', 'due_date', 'school_name', 'payment_link'], body: 'Dear {{parent_name}}, fee of {{amount}} is due on {{due_date}} at {{school_name}}. Pay online: {{payment_link}}' },
      email: { subject: 'Fee of {{amount}} due on {{due_date}}', body: 'Dear {{parent_name}},\n\nA fee of {{amount}} is due on {{due_date}} at {{school_name}}.\n\nPay online: {{payment_link}}' },
    },
  },
  fee_receipt: {
    label: 'Fee received',
    group: 'Fees',
    description: 'When a fee payment is recorded at the counter or paid online.',
    variables: ['parent_name', 'student_name', 'amount', 'receipt_number', 'date', 'school_name'],
    timingModes: ['immediate'],
    defaultRule: { enabled: false, channels: ['whatsapp', 'email'], audience: 'primary_parent', timing: { mode: 'immediate' } },
    templates: {
      sms: { body: 'Dear {{parent_name}}, {{school_name}} received {{amount}} for {{student_name}} on {{date}}. Receipt no. {{receipt_number}}.', params: ['parent_name', 'school_name', 'amount', 'student_name', 'date', 'receipt_number'] },
      whatsapp: { name: 'fee_receipt', language: 'en', params: ['parent_name', 'school_name', 'amount', 'student_name', 'date', 'receipt_number'], body: 'Dear {{parent_name}}, {{school_name}} received {{amount}} for {{student_name}} on {{date}}. Receipt no. {{receipt_number}}.' },
      email: { subject: 'Fee receipt {{receipt_number}}', body: 'Dear {{parent_name}},\n\n{{school_name}} has received {{amount}} for {{student_name}} on {{date}}.\n\nReceipt number: {{receipt_number}}. You can download the receipt from the parent portal.' },
    },
  },
  general_notice: {
    label: 'Notice / announcement',
    group: 'Communication',
    description: 'When the office posts a notice with "Also send by SMS / WhatsApp", or sends a broadcast.',
    alwaysOn: true, // sent only when the office asks for it; the rule sets the channels
    variables: ['school_name', 'notice_title', 'notice_body'],
    timingModes: ['immediate'],
    defaultRule: { enabled: true, channels: ['whatsapp', 'sms'], audience: 'guardians', timing: { mode: 'immediate' } },
    templates: {
      sms: { body: '{{school_name}}: {{notice_title}}. {{notice_body}} Details in the school app.', params: ['school_name', 'notice_title', 'notice_body'] },
      whatsapp: { name: 'school_notice', language: 'en', params: ['school_name', 'notice_title', 'notice_body'], body: '{{school_name}}: {{notice_title}}\n\n{{notice_body}}' },
      email: { subject: '{{notice_title}}', body: '{{notice_body}}\n\n{{school_name}}' },
    },
  },
  report_card_published: {
    label: 'Report card published',
    group: 'Academics',
    description: 'When the office publishes report cards for a class.',
    variables: ['student_name', 'term_name', 'school_name', 'portal_link'],
    timingModes: ['immediate'],
    defaultRule: { enabled: false, channels: ['whatsapp', 'email'], audience: 'guardians', timing: { mode: 'immediate' } },
    templates: {
      sms: { body: 'Dear Parent, the {{term_name}} report card of {{student_name}} is published by {{school_name}}. View it at {{portal_link}}', params: ['term_name', 'student_name', 'school_name', 'portal_link'] },
      whatsapp: { name: 'report_card_published', language: 'en', params: ['term_name', 'student_name', 'school_name', 'portal_link'], body: 'Dear Parent, the {{term_name}} report card of {{student_name}} is published by {{school_name}}. View it at {{portal_link}}' },
      email: { subject: 'Report card of {{student_name}} ({{term_name}})', body: 'Dear Parent,\n\nThe {{term_name}} report card of {{student_name}} has been published by {{school_name}}.\n\nView and download it at {{portal_link}}' },
    },
  },
  homework_assigned: {
    label: 'Homework set',
    group: 'Academics',
    description: 'When a teacher sets homework for a section.',
    variables: ['student_name', 'class_name', 'subject_name', 'homework_title', 'due_date', 'school_name'],
    timingModes: ['immediate', 'at_time'],
    defaultRule: { enabled: false, channels: ['whatsapp'], audience: 'primary_parent', timing: { mode: 'immediate' } },
    templates: {
      sms: { body: 'Dear Parent, new {{subject_name}} homework for {{class_name}}: {{homework_title}}. Due {{due_date}}. - {{school_name}}', params: ['subject_name', 'class_name', 'homework_title', 'due_date', 'school_name'] },
      whatsapp: { name: 'homework_assigned', language: 'en', params: ['subject_name', 'class_name', 'homework_title', 'due_date', 'school_name'], body: 'Dear Parent, new {{subject_name}} homework for {{class_name}}: {{homework_title}}. Due {{due_date}}. - {{school_name}}' },
      email: { subject: '{{subject_name}} homework for {{class_name}}', body: 'Dear Parent,\n\nNew {{subject_name}} homework for {{class_name}}: {{homework_title}}.\nDue: {{due_date}}.\n\n{{school_name}}' },
    },
  },
  birthday_wish: {
    label: 'Birthday wish',
    group: 'Communication',
    description: "On a student's birthday, at the time you choose.",
    variables: ['student_name', 'school_name'],
    timingModes: ['scheduled'],
    defaultRule: { enabled: false, channels: ['whatsapp'], audience: 'primary_parent', timing: { mode: 'scheduled', time: '08:00', autoRun: true } },
    templates: {
      sms: { body: 'Happy birthday, {{student_name}}! Best wishes from everyone at {{school_name}}.', params: ['student_name', 'school_name'] },
      whatsapp: { name: 'birthday_wish', language: 'en', params: ['student_name', 'school_name'], body: 'Happy birthday, {{student_name}}! Best wishes from everyone at {{school_name}}.' },
      email: { subject: 'Happy birthday, {{student_name}}!', body: 'Happy birthday, {{student_name}}!\n\nBest wishes from everyone at {{school_name}}.' },
    },
  },
});

export const EVENT_KEYS = Object.freeze(Object.keys(EVENTS));

/** Placeholders used in a template body, in order of first use. */
export function placeholdersOf(text) {
  const seen = [];
  for (const m of String(text ?? '').matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) if (!seen.includes(m[1])) seen.push(m[1]);
  return seen;
}

/** Problems with a template body for an event: unknown placeholders. Returns [] when fine. */
export function templateProblems(eventType, text) {
  const allowed = new Set(EVENTS[eventType]?.variables ?? []);
  return placeholdersOf(text).filter((p) => !allowed.has(p)).map((p) => `{{${p}}} is not available for this message`);
}

/** The default rule for an event (a fresh copy). */
export function defaultRule(eventType) {
  const d = EVENTS[eventType]?.defaultRule;
  return d ? structuredClone(d) : null;
}
