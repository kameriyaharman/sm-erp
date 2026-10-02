import { NotificationService } from './NotificationService.js';
import { Msg91Provider } from './providers/msg91.provider.js';
import { SimulatedProvider } from './providers/simulated.provider.js';
import { TwilioProvider } from './providers/twilio.provider.js';
import { DEFAULT_WATI_TEMPLATES, WatiProvider } from './providers/wati.provider.js';
import { createPgLogStore } from './notification-logs.repository.js';
import { findNoticeRecipients } from './recipients.repository.js';

export { NotificationService } from './NotificationService.js';

let shared;
/** Process-wide instance used by routes, the dispatcher and the retry worker. */
export function getNotifier({ env, logger }) {
  shared ??= createNotificationService({ env, logger });
  return shared;
}
export { NotificationError } from './errors.js';

/**
 * Builds the NotificationService from environment configuration.
 *   NOTIFY_SMS_PROVIDER       simulated | twilio | msg91 | none
 *   NOTIFY_WHATSAPP_PROVIDER  none | wati | twilio | simulated
 * Every dispatch is recorded in notification_logs (pass logStore: null to disable).
 */
export function createNotificationService({ env, logger, recipientResolver = findNoticeRecipients, logStore = createPgLogStore() }) {
  let twilio;
  const getTwilio = () => {
    twilio ??= new TwilioProvider({
      accountSid: env.TWILIO_ACCOUNT_SID,
      authToken: env.TWILIO_AUTH_TOKEN,
      smsFrom: env.TWILIO_SMS_FROM,
      messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID,
      whatsappFrom: env.TWILIO_WHATSAPP_FROM,
      contentSids: {
        absentee_alert: env.TWILIO_CONTENT_SID_ABSENTEE,
        fee_due_reminder: env.TWILIO_CONTENT_SID_FEE_DUE,
        general_notice: env.TWILIO_CONTENT_SID_NOTICE,
        attendance_correction: env.TWILIO_CONTENT_SID_ATTENDANCE_CORRECTION,
      },
      timeoutMs: env.NOTIFY_TIMEOUT_MS,
    });
    return twilio;
  };
  let simulated;
  const getSimulated = () =>
    (simulated ??= new SimulatedProvider({
      logger,
      failPermanently: env.NOTIFY_SIMULATED_FAIL_ALWAYS ?? [],
      failTransient: Object.fromEntries((env.NOTIFY_SIMULATED_FAIL_TRANSIENT ?? []).map((pair) => {
        const [number, times] = pair.split(':');
        return [number, Number(times) || 1];
      })),
    }));

  const sms = {
    simulated: getSimulated,
    twilio: getTwilio,
    msg91: () =>
      new Msg91Provider({
        authKey: env.MSG91_AUTH_KEY,
        senderId: env.MSG91_SENDER_ID,
        flowIds: {
          absentee_alert: env.MSG91_FLOW_ABSENTEE,
          fee_due_reminder: env.MSG91_FLOW_FEE_DUE,
          general_notice: env.MSG91_FLOW_NOTICE,
          attendance_correction: env.MSG91_FLOW_ATTENDANCE_CORRECTION,
        },
        timeoutMs: env.NOTIFY_TIMEOUT_MS,
      }),
    none: () => undefined,
  }[env.NOTIFY_SMS_PROVIDER]();

  const watiTemplate = (key, name) => (name ? { ...DEFAULT_WATI_TEMPLATES[key], name } : DEFAULT_WATI_TEMPLATES[key]);
  const whatsapp = {
    wati: () =>
      new WatiProvider({
        apiEndpoint: env.WATI_API_ENDPOINT,
        accessToken: env.WATI_ACCESS_TOKEN,
        channelNumber: env.WATI_CHANNEL_NUMBER,
        templates: {
          absentee_alert: watiTemplate('absentee_alert', env.WATI_TEMPLATE_ABSENTEE),
          fee_due_reminder: watiTemplate('fee_due_reminder', env.WATI_TEMPLATE_FEE_DUE),
          general_notice: watiTemplate('general_notice', env.WATI_TEMPLATE_NOTICE),
          attendance_correction: watiTemplate('attendance_correction', env.WATI_TEMPLATE_ATTENDANCE_CORRECTION),
        },
        timeoutMs: env.NOTIFY_TIMEOUT_MS,
      }),
    twilio: getTwilio,
    simulated: getSimulated,
    none: () => undefined,
  }[env.NOTIFY_WHATSAPP_PROVIDER]();

  const service = new NotificationService({
    providers: { sms, whatsapp },
    logStore: logStore ?? undefined,
    logger,
    schoolName: env.NOTIFY_SCHOOL_NAME,
    channelOrder: env.NOTIFY_CHANNEL_ORDER,
    retry: { attempts: env.NOTIFY_MAX_ATTEMPTS },
    recipientResolver,
  });

  logger.info('Notification service ready', {
    sms: sms?.name ?? 'none',
    whatsapp: whatsapp?.name ?? 'none',
    channelOrder: service.channelOrder,
  });
  return service;
}
