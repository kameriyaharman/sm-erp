import { NotificationError, errorFromStatus } from '../errors.js';
import { postWithTimeout } from '../http.js';

/**
 * Twilio Programmable Messaging — SMS and WhatsApp.
 *   POST {baseUrl}/2010-04-01/Accounts/{AccountSid}/Messages.json  (form-encoded, Basic auth)
 * SMS sends the rendered text as Body. WhatsApp business-initiated messages must
 * use an approved Content template: ContentSid + ContentVariables (JSON).
 *
 * Docs: https://www.twilio.com/docs/sms/whatsapp/tutorial/send-whatsapp-notification-messages-templates
 */

// Twilio error codes worth treating specially.
const TWILIO_CODES = {
  21211: { code: 'INVALID_PHONE', message: 'Twilio says the number is invalid' },
  21614: { code: 'NOT_MOBILE', message: 'Number cannot receive SMS', tryNextChannel: true },
  21610: { code: 'RECIPIENT_OPTED_OUT', message: 'Recipient has replied STOP to this sender' },
  21408: { code: 'REGION_NOT_ENABLED', message: 'SMS to this country is not enabled on the Twilio account' },
  63016: { code: 'OUTSIDE_SESSION_WINDOW', message: 'WhatsApp needs an approved template outside the 24-hour window', tryNextChannel: true },
  63024: { code: 'NOT_ON_WHATSAPP', message: 'Recipient is not reachable on WhatsApp', tryNextChannel: true },
  63003: { code: 'NOT_ON_WHATSAPP', message: 'Recipient is not reachable on WhatsApp', tryNextChannel: true },
};

export class TwilioProvider {
  /**
   * @param {object} options
   * @param {string} options.accountSid
   * @param {string} options.authToken
   * @param {string} [options.smsFrom]              E.164 sender, or use messagingServiceSid
   * @param {string} [options.messagingServiceSid]
   * @param {string} [options.whatsappFrom]         E.164 WhatsApp Business number
   * @param {Record<string, string>} [options.contentSids]  template key -> Content SID (HX...)
   * @param {string} [options.baseUrl]
   * @param {number} [options.timeoutMs]
   */
  constructor({ accountSid, authToken, smsFrom, messagingServiceSid, whatsappFrom, contentSids = {}, baseUrl = 'https://api.twilio.com', timeoutMs = 10_000 }) {
    if (!accountSid || !authToken) throw new Error('TwilioProvider needs accountSid and authToken');
    this.name = 'twilio';
    this.accountSid = accountSid;
    this.auth = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;
    this.smsFrom = smsFrom;
    this.messagingServiceSid = messagingServiceSid;
    this.whatsappFrom = whatsappFrom;
    this.contentSids = contentSids;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.channels = new Set([...(smsFrom || messagingServiceSid ? ['sms'] : []), ...(whatsappFrom ? ['whatsapp'] : [])]);
  }

  supports(channel) {
    return this.channels.has(channel);
  }

  /**
   * @param {{ channel: 'sms'|'whatsapp', to: string, template: string, rendered: object }} message
   * @returns {Promise<{ providerMessageId: string, status: string }>}
   */
  async send({ channel, to, template, rendered }) {
    const form = new URLSearchParams();
    if (channel === 'whatsapp') {
      // A school's own WhatsApp template stores its Content SID (HX...) as the template name.
      const contentSid = rendered.whatsapp?.name ?? this.contentSids[template];
      if (!contentSid) {
        throw new NotificationError('TEMPLATE_NOT_CONFIGURED', `No approved WhatsApp template (Content SID) set for "${template}"`, {
          provider: this.name,
          tryNextChannel: true,
        });
      }
      form.set('To', `whatsapp:${to}`);
      form.set('From', `whatsapp:${this.whatsappFrom}`);
      form.set('ContentSid', contentSid);
      form.set('ContentVariables', JSON.stringify(rendered.whatsapp.variables));
    } else {
      form.set('To', to);
      if (this.messagingServiceSid) form.set('MessagingServiceSid', this.messagingServiceSid);
      else form.set('From', this.smsFrom);
      form.set('Body', rendered.sms.text);
    }

    const { status, body, text } = await postWithTimeout(this.name, `${this.baseUrl}/2010-04-01/Accounts/${this.accountSid}/Messages.json`, {
      headers: { Authorization: this.auth, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form.toString(),
      timeoutMs: this.timeoutMs,
    });

    if (status >= 200 && status < 300 && body?.sid) {
      // Twilio can accept a message and fail it at once (e.g. status "failed" with an error_code).
      if (body.status === 'failed' || body.status === 'undelivered') {
        throw this.#mapError(400, body.error_code, body.error_message);
      }
      return { providerMessageId: body.sid, status: body.status };
    }
    throw this.#mapError(status, body?.code, body?.message ?? text);
  }

  #mapError(status, providerCode, message) {
    const known = TWILIO_CODES[providerCode];
    if (known) {
      return new NotificationError(known.code, known.message, { provider: this.name, status, providerCode, tryNextChannel: known.tryNextChannel });
    }
    return errorFromStatus(this.name, status, message ? `Twilio: ${message}` : undefined, providerCode);
  }
}
