// SaaS settings engine: plans and modules, templates and rendering, per-school delivery
// (rules, channels, e-mail), WhatsApp Cloud API and SMTP providers, device punches and the
// ADMS protocol, settings sections, time-zone helpers. No database needed.
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';

// Modules below read the app config: a minimal valid environment before importing them.
Object.assign(process.env, {
  DATABASE_URL: 'postgres://u:p@127.0.0.1:1/x',
  JWT_ACCESS_SECRET: 'x'.repeat(48),
  SETTINGS_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  NOTIFY_SMS_PROVIDER: 'none',
  NOTIFY_WHATSAPP_PROVIDER: 'none',
  NOTIFY_EMAIL_PROVIDER: 'none',
});

const { CORE_MODULES, effectiveLimits, effectiveModules } = await import('../src/config/modules.js');
const { EVENTS, placeholdersOf, templateProblems, defaultRule } = await import('../src/modules/notifications/catalog.js');
const { renderEvent, renderChannel, templateVars, formatTime, fill } = await import('../src/modules/notifications/render.js');
const { TEMPLATES } = await import('../src/modules/notifications/templates.js');
const { NotificationService } = await import('../src/modules/notifications/NotificationService.js');
const { NotificationError } = await import('../src/modules/notifications/errors.js');
const { MetaCloudProvider } = await import('../src/modules/notifications/providers/meta-cloud.provider.js');
const { SmtpEmailProvider, mapSmtpError } = await import('../src/modules/notifications/providers/email.provider.js');
const { SimulatedProvider } = await import('../src/modules/notifications/providers/simulated.provider.js');
const { PROVIDERS } = await import('../src/modules/notifications/channel-registry.js');
const { sealChannelSecrets, openChannelSecrets } = await import('../src/modules/notifications/tenant-resolver.js');
const { SECTIONS, dayOff, mergeSettings, resolveSection } = await import('../src/modules/settings/sections.js');
const { diffValues } = await import('../src/modules/settings/audit.js');
const { numberedBody } = await import('../src/modules/settings/templates.service.js');
const { localParts, sendAtFor, zonedToUtc } = await import('../src/utils/time.js');
const { parseAttlog, parsePunchTime } = await import('../src/modules/devices/devices.routes.js');
const { hashKey, newDeviceKey } = await import('../src/modules/devices/punch.service.js');

const silent = { info() {}, warn() {}, error() {} };

// ---------------------------------------------------------------- plans and modules

describe('plans and modules', () => {
  test('core modules are always on; plan modules, overrides and school switches combine', () => {
    const r = effectiveModules({ planModules: ['exams', 'transport', 'sms'], overrides: { whatsapp: true, transport: false }, schoolDisabled: ['exams', 'students'] });
    for (const core of CORE_MODULES) assert.ok(r.enabled.includes(core), core);
    assert.ok(r.available.includes('whatsapp'), 'granted by override');
    assert.ok(!r.available.includes('transport'), 'revoked by override');
    assert.ok(r.available.includes('exams') && !r.enabled.includes('exams'), 'in plan, switched off by the school');
    assert.ok(r.enabled.includes('students'), 'a school cannot switch off a core module');
  });

  test('unknown module keys are ignored', () => {
    const r = effectiveModules({ planModules: ['nope'], overrides: { alsoNope: true } });
    assert.deepEqual(r.enabled, [...CORE_MODULES]);
  });

  test('limits: plan values with per-school overrides; missing = unlimited', () => {
    assert.deepEqual(effectiveLimits({ maxStudents: 500, smsPerMonth: 2000 }, { maxStudents: 800, whatsappPerMonth: null }), {
      maxStudents: 800, maxBranches: null, whatsappPerMonth: null, smsPerMonth: 2000, emailsPerMonth: null,
    });
  });
});

// ---------------------------------------------------------------- catalog + rendering

