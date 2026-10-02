// Run: node --test test/
// Exercises NotificationService against local fake Twilio and MSG91 servers.
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { NotificationService } from '../src/modules/notifications/NotificationService.js';
import { NotificationError } from '../src/modules/notifications/errors.js';
import { maskPhone, normalizePhone } from '../src/modules/notifications/phone.js';
import { TEMPLATES, isGsm7, smsSegments } from '../src/modules/notifications/templates.js';
import { Msg91Provider } from '../src/modules/notifications/providers/msg91.provider.js';
import { SimulatedProvider } from '../src/modules/notifications/providers/simulated.provider.js';
import { TwilioProvider } from '../src/modules/notifications/providers/twilio.provider.js';

// ---------------------------------------------------------------- fake gateway

const requests = [];
let script = []; // queue of (req) => { status, body, delayMs }

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', async () => {
    const entry = { method: req.method, url: req.url, headers: req.headers, raw };
    entry.form = req.headers['content-type']?.includes('urlencoded') ? Object.fromEntries(new URLSearchParams(raw)) : null;
    entry.json = req.headers['content-type']?.includes('json') ? JSON.parse(raw || 'null') : null;
    requests.push(entry);
    const next = script.shift() ?? (() => ({ status: 500, body: { message: 'unscripted' } }));
    const { status, body, delayMs = 0 } = next(entry);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (res.destroyed) return;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
});

let baseUrl;
before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const twilioOk = (status = 'queued') => () => ({ status: 201, body: { sid: `SM${Math.random().toString(16).slice(2, 10)}`, status } });
const twilioErr = (status, code, message) => () => ({ status, body: { code, message, status } });
const msg91Ok = () => () => ({ status: 200, body: { type: 'success', message: '3463706b6f73323831353631' } });

// ---------------------------------------------------------------- helpers

function captureLogger() {
  const lines = [];
  const make = (level) => (message, meta) => lines.push({ level, message, meta });
  return { lines, info: make('info'), warn: make('warn'), error: make('error') };
}

function makeService({ whatsapp = true, sms = 'twilio', contentSids, retry, recipientResolver, timeoutMs = 300 } = {}) {
  const logger = captureLogger();
  const twilio = new TwilioProvider({
    accountSid: 'AC_test_sid',
    authToken: 'super-secret-token',
    smsFrom: '+15005550006',
    whatsappFrom: '+14155238886',
    contentSids: contentSids ?? { absentee_alert: 'HXabsent', fee_due_reminder: 'HXfee', general_notice: 'HXnotice' },
    baseUrl,
    timeoutMs,
  });
  const msg91 = new Msg91Provider({
    authKey: 'msg91-key',
    senderId: 'DPSDWK',
    flowIds: { absentee_alert: 'flow-abs', fee_due_reminder: 'flow-fee', general_notice: 'flow-notice' },
    baseUrl,
    timeoutMs,
  });
  const service = new NotificationService({
    providers: { whatsapp: whatsapp ? twilio : undefined, sms: sms === 'twilio' ? twilio : sms === 'msg91' ? msg91 : sms },
    logger,
    schoolName: 'DPS Dwarka',
    retry: { attempts: 3, baseDelayMs: 1, maxDelayMs: 2, ...retry },
    recipientResolver,
    sleep: async () => {},
  });
  return { service, logger };
}

beforeEach(() => {
  requests.length = 0;
  script = [];
});

// ---------------------------------------------------------------- phone + templates

describe('phone numbers', () => {
  test('normalises common Indian formats to E.164', () => {
    for (const input of ['9811042231', '98110 42231', '098110-42231', '+91 98110 42231', '919811042231']) {
      assert.equal(normalizePhone(input), '+919811042231', input);
    }
  });
  test('rejects landlines, short numbers and junk', () => {
    for (const input of ['12345', '0112508440', '5811042231', '', null, 'call me']) {
      assert.throws(() => normalizePhone(input), (err) => err instanceof NotificationError && err.code === 'INVALID_PHONE', String(input));
    }
  });
  test('keeps foreign numbers already in +E.164', () => {
    assert.equal(normalizePhone('+1 415 523 8886'), '+14155238886');
  });
  test('masks all but country code and last 3 digits', () => {
    assert.equal(maskPhone('+919811042231'), '+91•••••••231');
  });
});

