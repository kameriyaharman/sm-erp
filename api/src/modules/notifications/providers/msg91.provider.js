import { NotificationError, errorFromStatus } from '../errors.js';
import { postWithTimeout } from '../http.js';

/**
 * MSG91 (India) — transactional SMS through a DLT-approved Flow.
 *   POST {baseUrl}/api/v5/flow/   header: authkey   body: { flow_id, sender, recipients: [{ mobiles, VAR1, ... }] }
 * Each template key maps to a Flow created in the MSG91 panel; the flow holds
 * the DLT template, so we only send the variable values (VAR1, VAR2, ... in
 * the order of `rendered.sms.variables`). Numbers go as 91XXXXXXXXXX, no "+".
 *
 * Docs: https://api.msg91.com/apidoc/textsms/send-sms-flow.php
 * Check the field names against your MSG91 panel: newer accounts may label
 * flows as templates (`template_id`); set `idField` accordingly.
 */
export class Msg91Provider {
  /**
   * @param {object} options
   * @param {string} options.authKey
   * @param {string} options.senderId                6-character DLT sender ID, e.g. "DPSDWK"
   * @param {Record<string, string>} options.flowIds  template key -> MSG91 flow ID
   * @param {'flow_id'|'template_id'} [options.idField]
   * @param {string} [options.baseUrl]
   * @param {number} [options.timeoutMs]
   */
  constructor({ authKey, senderId, flowIds = {}, idField = 'flow_id', baseUrl = 'https://api.msg91.com', timeoutMs = 10_000 }) {
    if (!authKey || !senderId) throw new Error('Msg91Provider needs authKey and senderId');
    this.name = 'msg91';
    this.authKey = authKey;
    this.senderId = senderId;
    this.flowIds = flowIds;
    this.idField = idField;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
  }

  supports(channel) {
    return channel === 'sms';
  }

  async send({ channel, to, template, rendered }) {
    if (channel !== 'sms') {
      throw new NotificationError('CHANNEL_NOT_SUPPORTED', `${this.name} provider only sends SMS`, { provider: this.name, tryNextChannel: true });
    }
    // A school's own template (Settings -> Message templates) carries its flow / DLT template ID.
    const flowId = rendered.sms?.templateId ?? this.flowIds[template];
    if (!flowId) {
      throw new NotificationError('TEMPLATE_NOT_CONFIGURED', `No DLT template / flow ID set for "${template}": add it under Settings -> Message templates`, { provider: this.name, tryNextChannel: true });
    }

    const recipient = { mobiles: to.replace(/^\+/, '') };
    rendered.sms.variables.forEach((value, index) => {
      recipient[`VAR${index + 1}`] = String(value);
    });

    const { status, body, text } = await postWithTimeout(this.name, `${this.baseUrl}/api/v5/flow/`, {
      headers: { authkey: this.authKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ [this.idField]: flowId, sender: this.senderId, recipients: [recipient] }),
      timeoutMs: this.timeoutMs,
    });

    // MSG91 can answer HTTP 200 with { type: "error" }, so the body decides.
    if (status >= 200 && status < 300 && body?.type === 'success') {
      return { providerMessageId: String(body.message ?? body.request_id ?? ''), status: 'accepted' };
    }
    const message = body?.message ? `MSG91: ${body.message}` : text;
    if (status >= 200 && status < 300) {
      const lower = String(body?.message ?? '').toLowerCase();
      if (lower.includes('authentication') || lower.includes('authkey')) {
        throw new NotificationError('AUTH_FAILED', message, { provider: this.name, status });
      }
      if (lower.includes('mobile') || lower.includes('number')) {
        throw new NotificationError('INVALID_PHONE', message, { provider: this.name, status });
      }
      throw new NotificationError('PROVIDER_REJECTED', message || 'MSG91 rejected the request', { provider: this.name, status });
    }
    throw errorFromStatus(this.name, status, message);
  }
}