describe('message catalog and rendering', () => {
  test('every event has a default rule, valid templates for all channels and only its own variables', () => {
    for (const [key, e] of Object.entries(EVENTS)) {
      assert.ok(defaultRule(key), key);
      assert.ok(e.timingModes.includes(e.defaultRule.timing.mode), `${key}: default timing allowed`);
      for (const channel of ['sms', 'whatsapp', 'email']) {
        const t = e.templates[channel];
        assert.ok(t?.body, `${key}/${channel}`);
        assert.deepEqual(templateProblems(key, t.body), [], `${key}/${channel} body`);
        if (channel === 'email') assert.deepEqual(templateProblems(key, t.subject), [], `${key} subject`);
        if (channel !== 'email') for (const p of t.params) assert.ok(e.variables.includes(p), `${key}/${channel} param ${p}`);
      }
    }
  });

  test('placeholders and problems', () => {
    assert.deepEqual(placeholdersOf('Hi {{ parent_name }}, {{amount}} for {{parent_name}}'), ['parent_name', 'amount']);
    assert.deepEqual(templateProblems('absentee_alert', 'Hi {{student_name}} {{amount}}'), ['{{amount}} is not available for this message']);
  });

  test('without school templates the original four messages render exactly as before', () => {
    const cases = {
      absentee_alert: { studentName: 'Aarav Sharma', date: '2026-10-02', schoolName: 'DPS' },
      attendance_correction: { studentName: 'Aarav Sharma', date: '2026-10-02', schoolName: 'DPS' },
      fee_due_reminder: { parentName: 'Ravi', amount: 31000, dueDate: '2026-10-10', paymentLink: 'https://x.in/p', schoolName: 'DPS' },
      general_notice: { noticeTitle: 'Closed', noticeBody: 'Closed on Monday', schoolName: 'DPS' },
    };
    for (const [key, vars] of Object.entries(cases)) {
      const legacy = TEMPLATES[key].render(vars);
      const now = renderEvent(key, vars);
      assert.equal(now.sms.text, legacy.sms.text, key);
      assert.deepEqual(now.sms.variables, legacy.sms.variables, key);
      assert.deepEqual(now.whatsapp.variables, legacy.whatsapp.variables, key);
      assert.equal(now.whatsapp.name, null, 'providers keep using their configured template names');
      assert.ok(now.email.subject && now.email.html.includes('<p'), `${key} gets an email too`);
    }
  });

  test('amounts: Rs. on SMS (GSM), ₹ elsewhere; dates and times formatted', () => {
    assert.equal(templateVars({ amount: '4500.50' }, 'sms').amount, 'Rs.4,500.50');
    assert.equal(templateVars({ amount: 31000 }, 'whatsapp').amount, '₹31,000');
    assert.equal(templateVars({ date: '2026-10-09' }).date, 'Fri 9 Oct 2026');
    assert.equal(formatTime('08:05'), '8:05 am');
    assert.equal(formatTime('13:40:12'), '1:40 pm');
    assert.equal(formatTime('00:10'), '12:10 am');
  });

  test("a school's own templates: SMS DLT ID, WhatsApp name + parameter order, email", () => {
    const custom = {
      sms: { body: 'Absent: {{student_name}} on {{date}}. -{{school_name}}', name: '1207161234567890123', params: [] },
      whatsapp: { name: 'student_absent_v2', language: 'hi', params: ['date', 'student_name'], body: '{{student_name}} {{date}}' },
      email: { subject: '{{student_name}} absent', body: 'Dear parent,\n\nSee https://x.in/a' },
    };
    const r = renderEvent('absentee_alert', { studentName: 'Aarav', date: '2026-10-02', schoolName: 'DPS' }, custom);
    assert.equal(r.sms.text, 'Absent: Aarav on Fri 2 Oct 2026. -DPS');
    assert.equal(r.sms.templateId, '1207161234567890123');
    assert.deepEqual(r.whatsapp.variables, { 1: 'Fri 2 Oct 2026', 2: 'Aarav' });
    assert.equal(r.whatsapp.name, 'student_absent_v2');
    assert.equal(r.whatsapp.language, 'hi');
    assert.equal(r.email.subject, 'Aarav absent');
    assert.match(r.email.html, /<a href="https:\/\/x.in\/a">/);
  });

  test('email HTML escapes the data', () => {
    const r = renderChannel('email', { subject: 'x', body: '{{notice_body}}' }, { noticeBody: '<script>alert(1)</script>' });
    assert.ok(!r.html.includes('<script>'));
    assert.ok(r.html.includes('&lt;script&gt;'));
  });

  test('long SMS is shortened to 2 segments by clipping the longest value', () => {
    const r = renderChannel('sms', { body: '{{school_name}}: {{notice_title}}. {{notice_body}}' }, { schoolName: 'DPS', noticeTitle: 'T', noticeBody: 'word '.repeat(200) });
    assert.ok(r.text.length <= 306, String(r.text.length));
    assert.ok(r.text.startsWith('DPS: T. word'));
  });

  test('WhatsApp body for Meta uses {{1}}, {{2}} in order of appearance', () => {
    assert.equal(numberedBody('Dear {{parent_name}}, {{amount}} for {{student_name}}. {{amount}}', ['parent_name', 'amount', 'student_name']), 'Dear {{1}}, {{2}} for {{3}}. {{2}}');
    assert.equal(fill('{{a}}-{{b}}', { a: '1' }), '1-');
  });
});

