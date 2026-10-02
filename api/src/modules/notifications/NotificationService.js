import { randomUUID } from 'node:crypto';
import { ALL_ROLES } from '../../config/roles.js';
import { NotificationError } from './errors.js';
import { maskPhone, normalizePhone } from './phone.js';
import { TEMPLATES, smsSegments } from './templates.js';

/**
 * NotificationService — the School ERP communication engine.
 *
 * Sends parent/staff messages over WhatsApp (WATI or Twilio) with SMS fallback
 * (Twilio or MSG91), and records every dispatch in `notification_logs` so that
 * failures can be retried later.
 *
 *   const notifier = new NotificationService({ providers: { whatsapp, sms }, logStore, logger });
 *   await notifier.sendAbsenteeAlert('98110 42231', 'Aarav Sharma', '2026-10-02', { tenantId, studentId });
 *   await notifier.sendFeeDueReminder(phone, 'Ravi Sharma', 31000, '2026-10-10', link, { dedupeKey });
 *   await notifier.sendBroadcastNotice('parent', 'School closed on Monday', body, { tenantId, branchId });
 *   await notifier.retryFailed();           // called by the retry worker
 *
 * Guarantees, per message:
 *   - Never throws for delivery problems: returns { ok: true, ... } or { ok: false, error }.
 *   - Logged before the gateway is called (status 'sending'), then updated to sent / failed.
 *     A dedupeKey already in the log means "already handled": nothing is sent twice.
 *   - Fast in-process retries for transient errors (timeout, network, 429, 5xx) with
 *     exponential backoff + jitter; then slower retries from the log (5 min, 30 min, 2 h, 6 h).
 *   - WhatsApp first; if the person can't be reached there, SMS.
 *   - A failure to write the log never blocks a message: it's reported to the app logger.
 */
export class NotificationService {
  /**
   * @param {object} options
   * @param {{ sms?: Provider, whatsapp?: Provider }} options.providers
   * @param {LogStore} [options.logStore]           notification_logs access (createPgLogStore())
   * @param {object} [options.logger]               { info, warn, error }
   * @param {string} [options.schoolName]           default school name in message text
   * @param {('whatsapp'|'sms')[]} [options.channelOrder]
   * @param {{ attempts?: number, baseDelayMs?: number, maxDelayMs?: number }} [options.retry]  in-process retries
   * @param {(q: { role: string, tenantId?: string, branchId?: string }) => Promise<Recipient[]>} [options.recipientResolver]
   * @param {number} [options.concurrency]          parallel sends for broadcasts
   * @param {(ms: number) => Promise<void>} [options.sleep]
   *
   * @typedef {{ name: string, supports(channel: string): boolean, send(msg: object): Promise<{ providerMessageId: string }> }} Provider
   * @typedef {{ userId: string, name: string, phone: string | null, branchId?: string | null }} Recipient
   * @typedef {{ begin(e: object): Promise<{ id?: string, duplicate?: boolean }>, complete(id: string, r: object): Promise<void>,
   *             claimDue(limit: number): Promise<object[]>, claimOne(id: string): Promise<object|null> }} LogStore
   *
   * Every send method takes an optional `context`:
   *   { tenantId, branchId, studentId, recipientUserId, createdBy, batchId,
   *     dedupeKey, maxRetries, schoolName, channels }
   */
  constructor({
    providers = {},
    logStore,
    logger = console,
    schoolName = 'School',
    channelOrder = ['whatsapp', 'sms'],
    retry = {},
    recipientResolver,
    concurrency = 5,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }) {
    this.providers = providers;
    this.logStore = logStore;
    this.logger = logger;
    this.schoolName = schoolName;
    this.channelOrder = channelOrder.filter((channel) => providers[channel]?.supports(channel));
    this.retry = { attempts: 3, baseDelayMs: 400, maxDelayMs: 5_000, ...retry };
    this.recipientResolver = recipientResolver;
    this.concurrency = Math.max(1, concurrency);
    this.sleep = sleep;

    if (this.channelOrder.length === 0) {
      logger.warn('NotificationService has no usable channel; every send will fail', { configured: Object.keys(providers) });
    }
  }

