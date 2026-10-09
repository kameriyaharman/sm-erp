import nodemailer from 'nodemailer';
import { randomUUID } from 'node:crypto';
import { NotificationError } from '../errors.js';

/**
 * E-mail over SMTP: Gmail / Google Workspace, Zoho, Microsoft 365, Amazon SES, SendGrid, Brevo,
 * Hostinger ... anything that offers SMTP. The school's own mailbox or the platform's.
 *
 *   new SmtpEmailProvider({ host, port, secure, user, password, fromEmail, fromName, replyTo })
 *
 * send({ channel: 'email', to, rendered }) uses rendered.email = { subject, text, html }.
 */

const PERMANENT_SMTP = new Set([550, 551, 552, 553, 554]);

export class SmtpEmailProvider {
  constructor({ host, port = 587, secure, user, password, fromEmail, fromName, replyTo, timeoutMs = 15_000, transport }) {
    if (!transport && (!host || !fromEmail)) throw new Error('SmtpEmailProvider needs host and fromEmail');
    this.name = 'smtp';
    this.from = fromName ? { name: fromName, address: fromEmail } : fromEmail;
    this.replyTo = replyTo || undefined;
    this.transport =
      transport ??
      nodemailer.createTransport({
        host,
        port: Number(port),
        secure: secure ?? Number(port) === 465,   // 465 = implicit TLS; 587 / 25 = STARTTLS
        auth: user ? { user, pass: password } : undefined,
        connectionTimeout: timeoutMs,
        greetingTimeout: timeoutMs,
        socketTimeout: timeoutMs,
        requireTLS: Number(port) === 587,
      });
  }

  supports(channel) {
    return channel === 'email';
  }

  async send({ channel, to, rendered }) {
    if (channel !== 'email') {
      throw new NotificationError('CHANNEL_NOT_SUPPORTED', 'The email provider only sends email', { provider: this.name, tryNextChannel: true });
    }
    const mail = rendered?.email;
    if (!mail?.subject || !mail?.text) {
      throw new NotificationError('TEMPLATE_NOT_CONFIGURED', 'No email text for this message', { provider: this.name, tryNextChannel: true });
    }
    try {
      const info = await this.transport.sendMail({
        from: this.from,
        to,
        replyTo: this.replyTo,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        messageId: `<${randomUUID()}@sm-erp>`,
      });
      if (Array.isArray(info.rejected) && info.rejected.length > 0) {
        throw new NotificationError('PROVIDER_REJECTED', 'The mail server refused the address', { provider: this.name });
      }
      return { providerMessageId: String(info.messageId ?? ''), status: 'accepted' };
    } catch (err) {
      throw mapSmtpError(err, this.name);
    }
  }

  /** "Test connection": log in to the SMTP server without sending anything. */
  async verify() {
    try {
      await this.transport.verify();
      return { ok: true, message: 'Signed in to the mail server.' };
    } catch (err) {
      const e = mapSmtpError(err, this.name);
      return { ok: false, reason: e.code === 'AUTH_FAILED' ? 'invalid_credentials' : e.retryable ? 'unreachable' : 'rejected', message: e.message };
    }
  }
}

export function mapSmtpError(err, provider = 'smtp') {
  if (err instanceof NotificationError) return err;
  const code = err?.code;
  const status = Number(err?.responseCode) || undefined;
  if (code === 'EAUTH' || status === 535 || status === 534) {
    return new NotificationError('AUTH_FAILED', 'The mail server did not accept the username or password', { provider, status });
  }
  if (['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'ECONNREFUSED', 'EDNS', 'ENOTFOUND'].includes(code)) {
    return new NotificationError('NETWORK_ERROR', `Could not reach the mail server (${code})`, { provider, retryable: true });
  }
  if (status && status >= 400 && status < 500) {
    return new NotificationError('PROVIDER_UNAVAILABLE', `Mail server: temporary failure (${status})`, { provider, status, retryable: true });
  }
  if (status && PERMANENT_SMTP.has(status)) {
    return new NotificationError('PROVIDER_REJECTED', `Mail server refused the message (${status})`, { provider, status });
  }
  return new NotificationError('PROVIDER_REJECTED', `Mail server: ${err?.message ?? 'unknown error'}`.slice(0, 300), { provider, status });
}

/** Logs e-mails instead of sending (development / tests). */
export class SimulatedEmailProvider {
  constructor({ logger } = {}) {
    this.name = 'simulated';
    this.logger = logger;
    this.outbox = [];
  }

  supports(channel) {
    return channel === 'email';
  }

  async send({ to, rendered }) {
    const providerMessageId = `SIM-MAIL-${randomUUID().slice(0, 8).toUpperCase()}`;
    this.outbox.push({ to, subject: rendered.email?.subject, providerMessageId });
    if (this.outbox.length > 200) this.outbox.shift();
    this.logger?.info('SIMULATED EMAIL SENT', { to: String(to).replace(/^(.).*(@.*)$/, '$1•••$2'), subject: rendered.email?.subject, providerMessageId });
    return { providerMessageId, status: 'sent' };
  }

  async verify() {
    return { ok: true, message: 'Simulated email (development).' };
  }
}
