import { z } from 'zod';
import { NotificationError } from './errors.js';
import { getWithTimeout } from './http.js';
import { SmtpEmailProvider } from './providers/email.provider.js';
import { MetaCloudProvider } from './providers/meta-cloud.provider.js';
import { Msg91Provider } from './providers/msg91.provider.js';
import { TwilioProvider } from './providers/twilio.provider.js';
import { WatiProvider } from './providers/wati.provider.js';

/**
 * The providers a school can connect per channel, the fields each one needs, and how to turn a
 * saved communication_channels row into a working provider.
 *
 * `config` fields are stored as JSON and shown back on the screen; `secrets` are encrypted
 * (AES-256-GCM, per school) and only ever shown as "set, ending ••••ab12".
 */

const e164ish = z.string().trim().regex(/^\+?\d{8,15}$/, 'Phone number with country code, e.g. +919876543210');
const httpsUrl = z.string().trim().url().refine((u) => u.startsWith('https://'), 'Must start with https://');

export const PROVIDERS = Object.freeze({
  whatsapp: {
    platform: {
      label: 'SM ERP WhatsApp (shared number)',
      help: 'Messages go out from the SM ERP number with SM ERP-approved templates. Counted against your plan.',
      config: z.object({}).strict(),
      secrets: [],
    },
    meta_cloud: {
      label: 'Own number: WhatsApp Cloud API (Meta)',
      help: "Your school's own WhatsApp Business number, connected directly to Meta. Templates are approved on your WhatsApp Business Account.",
      config: z
        .object({
          phoneNumberId: z.string().trim().regex(/^\d{6,25}$/, 'Phone number ID from WhatsApp Manager (digits)'),
          wabaId: z.string().trim().regex(/^\d{6,25}$/, 'WhatsApp Business Account ID (digits)'),
          displayNumber: e164ish.optional().nullable(),
        })
        .strict(),
      secrets: [{ key: 'accessToken', label: 'Permanent access token (System User)', minLength: 20 }],
    },
    wati: {
      label: 'Own number: WATI',
      help: 'Your number on WATI. Template names must match the ones approved in your WATI account.',
      config: z.object({ apiEndpoint: httpsUrl, channelNumber: e164ish }).strict(),
      secrets: [{ key: 'accessToken', label: 'WATI access token', minLength: 20 }],
    },
    twilio: {
      label: 'Own number: Twilio',
      help: 'Your WhatsApp sender on Twilio. Templates are Content SIDs (HX...).',
      config: z.object({ accountSid: z.string().trim().regex(/^AC[0-9a-fA-F]{32}$/, 'Account SID (AC...)'), whatsappFrom: e164ish }).strict(),
      secrets: [{ key: 'authToken', label: 'Auth token', minLength: 16 }],
    },
  },
  sms: {
    platform: {
      label: 'SM ERP SMS (shared sender ID)',
      help: 'SMS from the SM ERP DLT sender ID and templates. Counted against your plan.',
      config: z.object({}).strict(),
      secrets: [],
    },
    msg91: {
      label: 'Own sender ID: MSG91',
      help: 'Your DLT-registered sender ID and templates on MSG91.',
      config: z
        .object({
          senderId: z.string().trim().regex(/^[A-Z]{6}$/, 'The 6-letter DLT sender ID, e.g. DPSDWK'),
          idField: z.enum(['flow_id', 'template_id']).default('template_id'),
        })
        .strict(),
      secrets: [{ key: 'authKey', label: 'MSG91 auth key', minLength: 16 }],
    },
    twilio: {
      label: 'Own sender: Twilio',
      help: 'SMS through your Twilio account.',
      config: z
        .object({
          accountSid: z.string().trim().regex(/^AC[0-9a-fA-F]{32}$/, 'Account SID (AC...)'),
          smsFrom: e164ish.optional().nullable(),
          messagingServiceSid: z.string().trim().regex(/^MG[0-9a-fA-F]{32}$/, 'Messaging Service SID (MG...)').optional().nullable(),
        })
        .strict()
        .refine((c) => c.smsFrom || c.messagingServiceSid, { message: 'Enter a sender number or a Messaging Service SID', path: ['smsFrom'] }),
      secrets: [{ key: 'authToken', label: 'Auth token', minLength: 16 }],
    },
  },
  email: {
    platform: {
      label: 'SM ERP email (no-reply)',
      help: 'Emails from the SM ERP no-reply address, with your reply-to address. Counted against your plan.',
      config: z.object({}).strict(),
      secrets: [],
    },
    smtp: {
      label: "Own mailbox: SMTP (Gmail, Zoho, Microsoft 365, SES ...)",
      help: "Emails come from your school's own address. For Gmail / Google Workspace use smtp.gmail.com, port 587 and an app password.",
      config: z
        .object({
          host: z.string().trim().min(3).max(200).regex(/^[A-Za-z0-9.-]+$/, 'Host name only, e.g. smtp.gmail.com'),
          port: z.coerce.number().int().min(1).max(65535).default(587),
          user: z.string().trim().min(1).max(200),
          fromEmail: z.string().trim().email().max(150),
          fromName: z.string().trim().max(80).optional().nullable(),
        })
        .strict(),
      secrets: [{ key: 'password', label: 'Password / app password', minLength: 4 }],
    },
  },
});

