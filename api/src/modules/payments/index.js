import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { RazorpayClient } from './razorpay.client.js';

let client;

/** Process-wide Razorpay client built from env. `configured` is false until all three secrets are set. */
export function getRazorpay() {
  client ??= new RazorpayClient({
    keyId: env.RAZORPAY_KEY_ID,
    keySecret: env.RAZORPAY_KEY_SECRET,
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
    baseUrl: env.RAZORPAY_API_BASE,
    timeoutMs: env.RAZORPAY_TIMEOUT_MS,
    logger,
  });
  return client;
}

export const paymentsConfig = Object.freeze({ orderTtlMinutes: env.PAYMENT_ORDER_TTL_MINUTES });
