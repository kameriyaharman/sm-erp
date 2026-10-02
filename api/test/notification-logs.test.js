// Run: npm test
// WATI provider and notification_logs behaviour of NotificationService (in-memory log store).
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { NotificationService } from '../src/modules/notifications/NotificationService.js';
import { SimulatedProvider } from '../src/modules/notifications/providers/simulated.provider.js';
import { WatiProvider } from '../src/modules/notifications/providers/wati.provider.js';

// ---------------------------------------------------------------- fake WATI

const requests = [];
let script = [];
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    requests.push({ url: req.url, headers: req.headers, json: raw ? JSON.parse(raw) : null });
    const { status, body } = (script.shift() ?? (() => ({ status: 500, body: {} })))();
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
});
let base;
before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/123456`;
});
after(() => server.close());
beforeEach(() => {
  requests.length = 0;
  script = [];
});

const silent = { info() {}, warn() {}, error() {} };

/** In-memory stand-in for createPgLogStore(), same contract. */
function memoryLogStore() {
  const rows = new Map();
  const keys = new Set();
  let seq = 0;
  return {
    rows,
    async begin(e) {
      if (e.dedupeKey) {
        const key = `${e.tenantId ?? ''}|${e.dedupeKey}`;
        if (keys.has(key)) return { duplicate: true };
        keys.add(key);
      }
      const id = `log-${++seq}`;
      rows.set(id, { id, ...e, template: e.template, recipient_phone: e.recipientPhone, payload: e.payload, status: 'sending', attempts: 0, retry_count: 0, max_retries: e.maxRetries ?? 4, next_retry_at: null });
      return { id };
    },
    async complete(id, r) {
      const row = rows.get(id);
      row.attempts += r.attempts ?? 0;
      if (r.ok) Object.assign(row, { status: 'sent', next_retry_at: null, channel: r.channel, error: null });
      else {
        const retry = r.error.retryable && row.retry_count < row.max_retries;
        Object.assign(row, { status: r.error.retryable && !retry ? 'abandoned' : 'failed', next_retry_at: retry ? 'due' : null, error: r.error.code });
      }
    },
    async claimDue(limit) {
      const due = [...rows.values()].filter((r) => r.status === 'failed' && r.next_retry_at === 'due').slice(0, limit);
      due.forEach((r) => Object.assign(r, { status: 'sending', retry_count: r.retry_count + 1, next_retry_at: null }));
      return due;
    },
    async claimOne(id) {
      const r = rows.get(id);
      if (!r || !['failed', 'abandoned'].includes(r.status)) return null;
      Object.assign(r, { status: 'sending', retry_count: r.retry_count + 1 });
      return r;
    },
  };
}

// ---------------------------------------------------------------- WATI

describe('WatiProvider', () => {
  const wati = () => new WatiProvider({ apiEndpoint: base, accessToken: 'wati-token', channelNumber: '+919876543210', timeoutMs: 500 });

  test('sends an approved template with named parameters', async () => {
    script.push(() => ({ status: 200, body: { result: true, local_message_id: 'wamid-1', validWhatsAppNumber: true } }));
    const service = new NotificationService({ providers: { whatsapp: wati() }, logger: silent, schoolName: 'DPS Dwarka', sleep: async () => {} });
    const result = await service.sendAbsenteeAlert('98110 42231', 'Aarav Sharma', '2026-10-02');

    assert.equal(result.ok, true);
    assert.equal(result.provider, 'wati');
    assert.equal(result.providerMessageId, 'wamid-1');
    const [req] = requests;
    assert.equal(req.url, '/123456/api/v1/sendTemplateMessage?whatsappNumber=919811042231');
    assert.equal(req.headers.authorization, 'Bearer wati-token');
    assert.equal(req.json.template_name, 'absentee_alert');
    assert.equal(req.json.channel_number, '919876543210');
    assert.match(req.json.broadcast_name, /^absentee_alert_\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(req.json.parameters, [
      { name: 'student_name', value: 'Aarav Sharma' },
      { name: 'school_name', value: 'DPS Dwarka' },
      { name: 'date', value: 'Fri 2 Oct 2026' },
    ]);
  });

  test('"result:false, not on WhatsApp" falls back to SMS', async () => {
    script.push(() => ({ status: 200, body: { result: false, validWhatsAppNumber: false, info: 'Invalid WhatsApp number' } }));
    const sms = new SimulatedProvider({ channels: ['sms'], latencyMs: 1 });
    const service = new NotificationService({ providers: { whatsapp: wati(), sms }, logger: silent, sleep: async () => {} });
    const result = await service.sendFeeDueReminder('9811042231', 'Ravi Sharma', 31000, '2026-10-10', 'https://pay.example.in/x');
    assert.equal(result.ok, true);
    assert.equal(result.channel, 'sms');
    assert.equal(sms.outbox.length, 1);
  });

  test('401 is an auth failure and is not retried', async () => {
    script.push(() => ({ status: 401, body: {} }));
    const service = new NotificationService({ providers: { whatsapp: wati() }, logger: silent, sleep: async () => {} });
    const result = await service.sendAbsenteeAlert('9811042231', 'Aarav', '2026-10-02');
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'AUTH_FAILED');
    assert.equal(requests.length, 1);
  });
});

// ---------------------------------------------------------------- notification_logs

describe('notification logs', () => {
  test('a log row exists (status sending) before the gateway is called, then becomes sent', async () => {
    const store = memoryLogStore();
    let statusDuringSend;
    const spy = { name: 'spy', supports: () => true, send: async () => { statusDuringSend = [...store.rows.values()][0]?.status; return { providerMessageId: 'X1' }; } };
    const service = new NotificationService({ providers: { sms: spy }, logStore: store, logger: silent });
    const result = await service.sendAbsenteeAlert('9811042231', 'Aarav', '2026-10-02', { tenantId: 't1', studentId: 's1' });

    assert.equal(statusDuringSend, 'sending');
    const row = store.rows.get(result.logId);
    assert.equal(row.status, 'sent');
    assert.equal(row.recipient_phone, '+919811042231');
    assert.equal(row.eventType, 'absentee_alert');
    assert.deepEqual(row.payload.vars, { studentName: 'Aarav', date: '2026-10-02', schoolName: 'School' });
  });

  test('a failed dispatch is logged with a retry scheduled, and retryFailed() delivers it later', async () => {
    const store = memoryLogStore();
    let gatewayUp = false;
    const gateway = {
      name: 'flaky-gw',
      supports: () => true,
      send: async () => {
        if (!gatewayUp) throw Object.assign(new (await import('../src/modules/notifications/errors.js')).NotificationError('PROVIDER_UNAVAILABLE', 'down', { retryable: true, status: 503 }));
        return { providerMessageId: 'OK-1' };
      },
    };
    const service = new NotificationService({ providers: { sms: gateway }, logStore: store, logger: silent, retry: { attempts: 2 }, sleep: async () => {} });

    const first = await service.sendFeeDueReminder('9811042231', 'Ravi', 500, '2026-10-10', 'https://pay.example.in/x', { tenantId: 't1' });
    assert.equal(first.ok, false);
    const row = store.rows.get(first.logId);
    assert.equal(row.status, 'failed');
    assert.equal(row.next_retry_at, 'due');
    assert.equal(row.attempts, 2);

    gatewayUp = true;
    const summary = await service.retryFailed();
    assert.deepEqual(summary, { claimed: 1, sent: 1, failed: 0 });
    assert.equal(row.status, 'sent');
    assert.equal(row.retry_count, 1);
  });

  test('permanent failures are logged but not auto-retried', async () => {
    const store = memoryLogStore();
    const service = new NotificationService({ providers: { sms: new SimulatedProvider({ channels: ['sms'], latencyMs: 1, failPermanently: ['+919811042231'] }) }, logStore: store, logger: silent });
    const result = await service.sendAbsenteeAlert('9811042231', 'Aarav', '2026-10-02');
    const row = store.rows.get(result.logId);
    assert.equal(row.status, 'failed');
    assert.equal(row.next_retry_at, null);
    assert.deepEqual(await service.retryFailed(), { claimed: 0, sent: 0, failed: 0 });
  });

  test('an invalid phone number is still logged (so the office can fix the record)', async () => {
    const store = memoryLogStore();
    const service = new NotificationService({ providers: { sms: new SimulatedProvider({ channels: ['sms'], latencyMs: 1 }) }, logStore: store, logger: silent });
    const result = await service.sendAbsenteeAlert('12345', 'Aarav', '2026-10-02');
    assert.equal(result.ok, false);
    assert.equal(store.rows.get(result.logId).error, 'INVALID_PHONE');
  });

  test('a dedupe key sends at most once', async () => {
    const store = memoryLogStore();
    const sms = new SimulatedProvider({ channels: ['sms'], latencyMs: 1 });
    const service = new NotificationService({ providers: { sms }, logStore: store, logger: silent });
    const args = ['9811042231', 'Ravi', 500, '2026-10-10', 'https://pay.example.in/x', { tenantId: 't1', dedupeKey: 'fee_due:s1:p1:2026-10-02' }];
    const a = await service.sendFeeDueReminder(...args);
    const b = await service.sendFeeDueReminder(...args);
    assert.equal(a.ok, true);
    assert.equal(b.duplicate, true);
    assert.equal(sms.outbox.length, 1);
  });

  test('if the log store is down, the message is still sent', async () => {
    const errors = [];
    const brokenStore = { begin: async () => { throw new Error('db down'); }, complete: async () => {}, claimDue: async () => [], claimOne: async () => null };
    const sms = new SimulatedProvider({ channels: ['sms'], latencyMs: 1 });
    const service = new NotificationService({ providers: { sms }, logStore: brokenStore, logger: { ...silent, error: (m) => errors.push(m) } });
    const result = await service.sendAbsenteeAlert('9811042231', 'Aarav', '2026-10-02');
    assert.equal(result.ok, true);
    assert.equal(sms.outbox.length, 1);
    assert.ok(errors.includes('Could not write notification log; sending anyway'));
  });

  test('broadcast: one batch id, one log row per phone, teachers or parents', async () => {
    const store = memoryLogStore();
    const sms = new SimulatedProvider({ channels: ['sms'], latencyMs: 1 });
    const service = new NotificationService({
      providers: { sms },
      logStore: store,
      logger: silent,
      recipientResolver: async ({ role }) =>
        role === 'teacher'
          ? [{ userId: 't1', phone: '9811000001', branchId: 'b1' }, { userId: 't2', phone: '9811000002', branchId: 'b1' }]
          : [],
    });
    const summary = await service.sendBroadcastNotice('teacher', 'Staff meeting', 'Staff meeting at 3 pm in the AV room.', { tenantId: 'T' });
    assert.equal(summary.sent, 2);
    const logged = [...store.rows.values()];
    assert.equal(logged.length, 2);
    assert.ok(logged.every((r) => r.batchId === summary.batchId && r.eventType === 'broadcast_notice' && r.branchId === 'b1'));
    assert.deepEqual(logged.map((r) => r.recipientUserId).sort(), ['t1', 't2']);
  });
});
