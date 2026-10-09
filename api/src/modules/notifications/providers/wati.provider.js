import { NotificationError, errorFromStatus } from '../errors.js';
import { postWithTimeout } from '../http.js';

/**
 * WATI — WhatsApp Business API (template messages).
 *   POST {apiEndpoint}/api/v1/sendTemplateMessage?whatsappNumber=91XXXXXXXXXX
 *   Authorization: Bearer <token>
 *   { template_name, broadcast_name, channel_number, parameters: [{ name, value }] }
 * apiEndpoint is the "API Endpoint" shown in the WATI dashboard, which already
 * includes your tenant ID (e.g. https://live-mt-server.wati.io/123456).
 * A 200 with `result: true` means WATI accepted the message, not that it was delivered.
 *
 * Docs: https://docs.wati.io/reference/sendtemplatemessage
 *
 * WATI templates use NAMED placeholders ({{student_name}}), so each of our
 * templates maps its ordered WhatsApp variables onto parameter names.
 */
export const DEFAULT_WATI_TEMPLATES = {
  absentee_alert: { name: 'absentee_alert', params: ['student_name', 'school_name', 'date'] },
  attendance_correction: { name: 'attendance_correction', params: ['school_name', 'student_name', 'date'] },
  fee_due_reminder: { name: 'fee_due_reminder', params: ['parent_name', 'amount', 'due_date', 'school_name', 'payment_link'] },
  general_notice: { name: 'school_notice', params: ['school_name', 'notice_title', 'notice_body'] },
  late_arrival: { name: 'late_arrival', params: ['student_name', 'school_name', 'date', 'time'] },
  gate_entry: { name: 'gate_entry', params: ['student_name', 'school_name', 'time', 'date'] },
  fee_receipt: { name: 'fee_receipt', params: ['parent_name', 'school_name', 'amount', 'student_name', 'date', 'receipt_number'] },
  report_card_published: { name: 'report_card_published', params: ['term_name', 'student_name', 'school_name', 'portal_link'] },
  homework_assigned: { name: 'homework_assigned', params: ['subject_name', 'class_name', 'homework_title', 'due_date', 'school_name'] },
  birthday_wish: { name: 'birthday_wish', params: ['student_name', 'school_name'] },
};

export class WatiProvider {
  /**
   * @param {object} options
   * @param {string} options.apiEndpoint   from the WATI dashboard, includes tenant ID
   * @param {string} options.accessToken   Bearer token
   * @param {string} options.channelNumber the WhatsApp Business number messages go out from
   * @param {Record<string, { name: string, params: string[] }>} [options.templates]
   * @param {number} [options.timeoutMs]
   */
  constructor({ apiEndpoint, accessToken, channelNumber, templates = {}, timeoutMs = 10_000 }) {
    if (!apiEndpoint || !accessToken || !channelNumber) throw new Error('WatiProvider needs apiEndpoint, accessToken and channelNumber');
    this.name = 'wati';
    this.apiEndpoint = apiEndpoint.replace(/\/$/, '');
    this.auth = `Bearer ${accessToken.replace(/^Bearer\s+/i, '')}`;
    this.channelNumber = channelNumber.replace(/^\+/, '');
    this.templates = { ...DEFAULT_WATI_TEMPLATES, ...templates };
    this.timeoutMs = timeoutMs;
  }

  supports(channel) {
    return channel === 'whatsapp';
  }

  async send({ channel, to, template, rendered }) {
    if (channel !== 'whatsapp') {
      throw new NotificationError('CHANNEL_NOT_SUPPORTED', 'WATI only sends WhatsApp', { provider: this.name, tryNextChannel: true });
    }
    // A school's own template (Settings -> Message templates) names the approved template and its parameters.
    const config = rendered.whatsapp?.name ? { name: rendered.whatsapp.name, params: rendered.whatsapp.params ?? [] } : this.templates[template];
    if (!config?.name) {
      throw new NotificationError('TEMPLATE_NOT_CONFIGURED', `No WATI template set for "${template}"`, { provider: this.name, tryNextChannel: true });
    }

    const values = Object.keys(rendered.whatsapp.variables)
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => String(rendered.whatsapp.variables[key]));
    const parameters = config.params.map((name, i) => ({ name, value: values[i] ?? '' }));

    const number = to.replace(/^\+/, '');
    const { status, body, text } = await postWithTimeout(this.name, `${this.apiEndpoint}/api/v1/sendTemplateMessage?whatsappNumber=${encodeURIComponent(number)}`, {
      headers: { Authorization: this.auth, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        template_name: config.name,
        broadcast_name: `${template}_${new Date().toISOString().slice(0, 10)}`,
        channel_number: this.channelNumber,
        parameters,
      }),
      timeoutMs: this.timeoutMs,
    });

    if (status >= 200 && status < 300 && body?.result === true) {
      return { providerMessageId: body.local_message_id ?? '', status: 'accepted' };
    }
    if (status >= 200 && status < 300) {
      // WATI reports business errors as 200 + result:false.
      if (body?.validWhatsAppNumber === false) {
        throw new NotificationError('NOT_ON_WHATSAPP', 'Number is not on WhatsApp', { provider: this.name, status, tryNextChannel: true });
      }
      const info = String(body?.info ?? 'WATI did not accept the message');
      if (/template/i.test(info)) {
        throw new NotificationError('TEMPLATE_REJECTED', `WATI: ${info}`, { provider: this.name, status, tryNextChannel: true });
      }
      throw new NotificationError('PROVIDER_REJECTED', `WATI: ${info}`, { provider: this.name, status });
    }
    throw errorFromStatus(this.name, status, body?.info ? `WATI: ${body.info}` : text);
  }
}
