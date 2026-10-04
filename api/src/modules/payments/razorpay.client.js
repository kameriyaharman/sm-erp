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

  /** One authenticated call. Network trouble -> 502 GATEWAY_UNAVAILABLE; returns { status, body } otherwise. */
  async request(method, path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`,
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      this.logger?.error('Razorpay call failed', { path: path.split('?')[0].replace(/\/(order|pay)_[A-Za-z0-9]+/g, '/$1_*'), error: err.name === 'AbortError' ? 'timeout' : err.message });
      throw new AppError(502, 'GATEWAY_UNAVAILABLE', 'The payment gateway is not responding. Please try again in a minute.');
    } finally {
      clearTimeout(timer);
    }
    return { status: response.status, body: await response.json().catch(() => null) };
  }

  /**
   * @param {{ amountPaise: number, receipt: string, notes: Record<string,string> }} input
   * @returns {Promise<{ id: string, amount: number, currency: string, status: string }>}
   */
  async createOrder({ amountPaise, receipt, notes }) {
    const { status, body } = await this.request('POST', '/v1/orders', { amount: amountPaise, currency: 'INR', receipt, notes });
    if (status < 200 || status >= 300 || !body?.id) {
      // Log the gateway's reason for us; show the parent something actionable.
      this.logger?.error('Razorpay rejected order', { status, error: body?.error?.description ?? body?.error?.code });
      throw new AppError(502, 'GATEWAY_REJECTED', 'The payment gateway could not start this payment. Please try again or pay at the school office.');
    }
    return body;
  }

  /**
   * Checks that the key id + key secret pair is accepted (lists at most one order; creates nothing).
   * @returns {Promise<{ ok: true } | { ok: false, reason: 'invalid_keys' | 'gateway_error', message: string }>}
   */
  async verifyCredentials() {
    const { status, body } = await this.request('GET', '/v1/orders?count=1');
    if (status >= 200 && status < 300) return { ok: true };
    if (status === 401 || status === 403) {
      return { ok: false, reason: 'invalid_keys', message: 'Razorpay did not accept this Key ID and Key secret. Copy both again from the same mode (Test or Live).' };
    }
    return { ok: false, reason: 'gateway_error', message: `Razorpay answered ${status}${body?.error?.description ? `: ${String(body.error.description).slice(0, 120)}` : ''}. Try again in a minute.` };
  }

  /** Payments made against one order (newest first, as Razorpay returns them). */
  async fetchOrderPayments(gatewayOrderId) {
    const { status, body } = await this.request('GET', `/v1/orders/${encodeURIComponent(gatewayOrderId)}/payments`);
    if (status === 401 || status === 403) {
      throw new AppError(502, 'GATEWAY_AUTH_FAILED', 'Razorpay rejected the saved keys. Check Settings -> Online payments.');
    }
    if (status === 400 || status === 404) throw new AppError(404, 'GATEWAY_ORDER_NOT_FOUND', 'Razorpay has no such order for these keys.');
    if (status < 200 || status >= 300 || !Array.isArray(body?.items)) {
      this.logger?.error('Razorpay payments fetch failed', { status, error: body?.error?.description ?? body?.error?.code });
      throw new AppError(502, 'GATEWAY_REJECTED', 'The payment gateway did not answer properly. Try again in a minute.');
    }
    return body.items;
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
