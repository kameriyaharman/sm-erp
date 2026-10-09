import { NotificationError, errorFromStatus } from '../errors.js';
import { postWithTimeout } from '../http.js';

/**
 * WhatsApp Cloud API (Meta, direct): a school connects its own WhatsApp Business number.
 *
 *   POST {graph}/{version}/{phoneNumberId}/messages   Authorization: Bearer <system user token>
 *   { messaging_product: "whatsapp", to, type: "template",
 *     template: { name, language: { code }, components: [{ type: "body", parameters: [{ type: "text", text }] }] } }
 *
 * Business-initiated messages must use a template Meta has approved for the number's WhatsApp
 * Business Account (WABA). The template name and parameter order come from the school's saved
 * template, else from the catalog default (`rendered.whatsapp.defaultName`).
 *
 * Also: verify() reads the phone number's display name and quality rating, listTemplates() /
 * submitTemplate() read and create templates on the WABA (approval status for the settings screen).
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 */

// Graph API error codes worth treating specially (others map by HTTP status).
const META_CODES = {
  131026: { code: 'NOT_ON_WHATSAPP', message: 'Message undeliverable: the number may not be on WhatsApp', tryNextChannel: true },
  131047: { code: 'OUTSIDE_SESSION_WINDOW', message: 'More than 24 hours since the last reply: a template is required', tryNextChannel: true },
  131051: { code: 'PROVIDER_REJECTED', message: 'Unsupported message type' },
  132000: { code: 'TEMPLATE_REJECTED', message: 'Template parameters do not match the approved template', tryNextChannel: true },
  132001: { code: 'TEMPLATE_REJECTED', message: 'Template does not exist in this language or is not approved', tryNextChannel: true },
  132015: { code: 'TEMPLATE_REJECTED', message: 'Template is paused because of low quality', tryNextChannel: true },
  132016: { code: 'TEMPLATE_REJECTED', message: 'Template is disabled', tryNextChannel: true },
  131056: { code: 'RATE_LIMITED', message: 'Too many messages to this number in a short time', retryable: true },
  130429: { code: 'RATE_LIMITED', message: 'WhatsApp throughput limit reached', retryable: true },
  131048: { code: 'RATE_LIMITED', message: 'Spam rate limit hit: too many messages were blocked or reported', retryable: false },
  190: { code: 'AUTH_FAILED', message: 'Access token expired or invalid' },
  10: { code: 'AUTH_FAILED', message: 'The token lacks whatsapp_business_messaging permission' },
  200: { code: 'AUTH_FAILED', message: 'The token lacks permission for this phone number' },
  100: { code: 'PROVIDER_REJECTED', message: 'Invalid request parameter' },
  131030: { code: 'INVALID_PHONE', message: 'Recipient number is not in the allowed list (test number)' },
  131009: { code: 'PROVIDER_REJECTED', message: 'Parameter value is not valid' },
};

export class MetaCloudProvider {
  /**
   * @param {object} options
   * @param {string} options.phoneNumberId     "Phone number ID" from WhatsApp Manager / the app's API setup page
   * @param {string} options.accessToken       permanent System User token with whatsapp_business_messaging
   * @param {string} [options.wabaId]          WhatsApp Business Account ID (templates)
   * @param {string} [options.graphVersion]    e.g. v25.0
   * @param {string} [options.baseUrl]
   * @param {Record<string, { name: string, language?: string }>} [options.templates]  event -> approved template, when not in `rendered`
   * @param {number} [options.timeoutMs]
   */
  constructor({ phoneNumberId, accessToken, wabaId, graphVersion = 'v25.0', baseUrl = 'https://graph.facebook.com', templates = {}, timeoutMs = 10_000 }) {
    if (!phoneNumberId || !accessToken) throw new Error('MetaCloudProvider needs phoneNumberId and accessToken');
    this.name = 'meta_cloud';
    this.phoneNumberId = String(phoneNumberId).trim();
    this.wabaId = wabaId ? String(wabaId).trim() : null;
    this.auth = `Bearer ${String(accessToken).replace(/^Bearer\s+/i, '')}`;
    this.base = `${baseUrl.replace(/\/$/, '')}/${graphVersion}`;
    this.templates = templates;
    this.timeoutMs = timeoutMs;
  }

  supports(channel) {
    return channel === 'whatsapp';
  }

