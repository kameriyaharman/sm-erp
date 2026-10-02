import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { RazorpayClient } from '../src/modules/payments/razorpay.client.js';
import { rupeesInWords } from '../src/modules/payments/amount-in-words.js';

const client = new RazorpayClient({ keyId: 'rzp_test_x', keySecret: 'key_secret', webhookSecret: 'wh_secret' });

test('webhook signature: HMAC-SHA256 of the raw body with the webhook secret', () => {
  const raw = Buffer.from('{"event":"payment.captured","payload":{}}');
  const good = createHmac('sha256', 'wh_secret').update(raw).digest('hex');
  assert.equal(client.verifyWebhookSignature(raw, good), true);
  assert.equal(client.verifyWebhookSignature(raw, good.toUpperCase()), false);
  assert.equal(client.verifyWebhookSignature(Buffer.from(raw.toString().replace('captured', 'failed')), good), false);
  assert.equal(client.verifyWebhookSignature(raw, createHmac('sha256', 'key_secret').update(raw).digest('hex')), false, 'key secret is not the webhook secret');
  assert.equal(client.verifyWebhookSignature(raw, undefined), false);
  assert.equal(client.verifyWebhookSignature(raw, 'short'), false);
  assert.equal(client.verifyWebhookSignature(raw.toString(), good), false, 'must be the raw Buffer, not a parsed/re-serialised body');
});

test('checkout signature: HMAC-SHA256(order_id|payment_id, key secret)', () => {
  const sig = createHmac('sha256', 'key_secret').update('order_1|pay_1').digest('hex');
  assert.equal(client.verifyCheckoutSignature({ orderId: 'order_1', paymentId: 'pay_1', signature: sig }), true);
  assert.equal(client.verifyCheckoutSignature({ orderId: 'order_1', paymentId: 'pay_2', signature: sig }), false);
});

test('configured only when all three secrets are present', () => {
  assert.equal(client.configured, true);
  assert.equal(new RazorpayClient({ keyId: 'a', keySecret: 'b' }).configured, false);
});

test('amount in words, Indian numbering', () => {
  assert.equal(rupeesInWords(3900000), 'Rupees Thirty-Nine Thousand Only');
  assert.equal(rupeesInWords(1250050), 'Rupees Twelve Thousand Five Hundred and Fifty Paise Only');
  assert.equal(rupeesInWords(123456700), 'Rupees Twelve Lakh Thirty-Four Thousand Five Hundred Sixty-Seven Only');
  assert.equal(rupeesInWords(1234567800), 'Rupees One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight Only');
  assert.equal(rupeesInWords(100), 'Rupees One Only');
  assert.equal(rupeesInWords(1), 'Rupees Zero and One Paise Only');
  assert.throws(() => rupeesInWords(10.5));
});