describe('templates', () => {
  test('fee SMS stays in the cheap GSM-7 alphabet (Rs. not ₹)', () => {
    const { sms, whatsapp } = TEMPLATES.fee_due_reminder.render({
      parentName: 'Ravi Sharma', amount: 31000, dueDate: '2026-10-10', paymentLink: 'https://pay.example.in/i/AB12', schoolName: 'DPS Dwarka',
    });
    assert.equal(sms.text, 'Dear Ravi Sharma, fee of Rs.31,000 is due on Sat 10 Oct 2026 at DPS Dwarka. Pay online: https://pay.example.in/i/AB12');
    assert.ok(isGsm7(sms.text));
    assert.equal(smsSegments(sms.text), 1);
    assert.equal(whatsapp.variables[2], '₹31,000'); // WhatsApp has no such limit
    assert.equal(isGsm7('₹31,000'), false);
  });
  test('long notices are clipped to 2 SMS segments', () => {
    const { sms } = TEMPLATES.general_notice.render({ noticeTitle: 'Annual day', noticeBody: 'x '.repeat(600), schoolName: 'DPS Dwarka' });
    assert.ok(smsSegments(sms.text) <= 2, `${sms.text.length} chars`);
    assert.match(sms.text, /Details in the school app\.$/);
  });
});

// ---------------------------------------------------------------- sendAbsenteeAlert

describe('sendAbsenteeAlert', () => {
  test('sends a WhatsApp template through Twilio with Content variables', async () => {
    script.push(twilioOk());
    const { service } = makeService();
    const result = await service.sendAbsenteeAlert('98110 42231', 'Aarav Sharma', '2026-10-02');

    assert.equal(result.ok, true);
    assert.equal(result.channel, 'whatsapp');
    assert.equal(requests.length, 1);
    const [req] = requests;
    assert.equal(req.url, '/2010-04-01/Accounts/AC_test_sid/Messages.json');
    assert.equal(req.headers.authorization, `Basic ${Buffer.from('AC_test_sid:super-secret-token').toString('base64')}`);
    assert.equal(req.form.To, 'whatsapp:+919811042231');
    assert.equal(req.form.From, 'whatsapp:+14155238886');
    assert.equal(req.form.ContentSid, 'HXabsent');
    assert.deepEqual(JSON.parse(req.form.ContentVariables), { 1: 'Aarav Sharma', 2: 'DPS Dwarka', 3: 'Fri 2 Oct 2026' });
  });

  test('retries a 503, then succeeds', async () => {
    script.push(twilioErr(503, 20500, 'Service unavailable'), twilioOk());
    const { service } = makeService();
    const result = await service.sendAbsenteeAlert('9811042231', 'Aarav Sharma', '2026-10-02');
    assert.equal(result.ok, true);
    assert.equal(result.attempts, 2);
    assert.equal(requests.length, 2);
  });

  test('falls back to SMS when the parent is not on WhatsApp', async () => {
    script.push(twilioErr(400, 63024, 'Invalid message recipient'), msg91Ok());
    const { service, logger } = makeService({ sms: 'msg91' });
    const result = await service.sendAbsenteeAlert('9811042231', 'Aarav Sharma', '2026-10-02');

    assert.equal(result.ok, true);
    assert.equal(result.channel, 'sms');
    assert.equal(result.provider, 'msg91');
    const sms = requests[1];
    assert.equal(sms.url, '/api/v5/flow/');
    assert.equal(sms.headers.authkey, 'msg91-key');
    assert.deepEqual(sms.json, {
      flow_id: 'flow-abs',
      sender: 'DPSDWK',
      recipients: [{ mobiles: '919811042231', VAR1: 'Aarav Sharma', VAR2: 'DPS Dwarka', VAR3: 'Fri 2 Oct 2026' }],
    });
    assert.ok(logger.lines.some((l) => l.message === 'Notification used fallback channel'));
  });

  test('falls back to SMS when no WhatsApp template is configured', async () => {
    script.push(twilioOk());
    const { service } = makeService({ contentSids: {} });
    const result = await service.sendAbsenteeAlert('9811042231', 'Aarav Sharma', '2026-10-02');
    assert.equal(result.ok, true);
    assert.equal(result.channel, 'sms');
    assert.equal(requests.length, 1); // never called WhatsApp without a template
    assert.match(requests[0].form.Body, /^Dear Parent, Aarav Sharma was marked absent at DPS Dwarka on Fri 2 Oct 2026\./);
  });

  test('invalid phone: no gateway call, ok:false, logged', async () => {
    const { service, logger } = makeService();
    const result = await service.sendAbsenteeAlert('12345', 'Aarav Sharma', '2026-10-02');
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'INVALID_PHONE');
    assert.equal(requests.length, 0);
    assert.ok(logger.lines.some((l) => l.level === 'error'));
  });

  test('bad input is reported, not thrown', async () => {
    const { service } = makeService();
    assert.equal((await service.sendAbsenteeAlert('9811042231', '', '2026-10-02')).error.code, 'INVALID_INPUT');
    assert.equal((await service.sendAbsenteeAlert('9811042231', 'Aarav', '02/10/2026')).error.code, 'INVALID_INPUT');
  });
});

