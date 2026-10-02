import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../errors/AppError.js';

/**
 * Minimal Razorpay client (no SDK): Orders API + signature checks.
 * Docs: https://razorpay.com/docs/api/orders/create
 *       https://razorpay.com/docs/webhooks/validate-test
 */
export class RazorpayClient {
  constructor({ keyId, keySecret, webhookSecret, baseUrl = 'https://api.razorpay.com', timeoutMs = 10_000, logger }) {
    this.keyId = keyId;
    this.keySecret = keySecret;
    this.webhookSecret = webhookSecret;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.logger = logger;
  }

  get configured() {
    return Boolean(this.keyId && this.keySecret && this.webhookSecret);
  }

  /**
   * @param {{ amountPaise: number, receipt: string, notes: Record<string,string> }} input
   * @returns {Promise<{ id: string, amount: number, currency: string, status: string }>}
   */
  async createOrder({ amountPaise, receipt, notes }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await fetch(`${this.baseUrl}/v1/orders`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt, notes }),
      });
    } catch (err) {
      this.logger?.error('Razorpay order call failed', { error: err.name === 'AbortError' ? 'timeout' : err.message });
      throw new AppError(502, 'GATEWAY_UNAVAILABLE', 'The payment gateway is not responding. Please try again in a minute.');
    } finally {
      clearTimeout(timer);
    }

    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.id) {
      // Log the gateway's reason for us; show the parent something actionable.
      this.logger?.error('Razorpay rejected order', { status: response.status, error: body?.error?.description ?? body?.error?.code });
      throw new AppError(502, 'GATEWAY_REJECTED', 'The payment gateway could not start this payment. Please try again or pay at the school office.');
    }
    return body;
  }

  /** X-Razorpay-Signature = HMAC-SHA256(rawBody, webhookSecret), hex. Compared in constant time. */
  verifyWebhookSignature(rawBody, signature) {
    if (!signature || typeof signature !== 'string' || !Buffer.isBuffer(rawBody)) return false;
    const expected = createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Checkout handler signature: HMAC-SHA256(order_id + "|" + payment_id, keySecret). */
  verifyCheckoutSignature({ orderId, paymentId, signature }) {
    if (!signature) return false;
    const expected = createHmac('sha256', this.keySecret).update(`${orderId}|${paymentId}`).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(String(signature), 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