// ---------------------------------------------------------------- NotificationService with a school's setup

function setupStub({ rule, providers, templates = {}, accounts = {}, displayName = null }) {
  return {
    resolve: async () => ({
      providers,
      accounts,
      problems: {},
      displayName,
      rule: () => rule,
      templates: (e) => templates[e] ?? {},
    }),
  };
}

function emailCapture() {
  const sent = [];
  return { sent, provider: { name: 'smtp', supports: (c) => c === 'email', send: async (m) => (sent.push(m), { providerMessageId: `M${sent.length}` }) } };
}

describe('NotificationService per school', () => {
  test('a rule switched off skips the message (nothing logged, nothing sent)', async () => {
    const wa = new SimulatedProvider({ channels: ['whatsapp'], latencyMs: 0 });
    const svc = new NotificationService({ providers: {}, logger: silent, tenantResolver: setupStub({ rule: { enabled: false, channels: ['whatsapp'] }, providers: { whatsapp: wa } }) });
    const r = await svc.sendEvent('gate_entry', { phone: '9811042231' }, { studentName: 'A', date: '2026-10-09', time: '08:00' }, { tenantId: 't1' });
    assert.equal(r.skipped, 'RULE_DISABLED');
    assert.equal(wa.outbox.length, 0);
  });

  test("always-on messages (notices) ignore 'enabled' but use the rule's channels", async () => {
    const mail = emailCapture();
    const wa = new SimulatedProvider({ channels: ['whatsapp'], latencyMs: 0 });
    const svc = new NotificationService({ providers: {}, logger: silent, tenantResolver: setupStub({ rule: { enabled: false, channels: ['email'] }, providers: { whatsapp: wa, email: mail.provider } }) });
    const r = await svc.sendEvent('general_notice', { phone: '9811042231', email: 'p@x.in' }, { noticeTitle: 'T', noticeBody: 'B' }, { tenantId: 't1' });
    assert.equal(r.ok, true);
    assert.equal(r.channel, 'email');
    assert.equal(wa.outbox.length, 0);
  });

  test('no phone: falls through WhatsApp / SMS to e-mail', async () => {
    const mail = emailCapture();
    const wa = new SimulatedProvider({ channels: ['whatsapp'], latencyMs: 0 });
    const svc = new NotificationService({
      providers: {},
      logger: silent,
      tenantResolver: setupStub({ rule: { enabled: true, channels: ['whatsapp', 'sms', 'email'] }, providers: { whatsapp: wa, email: mail.provider }, accounts: { email: 'school' } }),
    });
    const r = await svc.sendEvent('fee_receipt', { phone: null, email: 'parent@x.in' }, { parentName: 'Ravi', studentName: 'Aarav', amount: '4500', receiptNumber: 'R/1', date: '2026-10-09', schoolName: 'DPS' }, { tenantId: 't1' });
    assert.equal(r.ok, true);
    assert.equal(r.channel, 'email');
    assert.equal(r.account, 'school');
    assert.equal(mail.sent[0].to, 'parent@x.in');
    assert.match(mail.sent[0].rendered.email.subject, /Fee receipt R\/1/);
    assert.match(mail.sent[0].rendered.email.text, /₹4,500/);
  });

  test("the school's display name replaces the school name in messages", async () => {
    const wa = new SimulatedProvider({ channels: ['whatsapp'], latencyMs: 0 });
    const svc = new NotificationService({ providers: {}, logger: silent, tenantResolver: setupStub({ rule: { enabled: true, channels: ['whatsapp'] }, providers: { whatsapp: wa }, displayName: 'DPS Dwarka' }) });
    await svc.sendAbsenteeAlert('9811042231', 'Aarav', '2026-10-02', { tenantId: 't1', schoolName: 'Delhi Public School, Dwarka Campus' });
    assert.match(wa.outbox[0].text, /DPS Dwarka/);
  });

  test('custom WhatsApp template reaches the provider with its name and parameter order', async () => {
    const seen = [];
    const wa = { name: 'meta_cloud', supports: (c) => c === 'whatsapp', send: async (m) => (seen.push(m), { providerMessageId: 'wamid.1' }) };
    const svc = new NotificationService({
      providers: {},
      logger: silent,
      tenantResolver: setupStub({
        rule: { enabled: true, channels: ['whatsapp'] },
        providers: { whatsapp: wa },
        templates: { late_arrival: { whatsapp: { name: 'late_v1', params: ['time', 'student_name'], body: '{{student_name}} at {{time}}', language: 'en' } } },
      }),
    });
    const r = await svc.sendEvent('late_arrival', { phone: '+919811042231' }, { studentName: 'Aarav', date: '2026-10-09', time: '08:41', schoolName: 'DPS' }, { tenantId: 't1' });
    assert.equal(r.ok, true);
    assert.equal(seen[0].rendered.whatsapp.name, 'late_v1');
    assert.deepEqual(seen[0].rendered.whatsapp.variables, { 1: '8:41 am', 2: 'Aarav' });
  });

  test('no school setup: the platform providers behave exactly as before', async () => {
    const sms = new SimulatedProvider({ channels: ['sms'], latencyMs: 0 });
    const svc = new NotificationService({ providers: { sms }, logger: silent, channelOrder: ['whatsapp', 'sms'] });
    const r = await svc.sendAbsenteeAlert('98110 42231', 'Aarav Sharma', '2026-10-02');
    assert.equal(r.ok, true);
    assert.equal(r.channel, 'sms');
    assert.equal(r.account, 'platform');
  });

  test('neither phone nor email: a clear error, no send', async () => {
    const svc = new NotificationService({ providers: {}, logger: silent });
    const r = await svc.sendEvent('fee_receipt', { phone: null, email: null }, {}, {});
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'NO_ADDRESS');
  });
});