// ---------------------------------------------------------------- sendFeeDueReminder

describe('sendFeeDueReminder', () => {
  test('SMS via Twilio carries amount, date and link', async () => {
    script.push(twilioOk());
    const { service } = makeService({ whatsapp: false });
    const result = await service.sendFeeDueReminder('+91 98110 42231', 'Ravi Sharma', '31000.50', '2026-10-10', 'https://pay.example.in/i/AB12');
    assert.equal(result.ok, true);
    assert.equal(result.smsSegments, 1);
    assert.equal(requests[0].form.To, '+919811042231');
    assert.equal(requests[0].form.From, '+15005550006');
    assert.equal(requests[0].form.Body, 'Dear Ravi Sharma, fee of Rs.31,000.50 is due on Sat 10 Oct 2026 at DPS Dwarka. Pay online: https://pay.example.in/i/AB12');
  });

  test('rejects non-https payment links and bad amounts', async () => {
    const { service } = makeService();
    assert.equal((await service.sendFeeDueReminder('9811042231', 'Ravi', 100, '2026-10-10', 'http://pay.example.in')).error.code, 'INVALID_INPUT');
    assert.equal((await service.sendFeeDueReminder('9811042231', 'Ravi', -5, '2026-10-10', 'https://pay.example.in')).error.code, 'INVALID_INPUT');
    assert.equal((await service.sendFeeDueReminder('9811042231', 'Ravi', 'abc', '2026-10-10', 'https://pay.example.in')).error.code, 'INVALID_INPUT');
    assert.equal(requests.length, 0);
  });

  test('does not retry a permanent rejection (invalid number at Twilio)', async () => {
    script.push(twilioErr(400, 21211, "The 'To' number is not valid"));
    const { service } = makeService({ whatsapp: false });
    const result = await service.sendFeeDueReminder('9811042231', 'Ravi', 500, '2026-10-10', 'https://pay.example.in');
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'INVALID_PHONE');
    assert.equal(requests.length, 1);
  });

  test('gives up after max attempts on repeated 429s', async () => {
    script.push(twilioErr(429, 20429, 'Too Many Requests'), twilioErr(429, 20429, 'Too Many Requests'), twilioErr(429, 20429, 'Too Many Requests'));
    const { service, logger } = makeService({ whatsapp: false });
    const result = await service.sendFeeDueReminder('9811042231', 'Ravi', 500, '2026-10-10', 'https://pay.example.in');
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'RATE_LIMITED');
    assert.equal(result.attempts, 3);
    assert.equal(requests.length, 3);
    const failure = logger.lines.find((l) => l.message === 'Notification dispatch failed');
    assert.ok(failure, 'final failure is logged');
    assert.equal(failure.meta.to, '+91•••••••231');
    assert.equal(JSON.stringify(logger.lines).includes('9811042231'), false, 'full number never logged');
    assert.equal(JSON.stringify(logger.lines).includes('super-secret-token'), false, 'credentials never logged');
  });

  test('times out a hanging gateway and retries', async () => {
    script.push(() => ({ status: 201, body: { sid: 'SMlate' }, delayMs: 800 }), twilioOk());
    const { service } = makeService({ whatsapp: false, timeoutMs: 150 });
    const result = await service.sendFeeDueReminder('9811042231', 'Ravi', 500, '2026-10-10', 'https://pay.example.in');
    assert.equal(result.ok, true);
    assert.equal(result.attempts, 2);
  });

  test('network failure (gateway down) is retryable and reported', async () => {
    const down = new TwilioProvider({ accountSid: 'AC1', authToken: 't', smsFrom: '+15005550006', baseUrl: 'http://127.0.0.1:9', timeoutMs: 500 });
    const logger = captureLogger();
    const service = new NotificationService({ providers: { sms: down }, logger, retry: { attempts: 2 }, sleep: async () => {} });
    const result = await service.sendFeeDueReminder('9811042231', 'Ravi', 500, '2026-10-10', 'https://pay.example.in');
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'NETWORK_ERROR');
    assert.equal(result.attempts, 2);
  });

  test('MSG91 "HTTP 200 + type:error" is treated as a failure', async () => {
    script.push(() => ({ status: 200, body: { type: 'error', message: 'Authentication failure' } }));
    const { service } = makeService({ whatsapp: false, sms: 'msg91' });
    const result = await service.sendFeeDueReminder('9811042231', 'Ravi', 500, '2026-10-10', 'https://pay.example.in');
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'AUTH_FAILED');
    assert.equal(requests.length, 1, 'auth failures are not retried');
  });

  test('a buggy provider that throws a plain Error never crashes the caller', async () => {
    const broken = { name: 'broken', supports: () => true, send: async () => { throw new TypeError('cannot read x of undefined'); } };
    const service = new NotificationService({ providers: { sms: broken }, logger: captureLogger(), sleep: async () => {} });
    const result = await service.sendFeeDueReminder('9811042231', 'Ravi', 500, '2026-10-10', 'https://pay.example.in');
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'UNEXPECTED_ERROR');
  });
});

