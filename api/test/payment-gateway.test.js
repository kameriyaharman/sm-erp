// School-owned Razorpay accounts: secret encryption, credential resolution, per-school webhook
// signatures, login identifiers and temporary passwords. No database or network needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { SecretBoxError, decryptSecret, encryptSecret, last4, parseKey } from '../src/modules/payments/secret-box.js';
import { RazorpayClient } from '../src/modules/payments/razorpay.client.js';
import { loginRateKey, normaliseLoginId, passwordProblems, phone10, temporaryPassword } from '../src/modules/auth/login-id.js';

// gateway.js reads the app config; give it a minimal valid environment before importing it.
const KEY_B64 = randomBytes(32).toString('base64');
Object.assign(process.env, {
  DATABASE_URL: 'postgres://u:p@127.0.0.1:1/x',
  JWT_ACCESS_SECRET: 'x'.repeat(48),
  SETTINGS_ENCRYPTION_KEY: KEY_B64,
  NOTIFY_SMS_PROVIDER: 'none',
  RAZORPAY_KEY_ID: '',
  RAZORPAY_KEY_SECRET: '',
  RAZORPAY_WEBHOOK_SECRET: '',
});
const gateway = await import('../src/modules/payments/gateway.js');
const { webhookUrlFor } = await import('../src/modules/payments/gateway-settings.service.js');

const KEY = parseKey(KEY_B64);
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

// ------------------------------------------------------------------ encryption

test('secret box: AES-256-GCM round trip, random IV each time', () => {
  const a = encryptSecret('rzp_secret_ABC123', { key: KEY, context: `${T1}:key_secret` });
  const b = encryptSecret('rzp_secret_ABC123', { key: KEY, context: `${T1}:key_secret` });
  assert.match(a, /^v1:[\w-]+:[\w-]+:[\w-]+$/);
  assert.notEqual(a, b, 'same plaintext must not give the same ciphertext');
  assert.equal(a.includes('rzp_secret_ABC123'), false);
  assert.equal(decryptSecret(a, { key: KEY, context: `${T1}:key_secret` }), 'rzp_secret_ABC123');
  assert.equal(decryptSecret(b, { key: KEY, context: `${T1}:key_secret` }), 'rzp_secret_ABC123');
  assert.equal(decryptSecret(encryptSecret('पासवर्ड ✓', { key: KEY, context: 'c' }), { key: KEY, context: 'c' }), 'पासवर्ड ✓');
});

test('secret box: bound to school + column, tamper-evident, wrong key fails', () => {
  const sealed = encryptSecret('whsec_1', { key: KEY, context: `${T1}:webhook_secret` });
  assert.throws(() => decryptSecret(sealed, { key: KEY, context: `${T2}:webhook_secret` }), SecretBoxError, 'copied to another school');
  assert.throws(() => decryptSecret(sealed, { key: KEY, context: `${T1}:key_secret` }), SecretBoxError, 'copied to another column');
  assert.throws(() => decryptSecret(sealed, { key: randomBytes(32), context: `${T1}:webhook_secret` }), SecretBoxError, 'encryption key rotated');
  const parts = sealed.split(':');
  const ct = Buffer.from(parts[3], 'base64url');
  ct[0] ^= 1;
  assert.throws(() => decryptSecret([...parts.slice(0, 3), ct.toString('base64url')].join(':'), { key: KEY, context: `${T1}:webhook_secret` }), SecretBoxError);
  assert.throws(() => decryptSecret('plain-text-secret', { key: KEY, context: 'x' }), SecretBoxError);
  assert.throws(() => decryptSecret(sealed.replace(/^v1/, 'v9'), { key: KEY, context: `${T1}:webhook_secret` }), SecretBoxError);
});

test('secret box: key must be 32 bytes; last4 shows only 4 characters', () => {
  assert.throws(() => parseKey(''), SecretBoxError);
  assert.throws(() => parseKey(randomBytes(16).toString('base64')), SecretBoxError);
  assert.equal(parseKey(KEY_B64).length, 32);
  assert.equal(last4('abcdefgh1234'), '1234');
  assert.throws(() => encryptSecret('', { key: KEY, context: 'x' }), SecretBoxError);
});

test('gateway: sealSecret/openSecret use SETTINGS_ENCRYPTION_KEY and the school context', () => {
  const sealed = gateway.sealSecret(T1, 'key_secret', 'super-secret');
  assert.equal(gateway.openSecret(T1, 'key_secret', sealed), 'super-secret');
  assert.throws(() => gateway.openSecret(T2, 'key_secret', sealed));
});

// ------------------------------------------------------------------ credential resolution

test('modeOfKey: from the key id prefix only', () => {
  assert.equal(gateway.modeOfKey('rzp_test_ABCDEF123'), 'test');
  assert.equal(gateway.modeOfKey('rzp_live_ABCDEF123'), 'live');
  assert.equal(gateway.modeOfKey('rzp_TEST_x'), null);
  assert.equal(gateway.modeOfKey(''), null);
  assert.equal(gateway.modeOfKey(undefined), null);
});