// ---------------------------------------------------------------- channel credentials

describe('school channel credentials', () => {
  test('secrets are sealed per school and channel', () => {
    const sealed = sealChannelSecrets('school-a', 'whatsapp', { accessToken: 'EAAG-secret' });
    assert.ok(!sealed.includes('EAAG'));
    assert.deepEqual(openChannelSecrets('school-a', 'whatsapp', sealed), { accessToken: 'EAAG-secret' });
    assert.throws(() => openChannelSecrets('school-b', 'whatsapp', sealed));
    assert.throws(() => openChannelSecrets('school-a', 'sms', sealed));
  });

  test('provider config validation', () => {
    assert.equal(PROVIDERS.whatsapp.meta_cloud.config.safeParse({ phoneNumberId: '1234567890', wabaId: '9876543210' }).success, true);
    assert.equal(PROVIDERS.whatsapp.meta_cloud.config.safeParse({ phoneNumberId: 'abc', wabaId: '1' }).success, false);
    assert.equal(PROVIDERS.sms.msg91.config.safeParse({ senderId: 'DPSDWK' }).success, true);
    assert.equal(PROVIDERS.sms.msg91.config.safeParse({ senderId: 'dps' }).success, false);
    assert.equal(PROVIDERS.sms.twilio.config.safeParse({ accountSid: `AC${'a'.repeat(32)}` }).success, false, 'needs a sender');
    assert.equal(PROVIDERS.email.smtp.config.safeParse({ host: 'smtp.gmail.com', user: 'a@b.in', fromEmail: 'a@b.in' }).data.port, 587);
  });
});

