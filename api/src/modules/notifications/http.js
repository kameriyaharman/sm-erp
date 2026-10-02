import { NotificationError } from './errors.js';

/**
 * POST with a hard timeout. Network failures and timeouts become retryable
 * NotificationErrors; HTTP error statuses are returned for the caller to map,
 * because each gateway encodes its errors differently.
 *
 * @returns {Promise<{ status: number, body: any, text: string }>}
 */
export async function postWithTimeout(provider, url, { headers, body, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null; // some gateways answer errors in HTML/plain text
    }
    return { status: response.status, body: parsed, text: text.slice(0, 500) };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new NotificationError('TIMEOUT', `No response from ${provider} within ${timeoutMs} ms`, { provider, retryable: true, cause: err });
    }
    throw new NotificationError('NETWORK_ERROR', `Could not reach ${provider}: ${err.cause?.code ?? err.message}`, {
      provider,
      retryable: true,
      cause: err,
    });
  } finally {
    clearTimeout(timer);
  }
}