export const PROVIDER_KEYS = Object.freeze(Object.fromEntries(Object.entries(PROVIDERS).map(([ch, p]) => [ch, Object.keys(p)])));

/** Screen description of providers (labels, help, field lists). */
export function describeProviders() {
  const out = {};
  for (const [channel, providers] of Object.entries(PROVIDERS)) {
    out[channel] = Object.entries(providers).map(([key, def]) => ({
      key,
      label: def.label,
      help: def.help,
      configFields: Object.keys(def.config._def.schema?.shape ?? def.config.shape ?? {}),
      secrets: def.secrets.map((s) => ({ key: s.key, label: s.label })),
    }));
  }
  return out;
}

/**
 * A working provider for a saved channel (config + decrypted secrets).
 * @param {'whatsapp'|'sms'|'email'} channel
 * @param {string} provider
 * @param {object} config
 * @param {object} secrets
 * @param {{ env: object }} deps
 */
export function buildProvider(channel, provider, config, secrets, { env }) {
  const timeoutMs = env.NOTIFY_TIMEOUT_MS ?? 10_000;
  switch (`${channel}:${provider}`) {
    case 'whatsapp:meta_cloud':
      return new MetaCloudProvider({
        phoneNumberId: config.phoneNumberId,
        wabaId: config.wabaId,
        accessToken: secrets.accessToken,
        graphVersion: env.META_GRAPH_VERSION,
        baseUrl: env.META_GRAPH_BASE,
        timeoutMs,
      });
    case 'whatsapp:wati':
      return new WatiProvider({ apiEndpoint: config.apiEndpoint, accessToken: secrets.accessToken, channelNumber: config.channelNumber, timeoutMs });
    case 'whatsapp:twilio':
      return new TwilioProvider({ accountSid: config.accountSid, authToken: secrets.authToken, whatsappFrom: config.whatsappFrom, timeoutMs });
    case 'sms:msg91':
      return new Msg91Provider({ authKey: secrets.authKey, senderId: config.senderId, idField: config.idField ?? 'template_id', timeoutMs });
    case 'sms:twilio':
      return new TwilioProvider({
        accountSid: config.accountSid,
        authToken: secrets.authToken,
        smsFrom: config.smsFrom ?? undefined,
        messagingServiceSid: config.messagingServiceSid ?? undefined,
        timeoutMs,
      });
    case 'email:smtp':
      return new SmtpEmailProvider({
        host: config.host,
        port: config.port,
        user: config.user,
        password: secrets.password,
        fromEmail: config.fromEmail,
        fromName: config.fromName ?? undefined,
        replyTo: config.replyTo ?? undefined,
        timeoutMs: Math.max(timeoutMs, 15_000),
      });
    default:
      throw new NotificationError('NOT_CONFIGURED', `Unknown provider ${provider} for ${channel}`);
  }
}

/**
 * "Test connection" for a built provider.
 * Returns { ok: true|false|null, message, details? }; null = this provider has no read-only
 * check, send a test message instead.
 */
export async function verifyProvider(channel, provider, instance, config, secrets, { env }) {
  if (typeof instance.verify === 'function') return instance.verify();
  if (provider === 'twilio') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.NOTIFY_TIMEOUT_MS ?? 10_000);
    try {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}.json`, {
        headers: { Authorization: `Basic ${Buffer.from(`${config.accountSid}:${secrets.authToken}`).toString('base64')}` },
        signal: controller.signal,
      });
      if (res.ok) return { ok: true, message: 'Twilio accepted the Account SID and auth token.' };
      if (res.status === 401 || res.status === 404) return { ok: false, reason: 'invalid_credentials', message: 'Twilio did not accept the Account SID and auth token.' };
      return { ok: false, reason: 'unreachable', message: `Twilio answered ${res.status}. Try again in a minute.` };
    } catch {
      return { ok: false, reason: 'unreachable', message: 'Twilio could not be reached.' };
    } finally {
      clearTimeout(timer);
    }
  }
  if (provider === 'wati') {
    // A harmless authenticated read: one contact.
    try {
      const { status } = await getWithTimeout('wati', `${config.apiEndpoint.replace(/\/$/, '')}/api/v1/getContacts?pageSize=1&pageNumber=1`, {
        headers: { Authorization: `Bearer ${String(secrets.accessToken).replace(/^Bearer\s+/i, '')}`, Accept: 'application/json' },
        timeoutMs: env.NOTIFY_TIMEOUT_MS ?? 10_000,
      });
      if (status >= 200 && status < 300) return { ok: true, message: 'WATI accepted the API endpoint and token.' };
      if (status === 401 || status === 403) return { ok: false, reason: 'invalid_credentials', message: 'WATI did not accept the access token.' };
      return { ok: null, message: `WATI answered ${status} to the check. Send a test message to confirm.` };
    } catch {
      return { ok: false, reason: 'unreachable', message: 'WATI could not be reached at that API endpoint.' };
    }
  }
  return { ok: null, message: 'Saved. This provider has no read-only check: send a test message to confirm it works.' };
}