test('pickSettings: branch override wins, else the school default, else none', () => {
  const school = { id: 's', branch_id: null };
  const b1 = { id: 'b1', branch_id: 'branch-1' };
  assert.equal(gateway.pickSettings([school, b1], 'branch-1'), b1);
  assert.equal(gateway.pickSettings([school, b1], 'branch-2'), school);
  assert.equal(gateway.pickSettings([b1], 'branch-2'), null);
  assert.equal(gateway.pickSettings([], 'branch-1'), null);
  assert.equal(gateway.pickSettings([b1, school], null), school);
});

function row(overrides = {}) {
  return {
    id: 'row-1', tenant_id: T1, branch_id: null, key_id: 'rzp_test_SCHOOL0001', mode: 'test', enabled: true, allow_partial: true, min_amount: '500.00',
    key_secret_enc: gateway.sealSecret(T1, 'key_secret', 'ks_school'), webhook_secret_enc: gateway.sealSecret(T1, 'webhook_secret', 'wh_school'),
    ...overrides,
  };
}

test('gatewayFromRow: decrypted client, options in paise; disabled row stays disabled', () => {
  const gw = gateway.gatewayFromRow(row());
  assert.equal(gw.source, 'school');
  assert.equal(gw.enabled, true);
  assert.equal(gw.mode, 'test');
  assert.equal(gw.minAmountPaise, 50000);
  assert.equal(gw.client.keyId, 'rzp_test_SCHOOL0001');
  assert.equal(gw.client.keySecret, 'ks_school');
  assert.equal(gw.client.configured, true);
  assert.equal(gateway.gatewayFromRow(row({ branch_id: 'b', enabled: false })).enabled, false);
  assert.equal(gateway.gatewayFromRow(row({ branch_id: 'b' })).source, 'branch');
});

test('gatewayFromRow: secrets from another school (or a rotated key) make the gateway unusable, not wrong', () => {
  const moved = row({ tenant_id: T2 });   // ciphertexts were sealed for T1
  const gw = gateway.gatewayFromRow(moved);
  assert.equal(gw.enabled, false);
  assert.equal(gw.broken, true);
  assert.equal(gw.client, null);
});

test('resolveGateway: no settings and no platform keys -> none (online payment off)', async () => {
  const db = { query: async () => ({ rows: [] }) };
  const gw = await gateway.resolveGateway(db, { tenantId: T1, branchId: 'b' });
  assert.equal(gw.source, 'none');
  assert.equal(gw.enabled, false);
});

test('resolveGateway: branch override chosen over the school default', async () => {
  const rows = [row(), row({ id: 'row-2', branch_id: 'b', key_id: 'rzp_live_BRANCH0001', mode: 'live' })];
  const db = { query: async () => ({ rows }) };
  assert.equal((await gateway.resolveGateway(db, { tenantId: T1, branchId: 'b' })).keyId, 'rzp_live_BRANCH0001');
  assert.equal((await gateway.resolveGateway(db, { tenantId: T1, branchId: 'other' })).keyId, 'rzp_test_SCHOOL0001');
});

// ------------------------------------------------------------------ webhooks per school

test('matchTenantWebhook: only a secret of THIS school verifies; tells which account signed', async () => {
  const raw = Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1' } } } }));
  const sign = (secret) => createHmac('sha256', secret).update(raw).digest('hex');
  const school = row();
  const branch = row({ id: 'row-b', branch_id: 'b', key_id: 'rzp_test_BRANCH0002', webhook_secret_enc: gateway.sealSecret(T1, 'webhook_secret', 'wh_branch') });
  const db = { query: async (_sql, [tenantId]) => ({ rows: tenantId === T1 ? [school, branch] : [] }) };

  assert.deepEqual(await gateway.matchTenantWebhook(db, T1, raw, sign('wh_school')), { settingsId: 'row-1', keyId: 'rzp_test_SCHOOL0001', mode: 'test' });
  assert.equal((await gateway.matchTenantWebhook(db, T1, raw, sign('wh_branch'))).keyId, 'rzp_test_BRANCH0002');
  assert.equal(await gateway.matchTenantWebhook(db, T1, raw, sign('wh_other_school')), null, "another school's secret");
  assert.equal(await gateway.matchTenantWebhook(db, T1, raw, sign('ks_school')), null, 'the key secret is not the webhook secret');
  assert.equal(await gateway.matchTenantWebhook(db, T2, raw, sign('wh_school')), null, 'right secret, wrong school URL');
  assert.equal(await gateway.matchTenantWebhook(db, T1, Buffer.from(raw.toString().replace('pay_1', 'pay_2')), sign('wh_school')), null, 'tampered body');
  assert.equal(await gateway.matchTenantWebhook(db, T1, raw, undefined), null);
});