  async send({ channel, to, template, rendered }) {
    if (channel !== 'whatsapp') {
      throw new NotificationError('CHANNEL_NOT_SUPPORTED', 'WhatsApp Cloud API only sends WhatsApp', { provider: this.name, tryNextChannel: true });
    }
    const wa = rendered.whatsapp ?? {};
    const name = wa.name ?? this.templates[template]?.name ?? wa.defaultName;
    if (!name) {
      throw new NotificationError('TEMPLATE_NOT_CONFIGURED', `No approved WhatsApp template set for "${template}"`, { provider: this.name, tryNextChannel: true });
    }
    const values = Object.keys(wa.variables ?? {})
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => String(wa.variables[k] ?? ''));
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to.replace(/^\+/, ''),
      type: 'template',
      template: {
        name,
        language: { code: wa.language ?? this.templates[template]?.language ?? 'en' },
        ...(values.length > 0 && { components: [{ type: 'body', parameters: values.map((text) => ({ type: 'text', text: text || '-' })) }] }),
      },
    };

    const { status, body, text } = await postWithTimeout(this.name, `${this.base}/${encodeURIComponent(this.phoneNumberId)}/messages`, {
      headers: { Authorization: this.auth, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      timeoutMs: this.timeoutMs,
    });
    if (status >= 200 && status < 300 && body?.messages?.[0]?.id) {
      return { providerMessageId: body.messages[0].id, status: body.messages[0].message_status ?? 'accepted' };
    }
    throw this.#mapError(status, body?.error, text);
  }

  /** "Test connection": the number's display name and quality rating. */
  async verify() {
    const { status, body, text } = await this.#get(`${this.base}/${encodeURIComponent(this.phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating,code_verification_status`);
    if (status >= 200 && status < 300 && body?.id) {
      return {
        ok: true,
        message: `Connected to ${body.verified_name ?? 'your WhatsApp Business number'} (${body.display_phone_number ?? this.phoneNumberId}).`,
        details: { displayPhoneNumber: body.display_phone_number ?? null, verifiedName: body.verified_name ?? null, qualityRating: body.quality_rating ?? null },
      };
    }
    const err = this.#mapError(status, body?.error, text);
    return { ok: false, reason: err.code === 'AUTH_FAILED' ? 'invalid_credentials' : err.retryable ? 'unreachable' : 'rejected', message: err.message };
  }

  /** Templates on the WABA with their approval status. */
  async listTemplates() {
    if (!this.wabaId) throw new NotificationError('NOT_CONFIGURED', 'Add the WhatsApp Business Account ID to read templates', { provider: this.name });
    const out = [];
    let url = `${this.base}/${encodeURIComponent(this.wabaId)}/message_templates?fields=id,name,status,language,category,rejected_reason,components&limit=100`;
    for (let page = 0; url && page < 10; page += 1) {
      const { status, body, text } = await this.#get(url);
      if (status < 200 || status >= 300) throw this.#mapError(status, body?.error, text);
      for (const t of body?.data ?? []) {
        out.push({
          id: t.id,
          name: t.name,
          status: String(t.status ?? '').toLowerCase(),
          language: t.language,
          category: t.category,
          rejectedReason: t.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : null,
          body: (t.components ?? []).find((c) => c.type === 'BODY')?.text ?? null,
        });
      }
      url = body?.paging?.next ?? null;
    }
    return out;
  }

  /**
   * Submits a UTILITY template for approval. `body` uses {{1}}, {{2}} ...; `examples` are sample
   * values for each (Meta requires them).
   */
  async submitTemplate({ name, language = 'en', body, examples = [] }) {
    if (!this.wabaId) throw new NotificationError('NOT_CONFIGURED', 'Add the WhatsApp Business Account ID to submit templates', { provider: this.name });
    const component = { type: 'BODY', text: body, ...(examples.length > 0 && { example: { body_text: [examples.map((e) => String(e || 'sample'))] } }) };
    const { status, body: res, text } = await postWithTimeout(this.name, `${this.base}/${encodeURIComponent(this.wabaId)}/message_templates`, {
      headers: { Authorization: this.auth, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ name, language, category: 'UTILITY', components: [component] }),
      timeoutMs: this.timeoutMs,
    });
    if (status >= 200 && status < 300 && res?.id) return { id: res.id, status: String(res.status ?? 'pending').toLowerCase() };
    throw this.#mapError(status, res?.error, text);
  }

  async #get(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, { headers: { Authorization: this.auth, Accept: 'application/json' }, signal: controller.signal });
      const text = await response.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      return { status: response.status, body, text: text.slice(0, 500) };
    } catch (err) {
      if (err.name === 'AbortError') throw new NotificationError('TIMEOUT', `No response from WhatsApp within ${this.timeoutMs} ms`, { provider: this.name, retryable: true });
      throw new NotificationError('NETWORK_ERROR', `Could not reach WhatsApp: ${err.cause?.code ?? err.message}`, { provider: this.name, retryable: true });
    } finally {
      clearTimeout(timer);
    }
  }

  #mapError(status, error, text) {
    const code = error?.code;
    const known = META_CODES[code] ?? META_CODES[error?.error_subcode];
    const detail = error?.error_data?.details ?? error?.message;
    if (known) {
      return new NotificationError(known.code, detail ? `${known.message}: ${detail}` : known.message, {
        provider: this.name,
        status,
        providerCode: code,
        retryable: known.retryable,
        tryNextChannel: known.tryNextChannel,
      });
    }
    return errorFromStatus(this.name, status, detail ? `WhatsApp: ${detail}` : text, code);
  }
}
