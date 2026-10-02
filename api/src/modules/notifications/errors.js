/**
 * Every dispatch failure is normalised into a NotificationError so the service
 * can decide, without knowing the provider, whether to retry, fall back to
 * another channel, or give up.
 */
export class NotificationError extends Error {
  /**
   * @param {string} code      Stable machine code, e.g. 'INVALID_PHONE', 'PROVIDER_5XX', 'TIMEOUT'
   * @param {string} message   Human-readable summary (never contains secrets)
   * @param {object} [info]
   * @param {boolean} [info.retryable]      Same request may succeed later (network, 429, 5xx)
   * @param {boolean} [info.tryNextChannel] This channel can't reach the person; another might (e.g. not on WhatsApp)
   * @param {string}  [info.provider]
   * @param {number}  [info.status]         HTTP status from the gateway
   * @param {string|number} [info.providerCode] Gateway's own error code
   * @param {unknown} [info.cause]
   */
  constructor(code, message, info = {}) {
    super(message, { cause: info.cause });
    this.name = 'NotificationError';
    this.code = code;
    this.retryable = Boolean(info.retryable);
    this.tryNextChannel = Boolean(info.tryNextChannel);
    this.provider = info.provider;
    this.status = info.status;
    this.providerCode = info.providerCode;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      provider: this.provider,
      status: this.status,
      providerCode: this.providerCode,
    };
  }
}

/** Classifies an HTTP status the way every gateway behaves. */
export function errorFromStatus(provider, status, message, providerCode) {
  if (status === 429) {
    return new NotificationError('RATE_LIMITED', message || 'Gateway rate limit hit', { provider, status, providerCode, retryable: true });
  }
  if (status === 401 || status === 403) {
    return new NotificationError('AUTH_FAILED', message || 'Gateway rejected our credentials', { provider, status, providerCode });
  }
  if (status >= 500) {
    return new NotificationError('PROVIDER_UNAVAILABLE', message || `Gateway error ${status}`, { provider, status, providerCode, retryable: true });
  }
  return new NotificationError('PROVIDER_REJECTED', message || `Gateway rejected the request (${status})`, { provider, status, providerCode });
}