  // =====================================================================
  // 1. Absentee alert
  // =====================================================================

  /**
   * Tells a parent their child was marked absent. Called the moment attendance is
   * submitted (via the attendance outbox) or directly.
   * @param {string} parentPhone
   * @param {string} studentName
   * @param {string|Date} date   YYYY-MM-DD or Date
   * @param {object} [context]
   */
  async sendAbsenteeAlert(parentPhone, studentName, date, context = {}) {
    return this.#guarded('absentee_alert', parentPhone, async () => {
      requireText(studentName, 'studentName', 100);
      requireDate(date, 'date');
      return this.#dispatch({
        eventType: context.eventType ?? 'absentee_alert',
        template: 'absentee_alert',
        to: parentPhone,
        vars: { studentName: studentName.trim(), date: isoDate(date), schoolName: context.schoolName ?? this.schoolName },
        context,
      });
    });
  }

  // =====================================================================
  // 2. Fee due reminder
  // =====================================================================

  /**
   * Template reminder for an upcoming or overdue fee, with a payment link.
   * For split dues, `amount` is the total of the open installments and `dueDate`
   * the earliest one (see jobs/fee-reminders.job.js).
   * @param {string} parentPhone
   * @param {string} parentName
   * @param {number|string} amount   rupees
   * @param {string|Date} dueDate
   * @param {string} paymentLink     https URL
   * @param {object} [context]
   */
  async sendFeeDueReminder(parentPhone, parentName, amount, dueDate, paymentLink, context = {}) {
    return this.#guarded('fee_due_reminder', parentPhone, async () => {
      requireText(parentName, 'parentName', 100);
      const rupees = Number(amount);
      if (!Number.isFinite(rupees) || rupees <= 0) throw invalid('amount must be a positive number of rupees');
      requireDate(dueDate, 'dueDate');
      let url;
      try {
        url = new URL(paymentLink);
      } catch {
        throw invalid('paymentLink must be a valid URL');
      }
      if (url.protocol !== 'https:') throw invalid('paymentLink must use https');

      return this.#dispatch({
        eventType: 'fee_due_reminder',
        template: 'fee_due_reminder',
        to: parentPhone,
        vars: {
          parentName: parentName.trim(),
          amount: rupees,
          dueDate: isoDate(dueDate),
          paymentLink: url.toString(),
          schoolName: context.schoolName ?? this.schoolName,
        },
        context,
      });
    });
  }

  // =====================================================================
  // 3. Broadcast notice
  // =====================================================================

  /**
   * Sends a notice to everyone with a role, e.g. all teachers or all parents of a
   * branch. Recipients are read from the database; one message per phone number.
   * Every message is logged under one batch_id for reporting and retries.
   * @param {'parent'|'teacher'|'student'|'branch_admin'|'super_admin'} targetRole
   * @param {string} noticeTitle
   * @param {string} noticeBody
   * @param {object} [context]   tenantId, branchId (scope), createdBy, batchId, schoolName, channels
   * @returns {Promise<{ ok: boolean, batchId: string, total: number, sent: number, failed: number, skipped: number, failures: object[] }>}
   */
  async sendBroadcastNotice(targetRole, noticeTitle, noticeBody, context = {}) {
    const batchId = context.batchId ?? randomUUID();
    const summary = { ok: false, batchId, targetRole, total: 0, sent: 0, failed: 0, skipped: 0, failures: [] };
    try {
      if (!ALL_ROLES.includes(targetRole)) throw invalid(`targetRole must be one of: ${ALL_ROLES.join(', ')}`);
      requireText(noticeTitle, 'noticeTitle', 150);
      requireText(noticeBody, 'noticeBody', 4000);
      if (!this.recipientResolver) throw new NotificationError('NOT_CONFIGURED', 'sendBroadcastNotice needs a recipientResolver');

      const recipients = context.recipients ?? (await this.recipientResolver({ role: targetRole, tenantId: context.tenantId, branchId: context.branchId }));

      // One message per phone number (shared family phones, siblings' parents).
      const byPhone = new Map();
      for (const person of recipients) {
        if (!person.phone) {
          summary.skipped += 1;
          continue;
        }
        let phone;
        try {
          phone = normalizePhone(person.phone);
        } catch {
          summary.skipped += 1;
          summary.failures.push({ userId: person.userId, phone: maskPhone(person.phone), code: 'INVALID_PHONE' });
          continue;
        }
        if (!byPhone.has(phone)) byPhone.set(phone, person);
      }
      summary.total = byPhone.size;

      const vars = { noticeTitle: noticeTitle.trim(), noticeBody: noticeBody.trim(), schoolName: context.schoolName ?? this.schoolName };
      const results = await mapWithConcurrency([...byPhone], this.concurrency, async ([phone, person]) => {
        const result = await this.#dispatch({
          eventType: 'broadcast_notice',
          template: 'general_notice',
          to: phone,
          vars,
          quiet: true,
          context: {
            ...context,
            branchId: person.branchId ?? context.branchId,
            recipientUserId: person.userId,
            batchId,
            dedupeKey: `broadcast:${batchId}:${phone}`,
          },
        });
        return { person, phone, result };
      });

      for (const { person, phone, result } of results) {
        if (result.ok) summary.sent += 1;
        else {
          summary.failed += 1;
          summary.failures.push({ userId: person.userId, phone: maskPhone(phone), code: result.error.code, logId: result.logId });
        }
      }
      summary.ok = summary.failed === 0;

      (summary.failed > 0 ? this.logger.warn : this.logger.info).call(this.logger, 'Broadcast notice dispatched', {
        batchId,
        targetRole,
        title: noticeTitle,
        total: summary.total,
        sent: summary.sent,
        failed: summary.failed,
        skipped: summary.skipped,
      });
      return summary;
    } catch (err) {
      const error = asNotificationError(err);
      this.logger.error('Broadcast notice failed', { batchId, targetRole, title: noticeTitle, error: error.toJSON() });
      return { ...summary, error: error.toJSON() };
    }
  }

  /** @deprecated Use sendBroadcastNotice. */
  async sendGeneralNotice(targetRole, noticeTitle, noticeBody, context = {}) {
    return this.sendBroadcastNotice(targetRole, noticeTitle, noticeBody, context);
  }

  // =====================================================================
  // Retries from notification_logs
  // =====================================================================

  /** Re-sends failed messages whose next_retry_at has passed. Used by the retry worker. */
  async retryFailed({ limit = 50 } = {}) {
    const summary = { claimed: 0, sent: 0, failed: 0 };
    if (!this.logStore) return summary;
    let rows;
    try {
      rows = await this.logStore.claimDue(limit);
    } catch (err) {
      this.logger.error('Could not read retry queue', { error: err.message });
      return summary;
    }
    summary.claimed = rows.length;
    await mapWithConcurrency(rows, this.concurrency, async (row) => {
      const result = await this.#resend(row);
      if (result.ok) summary.sent += 1;
      else summary.failed += 1;
    });
    if (rows.length) this.logger.info('Notification retries processed', summary);
    return summary;
  }

  /** Manual retry of one logged message (admin "Retry" button). */
  async retryLog(logId) {
    if (!this.logStore) throw new NotificationError('NOT_CONFIGURED', 'No log store configured');
    const row = await this.logStore.claimOne(logId);
    if (!row) return null; // not found, already sent, or being sent right now
    return this.#resend(row);
  }

  // =====================================================================
  // Adapter for the attendance outbox (parent_notifications)
  // =====================================================================

  /**
   * Lets dispatcher.js send queued attendance rows through this service. The
   * outbox has its own retry schedule, so these log rows are not auto-retried
   * (maxRetries 0) but still show up in notification_logs.
   */
  asOutboxProvider({ emailProvider } = {}) {
    return {
      name: `notification-service(${this.channelOrder.join('>') || 'none'})`,
      send: async (row) => {
        if (row.channel === 'email') {
          if (!emailProvider) throw new NotificationError('CHANNEL_NOT_SUPPORTED', 'No email provider configured');
          return emailProvider.send(row);
        }
        const context = {
          tenantId: row.tenant_id,
          branchId: row.branch_id,
          studentId: row.student_id,
          recipientUserId: row.parent_user_id,
          maxRetries: 0,
          schoolName: row.payload.schoolName,
        };
        let result;
        if (row.template === 'attendance_absent') {
          result = await this.sendAbsenteeAlert(row.recipient, row.payload.studentName, row.payload.date, context);
        } else if (row.template === 'attendance_correction') {
          result = await this.#guarded('attendance_correction', row.recipient, () =>
            this.#dispatch({
              eventType: 'attendance_correction',
              template: 'attendance_correction',
              to: row.recipient,
              vars: { studentName: row.payload.studentName, date: row.payload.date, schoolName: row.payload.schoolName ?? this.schoolName },
              context,
            }),
          );
        } else {
          throw new NotificationError('TEMPLATE_NOT_CONFIGURED', `No template for outbox type "${row.template}"`);
        }
        if (!result.ok) throw new NotificationError(result.error.code, result.error.message, { retryable: result.error.retryable });
        return { providerMessageId: result.providerMessageId };
      },
    };
  }

  // =====================================================================
  // Internals
  // =====================================================================

  /** Converts anything thrown (validation, bugs) into a logged { ok: false } result. */
  async #guarded(template, phone, work) {
    try {
      return await work();
    } catch (err) {
      const error = asNotificationError(err);
      this.logger.error('Notification not sent', { template, to: maskPhone(phone), error: error.toJSON() });
      return { ok: false, template, error: error.toJSON() };
    }
  }

  /** Log -> deliver -> log outcome. */
  async #dispatch({ eventType, template, to, vars, context = {}, quiet = false }) {
    const phoneForLog = safeNormalize(to) ?? String(to ?? '').trim().slice(0, 20);
    const channels = context.channels;

    let logId = null;
    if (this.logStore && context.log !== false) {
      try {
        const begun = await this.logStore.begin({
          tenantId: context.tenantId,
          branchId: context.branchId,
          batchId: context.batchId,
          eventType,
          template,
          recipientPhone: phoneForLog,
          recipientUserId: context.recipientUserId,
          studentId: context.studentId,
          payload: { vars, ...(channels && { channels }) },
          maxRetries: context.maxRetries,
          dedupeKey: context.dedupeKey,
          createdBy: context.createdBy,
        });
        if (begun.duplicate) {
          return { ok: true, duplicate: true, template, skipped: 'ALREADY_SENT' };
        }
        logId = begun.id;
      } catch (err) {
        // Losing the audit row is bad, but not sending an absence alert is worse.
        this.logger.error('Could not write notification log; sending anyway', { template, to: maskPhone(phoneForLog), error: err.message });
      }
    }

    let result;
    try {
      result = await this.#deliver({ template, to, vars, channels, quiet });
    } catch (err) {
      const error = asNotificationError(err);
      this.logger.error('Notification not sent', { template, to: maskPhone(phoneForLog), error: error.toJSON() });
      result = { ok: false, template, attempts: 0, error: error.toJSON() };
    }

    if (logId) {
      result.logId = logId;
      try {
        await this.logStore.complete(logId, result);
      } catch (err) {
        this.logger.error('Could not update notification log', { logId, error: err.message });
      }
    }
    return result;
  }

  /** Re-sends a claimed log row and records the new outcome on the same row. */
  async #resend(row) {
    let result;
    try {
      result = await this.#deliver({ template: row.template, to: row.recipient_phone, vars: row.payload.vars, channels: row.payload.channels, quiet: true });
    } catch (err) {
      const error = asNotificationError(err);
      result = { ok: false, template: row.template, attempts: 0, error: error.toJSON() };
    }
    result.logId = row.id;
    try {
      await this.logStore.complete(row.id, result);
    } catch (err) {
      this.logger.error('Could not update notification log after retry', { logId: row.id, error: err.message });
    }
    (result.ok ? this.logger.info : this.logger.warn).call(this.logger, result.ok ? 'Notification retry sent' : 'Notification retry failed', {
      logId: row.id,
      template: row.template,
      to: maskPhone(row.recipient_phone),
      retry: row.retry_count,
      ...(result.ok ? { channel: result.channel } : { error: result.error }),
    });
    return result;
  }

  /** Channel loop with in-process retries and fallback. Throws only for unusable input (bad phone, no channel). */
  async #deliver({ template, to, vars, channels, quiet = false }) {
    const phone = normalizePhone(to);
    const rendered = TEMPLATES[template].render(vars);
    const order = (channels ?? this.channelOrder).filter((c) => this.channelOrder.includes(c));
    if (order.length === 0) throw new NotificationError('NO_CHANNEL', 'No configured channel can send this message');

    const attempts = [];
    let lastError;
    for (const channel of order) {
      const provider = this.providers[channel];
      try {
        const sent = await this.#sendWithRetry(provider, { channel, to: phone, template, rendered }, attempts);
        const result = {
          ok: true,
          template,
          channel,
          provider: provider.name,
          providerMessageId: sent.providerMessageId,
          attempts: attempts.length + 1, // failed tries + the one that worked
          ...(channel === 'sms' && { smsSegments: smsSegments(rendered.sms.text) }),
        };
        if (!quiet) {
          this.logger.info('Notification sent', { template, channel, provider: provider.name, to: maskPhone(phone), providerMessageId: sent.providerMessageId, attempts: result.attempts });
        }
        if (attempts.some((a) => a.channel !== channel)) {
          this.logger.warn('Notification used fallback channel', { template, to: maskPhone(phone), deliveredVia: channel });
        }
        return result;
      } catch (err) {
        lastError = asNotificationError(err);
        if (!lastError.tryNextChannel) break; // invalid number, auth failure: another channel won't help
      }
    }

    this.logger.error('Notification dispatch failed', {
      template,
      to: maskPhone(phone),
      attempts: attempts.map((a) => ({ channel: a.channel, provider: a.provider, code: a.code, status: a.status })),
      error: lastError.toJSON(),
    });
    const last = attempts[attempts.length - 1];
    return { ok: false, template, attempts: attempts.length, lastAttempt: last, error: lastError.toJSON() };
  }

  async #sendWithRetry(provider, message, attempts) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await provider.send(message);
      } catch (err) {
        const error = asNotificationError(err, provider.name);
        attempts.push({ channel: message.channel, provider: provider.name, code: error.code, status: error.status });
        const canRetry = error.retryable && attempt < this.retry.attempts;
        this.logger.warn('Gateway call failed', {
          template: message.template,
          channel: message.channel,
          provider: provider.name,
          to: maskPhone(message.to),
          attempt,
          willRetry: canRetry,
          error: error.toJSON(),
        });
        if (!canRetry) throw error;
        const ceiling = Math.min(this.retry.maxDelayMs, this.retry.baseDelayMs * 2 ** (attempt - 1));
        await this.sleep(Math.round(Math.random() * ceiling)); // full jitter
      }
    }
  }
}

/* ---------------------------------------------------------------- helpers */

function invalid(message) {
  return new NotificationError('INVALID_INPUT', message);
}

function requireText(value, field, max) {
  if (typeof value !== 'string' || value.trim() === '') throw invalid(`${field} is required`);
  if (value.length > max) throw invalid(`${field} must be at most ${max} characters`);
}

function requireDate(value, field) {
  const ok = value instanceof Date ? !Number.isNaN(value.getTime()) : /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && !Number.isNaN(Date.parse(value));
  if (!ok) throw invalid(`${field} must be a YYYY-MM-DD date`);
}

/** Stored in the log payload, so it must survive JSON: always a YYYY-MM-DD string. */
function isoDate(value) {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  return String(value).slice(0, 10);
}

function safeNormalize(phone) {
  try {
    return normalizePhone(phone);
  } catch {
    return null;
  }
}

function asNotificationError(err, provider) {
  if (err instanceof NotificationError) return err;
  return new NotificationError('UNEXPECTED_ERROR', err?.message ?? String(err), { provider, cause: err });
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}