// ---------------------------------------------------------------- WhatsApp Cloud API (fake Graph API)

describe('MetaCloudProvider', () => {
  const requests = [];
  let script = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, json: raw ? JSON.parse(raw) : null });
      const { status, body } = (script.shift() ?? (() => ({ status: 500, body: {} })))();
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  let base;
  before(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());
  beforeEach(() => {
    requests.length = 0;
    script = [];
  });
  const meta = () => new MetaCloudProvider({ phoneNumberId: '1111', wabaId: '2222', accessToken: 'EAAG-token', baseUrl: base, graphVersion: 'v25.0', timeoutMs: 500 });
  const rendered = renderEvent('absentee_alert', { studentName: 'Aarav', date: '2026-10-02', schoolName: 'DPS' });

  test('sends an approved template with body parameters', async () => {
    script.push(() => ({ status: 200, body: { messaging_product: 'whatsapp', messages: [{ id: 'wamid.ABC', message_status: 'accepted' }] } }));
    const r = await meta().send({ channel: 'whatsapp', to: '+919811042231', template: 'absentee_alert', rendered });
    assert.equal(r.providerMessageId, 'wamid.ABC');
    const req = requests[0];
    assert.equal(req.url, '/v25.0/1111/messages');
    assert.equal(req.headers.authorization, 'Bearer EAAG-token');
    assert.equal(req.json.to, '919811042231');
    assert.equal(req.json.template.name, 'absentee_alert', 'catalog default name when the school has no own template');
    assert.deepEqual(req.json.template.components[0].parameters.map((p) => p.text), ['Aarav', 'DPS', 'Fri 2 Oct 2026']);
  });

  test('"undeliverable" lets the next channel (SMS) try; an expired token does not', async () => {
    script.push(() => ({ status: 400, body: { error: { code: 131026, message: 'Message undeliverable' } } }));
    await assert.rejects(meta().send({ channel: 'whatsapp', to: '+919811042231', template: 'absentee_alert', rendered }), (e) => e.code === 'NOT_ON_WHATSAPP' && e.tryNextChannel);
    script.push(() => ({ status: 401, body: { error: { code: 190, message: 'Session expired' } } }));
    await assert.rejects(meta().send({ channel: 'whatsapp', to: '+919811042231', template: 'absentee_alert', rendered }), (e) => e.code === 'AUTH_FAILED' && !e.tryNextChannel);
    script.push(() => ({ status: 429, body: { error: { code: 130429, message: 'Rate limit' } } }));
    await assert.rejects(meta().send({ channel: 'whatsapp', to: '+919811042231', template: 'absentee_alert', rendered }), (e) => e.retryable);
  });

  test('verify, list and submit templates', async () => {
    script.push(() => ({ status: 200, body: { id: '1111', display_phone_number: '+91 98765 43210', verified_name: 'DPS Dwarka', quality_rating: 'GREEN' } }));
    const v = await meta().verify();
    assert.equal(v.ok, true);
    assert.match(v.message, /DPS Dwarka/);

    script.push(() => ({ status: 200, body: { data: [{ id: 't1', name: 'absentee_alert', status: 'APPROVED', language: 'en', category: 'UTILITY', components: [{ type: 'BODY', text: 'Dear {{1}}' }] }, { id: 't2', name: 'x', status: 'REJECTED', rejected_reason: 'INVALID_FORMAT', language: 'en' }] } }));
    const list = await meta().listTemplates();
    assert.deepEqual(list.map((t) => [t.name, t.status, t.rejectedReason]), [['absentee_alert', 'approved', null], ['x', 'rejected', 'INVALID_FORMAT']]);

    script.push(() => ({ status: 200, body: { id: 'tpl-9', status: 'PENDING', category: 'UTILITY' } }));
    const s = await meta().submitTemplate({ name: 'gate_entry', body: 'Dear parent, {{1}} reached at {{2}}', examples: ['Aarav', '8:05 am'] });
    assert.deepEqual(s, { id: 'tpl-9', status: 'pending' });
    assert.equal(requests.at(-1).url, '/v25.0/2222/message_templates');
    assert.deepEqual(requests.at(-1).json.components[0].example.body_text, [['Aarav', '8:05 am']]);
  });

  test('invalid token on verify reads as invalid credentials', async () => {
    script.push(() => ({ status: 401, body: { error: { code: 190, message: 'Invalid OAuth access token' } } }));
    const v = await meta().verify();
    assert.equal(v.ok, false);
    assert.equal(v.reason, 'invalid_credentials');
  });
});

