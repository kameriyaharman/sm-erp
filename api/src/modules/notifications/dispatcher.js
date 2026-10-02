import { randomUUID } from 'node:crypto';
import { pool } from '../../db/pool.js';
import { logger } from '../../utils/logger.js';
import { NotificationError } from './errors.js';

/**
 * Parent-notification dispatcher (transactional outbox consumer).
 *
 * Claims queued rows with FOR UPDATE SKIP LOCKED, so several API instances can
 * run it safely side by side, and hands each to a provider. The provider here
 * is a SIMULATION: it logs the message instead of calling an SMS/WhatsApp
 * gateway. Swap `simulatedProvider` for a real one (MSG91, Gupshup, Twilio...)
 * with the same `send()` signature.
 */

const BATCH_SIZE = 25;
const MAX_ATTEMPTS = 3;
const SWEEP_INTERVAL_MS = 15_000;
const STALE_SENDING_MINUTES = 5;

const maskPhone = (value) => value.replace(/\d(?=\d{3})/g, '•');
const maskEmail = (value) => value.replace(/^(.).*(@.*)$/, '$1•••$2');

export const simulatedProvider = {
  name: 'simulated',
  /** @returns {Promise<{ providerMessageId: string }>} */
  async send({ channel, recipient, message }) {
    await new Promise((resolve) => setTimeout(resolve, 40 + Math.random() * 80)); // network latency
    if (channel === 'sms' && !/^\+?\d{10,13}$/.test(recipient.replace(/[\s-]/g, ''))) {
      throw new Error(`Invalid phone number for SMS`);
    }
    const providerMessageId = `SIM-${randomUUID().slice(0, 8).toUpperCase()}`;
    logger.info('SIMULATED NOTIFICATION SENT', {
      channel,
      to: channel === 'email' ? maskEmail(recipient) : maskPhone(recipient),
      providerMessageId,
      text: message,
    });
    return { providerMessageId };
  },
};

let provider = simulatedProvider;
let timer = null;
let running = false;
let rerun = false;

async function claimBatch() {
  const { rows } = await pool.query(
    `UPDATE parent_notifications n
        SET status = 'sending', attempts = n.attempts + 1
      WHERE n.id IN (
            SELECT id FROM parent_notifications
             WHERE status = 'queued' AND next_attempt_at <= now()
             ORDER BY next_attempt_at
             LIMIT $1
             FOR UPDATE SKIP LOCKED)
      RETURNING n.id, n.channel, n.recipient, n.message, n.attempts, n.template, n.payload,
                n.tenant_id, n.branch_id, n.student_id, n.parent_user_id`,
    [BATCH_SIZE],
  );
  return rows;
}

async function deliver(notification) {
  try {
    const { providerMessageId } = await provider.send(notification);
    await pool.query(
      `UPDATE parent_notifications
          SET status = 'sent', sent_at = now(), provider_message_id = $2, last_error = NULL
        WHERE id = $1`,
      [notification.id, providerMessageId],
    );
  } catch (err) {
    // Known-permanent failures (invalid number, opted out, bad credentials) are not retried.
    const permanent = err instanceof NotificationError && !err.retryable;
    const finalAttempt = permanent || notification.attempts >= MAX_ATTEMPTS;
    await pool.query(
      `UPDATE parent_notifications
          SET status = $2::notification_status,
              last_error = left($3, 500),
              next_attempt_at = now() + make_interval(secs => $4)
        WHERE id = $1`,
      [notification.id, finalAttempt ? 'failed' : 'queued', err.message, 30 * 2 ** notification.attempts],
    );
    logger.warn('Notification delivery failed', { id: notification.id, attempt: notification.attempts, final: finalAttempt, error: err.message });
  }
}

/** Drains the queue. Overlapping calls coalesce into one extra pass. */
export async function runDispatcher() {
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  try {
    do {
      rerun = false;
      for (;;) {
        const batch = await claimBatch();
        if (batch.length === 0) break;
        await Promise.all(batch.map(deliver));
      }
    } while (rerun);
  } catch (err) {
    logger.error('Notification dispatcher error', { error: err.message });
  } finally {
    running = false;
  }
}

/** Fire-and-forget nudge after a commit that queued notifications. */
export function kickDispatcher() {
  setImmediate(() => {
    runDispatcher();
  });
}

export async function startNotificationDispatcher({ intervalMs = SWEEP_INTERVAL_MS, customProvider } = {}) {
  if (customProvider) provider = customProvider;
  // Rows left in 'sending' by a crashed process go back to the queue.
  await pool.query(
    `UPDATE parent_notifications SET status = 'queued'
      WHERE status = 'sending' AND updated_at < now() - make_interval(mins => $1)`,
    [STALE_SENDING_MINUTES],
  );
  timer = setInterval(runDispatcher, intervalMs);
  timer.unref();
  kickDispatcher();
  logger.info('Notification dispatcher started', { provider: provider.name, intervalMs });
}

export function stopNotificationDispatcher() {
  if (timer) clearInterval(timer);
  timer = null;
}
