import { randomUUID } from 'node:crypto';
import { NotificationError } from '../errors.js';
import { maskPhone } from '../phone.js';

/**
 * Development / test provider: logs the message instead of sending it.
 * To exercise failure paths, list E.164 numbers in `failPermanently` (always
 * rejected), `failOnce` (one retryable error, then success) or `failTransient`
 * ({ number: times } retryable errors before success). Nothing fails unless
 * you ask for it.
 */
export class SimulatedProvider {
  constructor({ logger, channels = ['sms', 'whatsapp'], latencyMs = 30, failPermanently = [], failOnce = [], failTransient = {} } = {}) {
    this.name = 'simulated';
    this.logger = logger;
    this.channels = new Set(channels);
    this.latencyMs = latencyMs;
    this.failPermanently = new Set(failPermanently);
    this.failTransient = new Map(Object.entries(failTransient));
    failOnce.forEach((number) => this.failTransient.set(number, 1));
    /** Last messages sent, newest last (handy in tests). */
    this.outbox = [];
  }

  supports(channel) {
    return this.channels.has(channel);
  }

  async send({ channel, to, template, rendered }) {
    await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    if (this.failPermanently.has(to)) {
      throw new NotificationError('PROVIDER_REJECTED', 'Simulated permanent failure', { provider: this.name, status: 400 });
    }
    const remaining = this.failTransient.get(to) ?? 0;
    if (remaining > 0) {
      this.failTransient.set(to, remaining - 1);
      throw new NotificationError('PROVIDER_UNAVAILABLE', 'Simulated temporary failure', { provider: this.name, status: 503, retryable: true });
    }
    const providerMessageId = `SIM-${randomUUID().slice(0, 8).toUpperCase()}`;
    const text = channel === 'whatsapp' ? `[template ${template}] ${JSON.stringify(rendered.whatsapp.variables)}` : rendered.sms.text;
    this.outbox.push({ channel, to, template, text, providerMessageId });
    if (this.outbox.length > 200) this.outbox.shift();
    this.logger?.info('SIMULATED NOTIFICATION SENT', { channel, to: maskPhone(to), template, providerMessageId, text });
    return { providerMessageId, status: 'sent' };
  }
}