test('RazorpayClient per account: signatures use that account\'s own secrets', () => {
  const a = new RazorpayClient({ keyId: 'rzp_test_A', keySecret: 'ks_a', webhookSecret: 'wh_a' });
  const b = new RazorpayClient({ keyId: 'rzp_test_B', keySecret: 'ks_b', webhookSecret: 'wh_b' });
  const raw = Buffer.from('{"event":"order.paid"}');
  const sigA = createHmac('sha256', 'wh_a').update(raw).digest('hex');
  assert.equal(a.verifyWebhookSignature(raw, sigA), true);
  assert.equal(b.verifyWebhookSignature(raw, sigA), false);
});

test('webhook URL: public base + /api/v1/finance/webhook/<school code>', () => {
  assert.equal(webhookUrlFor('https://erp.school.in/', 'DPS'), 'https://erp.school.in/api/v1/finance/webhook/dps');
  assert.equal(webhookUrlFor('https://erp.school.in', 'demo'), 'https://erp.school.in/api/v1/finance/webhook/demo');
  assert.deepEqual([...gateway.WEBHOOK_EVENTS], ['payment.captured', 'payment.failed', 'order.paid']);
});

test('test keys are allowed outside production', () => {
  assert.equal(gateway.testKeysAllowed('anyschool'), true);
});

// ------------------------------------------------------------------ login identifiers

test('login id: email, Indian mobile in any common spelling, else username/admission no.', () => {
  assert.deepEqual(normaliseLoginId(' Parent@Demo.School '), { kind: 'email', value: 'parent@demo.school', raw: 'Parent@Demo.School' });
  for (const p of ['9810055555', '+919810055555', '+91 98100 55555', '91-98100-55555', '09810055555', '(+91) 98100-55555', '98100 55555']) {
    assert.deepEqual(normaliseLoginId(p).kind, 'phone', p);
    assert.equal(normaliseLoginId(p).value, '9810055555', p);
  }
  assert.equal(normaliseLoginId('5810055555').kind, 'username', 'Indian mobiles start with 6-9');
  assert.equal(normaliseLoginId('98100555').kind, 'username', 'too short for a mobile');
  assert.deepEqual(normaliseLoginId('DPS-1001'), { kind: 'username', value: 'dps-1001', raw: 'DPS-1001' });
  assert.equal(normaliseLoginId('  adm/2026/07 ').raw, 'adm/2026/07');
  assert.equal(phone10('+91 98100-55555'), '9810055555');
  assert.equal(phone10('011-40000000'), null);
  assert.equal(phone10(null), null);
});

test('rate-limit key: every spelling of one account is one key', () => {
  assert.equal(loginRateKey('Demo', '+91 98100 55555'), loginRateKey('demo', '09810055555'));
  assert.equal(loginRateKey('demo', 'DPS-1001'), loginRateKey('demo', 'dps-1001'));
  assert.notEqual(loginRateKey('demo', 'dps-1001'), loginRateKey('other', 'dps-1001'));
});

test('password rules: length, letters + digit, not the login id', () => {
  assert.deepEqual(passwordProblems('Mango-Tree-42'), []);
  assert.ok(passwordProblems('short1').length > 0);
  assert.ok(passwordProblems('onlyletters').length > 0);
  assert.ok(passwordProblems('12345678').length > 0);
  assert.ok(passwordProblems(' Mango-Tree-42').length > 0);
  assert.ok(passwordProblems('a1'.repeat(40)).length > 0, 'over 72 bytes');
  assert.ok(passwordProblems('9810055555a', { loginIds: ['9810055555'] }).length > 0);
  assert.ok(passwordProblems('xDPS-1001x9', { loginIds: ['DPS-1001'] }).length > 0);
  assert.deepEqual(passwordProblems('Rohan2015!', { loginIds: ['ro', null, undefined] }), [], 'short ids are not checked as substrings');
});

test('temporary passwords: xxxx-xxxx-xxxx, unambiguous characters, always mixed', () => {
  const crypto = { randomInt: (n) => Math.floor(Math.random() * n) };
  const seen = new Set();
  for (let i = 0; i < 300; i += 1) {
    const p = temporaryPassword(crypto.randomInt);
    assert.match(p, /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
    assert.doesNotMatch(p, /[01OIl]/);
    assert.match(p, /[a-z]/);
    assert.match(p, /[A-Z]/);
    assert.match(p, /\d/);
    assert.deepEqual(passwordProblems(p), []);
    seen.add(p);
  }
  assert.equal(seen.size, 300);
  // A generator that keeps producing only letters is retried until a digit appears.
  let calls = 0;
  const p = temporaryPassword((n) => (calls++ < 12 ? 0 : (calls % n)));
  assert.match(p, /\d/);
});
