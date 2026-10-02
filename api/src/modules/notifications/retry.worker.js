/**
 * Retry worker: every interval, re-sends notification_logs rows whose
 * next_retry_at has passed. Rows are claimed with FOR UPDATE SKIP LOCKED, so
 * running it in several API instances is safe.
 */
export function startRetryWorker({ notifier, logger, intervalMs = 60_000, batchSize = 50 }) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      // Drain in batches so a backlog after an outage clears quickly.
      for (;;) {
        const { claimed } = await notifier.retryFailed({ limit: batchSize });
        if (claimed < batchSize) break;
      }
    } catch (err) {
      logger.error('Notification retry worker error', { error: err.message });
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  logger.info('Notification retry worker started', { intervalMs });
  return {
    runNow: tick,
    stop: () => clearInterval(timer),
  };
}