// ---------------------------------------------------------------- SMTP

describe('SmtpEmailProvider', () => {
  test('sends subject, text and html from the rendered message', async () => {
    const mails = [];
    const transport = { sendMail: async (m) => (mails.push(m), { messageId: '<abc@x>', rejected: [] }), verify: async () => true };
    const p = new SmtpEmailProvider({ transport, fromEmail: 'office@school.in', fromName: 'DPS', replyTo: 'principal@school.in' });
    const rendered = renderEvent('fee_receipt', { parentName: 'Ravi', studentName: 'Aarav', amount: 100, receiptNumber: 'R1', date: '2026-10-09', schoolName: 'DPS' });
    const r = await p.send({ channel: 'email', to: 'p@x.in', rendered });
    assert.equal(r.providerMessageId, '<abc@x>');
    assert.deepEqual(mails[0].from, { name: 'DPS', address: 'office@school.in' });
    assert.equal(mails[0].replyTo, 'principal@school.in');
    assert.equal(mails[0].subject, 'Fee receipt R1');
    assert.ok(mails[0].html.includes('Ravi'));
    assert.deepEqual(await p.verify(), { ok: true, message: 'Signed in to the mail server.' });
  });

  test('errors: bad password is permanent, network is retryable, 4xx temporary', () => {
    assert.equal(mapSmtpError({ code: 'EAUTH', responseCode: 535 }).code, 'AUTH_FAILED');
    assert.equal(mapSmtpError({ code: 'ETIMEDOUT' }).retryable, true);
    assert.equal(mapSmtpError({ responseCode: 451, message: 'try later' }).retryable, true);
    assert.equal(mapSmtpError({ responseCode: 550, message: 'no such user' }).retryable, false);
    assert.ok(mapSmtpError(new NotificationError('X', 'y')) instanceof NotificationError);
  });
});

// ---------------------------------------------------------------- settings sections

describe('settings sections', () => {
  test('defaults <- school <- branch, objects merged, arrays replaced', () => {
    assert.deepEqual(mergeSettings({ a: { b: 1, c: 2 }, l: [1, 2] }, { a: { c: 3 }, l: [9] }), { a: { b: 1, c: 3 }, l: [9] });
    const v = resolveSection('attendance', { minPercentage: 80, device: { lateAfter: '08:30' } }, { device: { cutoff: '11:00' } });
    assert.equal(v.minPercentage, 80);
    assert.equal(v.device.lateAfter, '08:30');
    assert.equal(v.device.cutoff, '11:00');
    assert.equal(v.backdateDays.teacher, 1, 'default kept');
  });

  test('a stored value that no longer validates falls back to the defaults', () => {
    assert.deepEqual(resolveSection('calendar', { weeklyOffs: [9] }), SECTIONS.calendar.defaults);
  });

  test('device times must be in order', () => {
    const bad = { ...SECTIONS.attendance.defaults, device: { ...SECTIONS.attendance.defaults.device, lateAfter: '05:00' } };
    assert.equal(SECTIONS.attendance.schema.safeParse(bad).success, false);
  });

  test('holidays and weekly offs', () => {
    const cal = { weeklyOffs: [0, 6], holidays: [{ date: '2026-10-20', name: 'Diwali' }] };
    assert.equal(dayOff(cal, '2026-10-20').name, 'Diwali');
    assert.equal(dayOff(cal, '2026-10-11').weeklyOff, true, 'Sunday');
    assert.equal(dayOff(cal, '2026-10-10').name, 'Saturday');
    assert.equal(dayOff(cal, '2026-10-09'), null);
  });

  test('audit diff lists changed paths only', () => {
    assert.deepEqual(diffValues({ a: 1, b: { c: 2, d: 3 } }, { a: 1, b: { c: 5, d: 3 }, e: true }), { 'b.c': [2, 5], e: [null, true] });
  });
});