// ---------------------------------------------------------------- sendGeneralNotice

describe('sendGeneralNotice', () => {
  test('sends one message per phone and reports a summary', async () => {
    const simulated = new SimulatedProvider({ channels: ['sms'], latencyMs: 1, failPermanently: ['+919876500000'], failOnce: ['+919876599999'] });
    const recipients = [
      { userId: 'p1', name: 'Ravi', phone: '9811042231' },
      { userId: 'p2', name: 'Pooja', phone: '+91 98110 42231' }, // same family phone
      { userId: 'p3', name: 'Meena', phone: null },
      { userId: 'p4', name: 'Bad', phone: '12345' },
      { userId: 'p5', name: 'Gone', phone: '9876500000' },      // simulated permanent failure
      { userId: 'p6', name: 'Flaky', phone: '9876599999' },     // fails once, then succeeds
      { userId: 'p7', name: 'Neha', phone: '9988776655' },
    ];
    const seen = [];
    const service = new NotificationService({
      providers: { sms: simulated },
      logger: captureLogger(),
      schoolName: 'DPS Dwarka',
      recipientResolver: async (q) => {
        seen.push(q);
        return recipients;
      },
      sleep: async () => {},
    });

    const summary = await service.sendGeneralNotice('parent', 'School closed on Monday', 'The school will remain closed on Monday 5 Oct for Gandhi Jayanti observance.', { tenantId: 't1', branchId: 'b1' });
    assert.deepEqual(seen, [{ role: 'parent', tenantId: 't1', branchId: 'b1' }]);
    assert.equal(summary.total, 4);
    assert.equal(summary.sent, 3);
    assert.equal(summary.failed, 1);
    assert.equal(summary.skipped, 2);
    assert.equal(summary.ok, false);
    assert.deepEqual(summary.failures.map((f) => f.code).sort(), ['INVALID_PHONE', 'PROVIDER_REJECTED']);
    assert.equal(simulated.outbox.length, 3);
    assert.match(simulated.outbox[0].text, /^DPS Dwarka: School closed on Monday\. The school will remain closed/);
  });

  test('unknown role and missing resolver are reported, not thrown', async () => {
    const { service } = makeService();
    assert.equal((await service.sendGeneralNotice('alumni', 'T', 'B')).error.code, 'INVALID_INPUT');
    assert.equal((await service.sendGeneralNotice('teacher', 'T', 'B')).error.code, 'NOT_CONFIGURED');
  });
});