// ---------------------------------------------------------------- time zones

describe('time helpers', () => {
  test('school wall-clock <-> UTC (IST)', () => {
    assert.equal(zonedToUtc('2026-10-09', '08:15', 'Asia/Kolkata').toISOString(), '2026-10-09T02:45:00.000Z');
    assert.deepEqual(localParts(new Date('2026-10-09T02:45:00Z'), 'Asia/Kolkata'), { date: '2026-10-09', time: '08:15', weekday: 5 });
    assert.equal(localParts(new Date('2026-10-09T19:00:00Z'), 'Asia/Kolkata').date, '2026-10-10');
  });

  test('send time from a rule', () => {
    const now = new Date('2026-10-09T03:00:00Z'); // 08:30 IST
    assert.equal(sendAtFor({ mode: 'immediate' }, { now }).getTime(), now.getTime());
    assert.equal(sendAtFor({ mode: 'delay', minutes: 30 }, { now }).toISOString(), '2026-10-09T03:30:00.000Z');
    assert.equal(sendAtFor({ mode: 'at_time', time: '10:30' }, { now, timeZone: 'Asia/Kolkata' }).toISOString(), '2026-10-09T05:00:00.000Z');
    assert.equal(sendAtFor({ mode: 'at_time', time: '07:00' }, { now, timeZone: 'Asia/Kolkata' }).getTime(), now.getTime(), 'already passed: now');
  });
});

// ---------------------------------------------------------------- devices

describe('attendance devices', () => {
  test('device keys: prefixed, random, stored as sha256', () => {
    const a = newDeviceKey();
    const b = newDeviceKey();
    assert.match(a.key, /^smd_[A-Za-z0-9_-]{40}$/);
    assert.notEqual(a.key, b.key);
    assert.equal(a.hash, hashKey(a.key));
    assert.equal(a.prefix, a.key.slice(0, 10));
  });

  test('punch time: ISO with offset, or school local time; future refused', () => {
    const now = new Date('2026-10-09T05:00:00Z');
    assert.equal(parsePunchTime('2026-10-09 08:05:12', 'Asia/Kolkata', now).toISOString(), '2026-10-09T02:35:12.000Z');
    assert.equal(parsePunchTime('2026-10-09T08:05:00+05:30', 'Asia/Kolkata', now).toISOString(), '2026-10-09T02:35:00.000Z');
    assert.equal(parsePunchTime(undefined, 'Asia/Kolkata', now), now);
    assert.equal(parsePunchTime('2026-10-09 23:00:00', 'Asia/Kolkata', now), null, 'device clock ahead');
    assert.equal(parsePunchTime('yesterday', 'Asia/Kolkata', now), null);
  });

  test('ADMS ATTLOG lines', () => {
    const lines = parseAttlog('1001\t2026-10-09 08:05:12\t0\t1\t0\t0\r\nbad\n  \nEMP-7\t2026-10-09 07:30\t1\t15\n1002\tnot a date\t0');
    assert.deepEqual(lines, [
      { identifier: '1001', local: '2026-10-09 08:05:12' },
      { identifier: 'EMP-7', local: '2026-10-09 07:30' },
    ]);
  });
});
