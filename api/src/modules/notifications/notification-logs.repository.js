import { pool } from '../../db/pool.js';

// Wait before automatic retry number 1, 2, 3, 4 (minutes).
export const RETRY_BACKOFF_MINUTES = [5, 30, 120, 360];
const STUCK_SENDING_MINUTES = 10;

/**
 * Postgres-backed store for notification_logs. The NotificationService only
 * talks to this interface, so tests can swap in an in-memory store.
 *
 *   begin(entry)        -> { id } | { duplicate: true }    row written BEFORE the gateway call
 *   complete(id, result)                                   outcome + next retry time
 *   claimDue(limit)     -> rows                            failed rows whose retry time has come
 *   claimOne(id)        -> row | null                      manual retry from the admin screen
 */
export function createPgLogStore(db = pool) {
  return {
    async begin(entry) {
      const params = [
        entry.tenantId ?? null, entry.branchId ?? null, entry.batchId ?? null, entry.eventType, entry.template,
        entry.recipientPhone, entry.recipientUserId ?? null, entry.studentId ?? null, JSON.stringify(entry.payload),
        entry.maxRetries ?? RETRY_BACKOFF_MINUTES.length, entry.dedupeKey ?? null, entry.createdBy ?? null,
      ];
      const { rows } = await db.query(
        `INSERT INTO notification_logs
                (tenant_id, branch_id, batch_id, event_type, template, recipient_phone, recipient_user_id,
                 student_id, payload, max_retries, dedupe_key, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ${entry.dedupeKey ? `ON CONFLICT (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), dedupe_key)
                              WHERE dedupe_key IS NOT NULL DO NOTHING` : ''}
         RETURNING id`,
        params,
      );
      return rows.length ? { id: rows[0].id } : { duplicate: true };
    },

    /**
     * Records the outcome. Retryable failures get a next_retry_at until
     * max_retries is used up (then 'abandoned'); permanent failures stay
     * 'failed' with no retry time, for an admin to fix the data and retry by hand.
     */
    async complete(id, result) {
      const ok = Boolean(result.ok);
      const retryable = !ok && Boolean(result.error?.retryable);
      await db.query(
        `UPDATE notification_logs
            SET status = CASE
                           WHEN $2 THEN 'sent'
                           WHEN $3 AND retry_count >= max_retries THEN 'abandoned'
                           ELSE 'failed'
                         END::notification_log_status,
                next_retry_at = CASE
                           WHEN NOT $2 AND $3 AND retry_count < max_retries
                           THEN now() + make_interval(mins => ($4::int[])[LEAST(retry_count + 1, array_length($4::int[], 1))])
                         END,
                sent_at = CASE WHEN $2 THEN now() END,
                attempts = attempts + $5,
                channel = COALESCE($6, channel),
                provider = COALESCE($7, provider),
                provider_message_id = COALESCE($8, provider_message_id),
                last_error_code = $9,
                last_error_message = left($10, 500),
                last_http_status = $11
          WHERE id = $1`,
        [
          id, ok, retryable, RETRY_BACKOFF_MINUTES, result.attempts ?? 0,
          result.channel ?? result.lastAttempt?.channel ?? null,
          result.provider ?? result.lastAttempt?.provider ?? null,
          result.providerMessageId ?? null,
          ok ? null : result.error?.code ?? 'UNKNOWN',
          ok ? null : result.error?.message ?? null,
          ok ? null : result.error?.status ?? null,
        ],
      );
    },

    /** Claims due retries (safe with several workers) and recovers rows stuck in 'sending'. */
    async claimDue(limit = 50) {
      await db.query(
        `UPDATE notification_logs
            SET status = 'failed', next_retry_at = now(),
                last_error_code = COALESCE(last_error_code, 'INTERRUPTED'),
                last_error_message = COALESCE(last_error_message, 'Process stopped before the gateway answered')
          WHERE status = 'sending' AND updated_at < now() - make_interval(mins => $1) AND retry_count < max_retries`,
        [STUCK_SENDING_MINUTES],
      );
      const { rows } = await db.query(
        `UPDATE notification_logs n
            SET status = 'sending', retry_count = n.retry_count + 1, next_retry_at = NULL
          WHERE n.id IN (
                SELECT id FROM notification_logs
                 WHERE status = 'failed' AND next_retry_at IS NOT NULL AND next_retry_at <= now()
                 ORDER BY next_retry_at
                 LIMIT $1
                 FOR UPDATE SKIP LOCKED)
          RETURNING n.*`,
        [limit],
      );
      return rows;
    },

    async claimOne(id) {
      const { rows } = await db.query(
        `UPDATE notification_logs
            SET status = 'sending', retry_count = retry_count + 1, next_retry_at = NULL,
                max_retries = GREATEST(max_retries, retry_count + 1)
          WHERE id = $1 AND status IN ('failed', 'abandoned')
          RETURNING *`,
        [id],
      );
      return rows[0] ?? null;
    },
  };
}

// ---------------------------------------------------------------- admin queries

export async function findLog(id) {
  const { rows } = await pool.query(`SELECT * FROM notification_logs WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/**
 * Delivery log, newest first. Filters: status, eventType, batchId, from / to (day the message
 * was queued, school time zone), search (phone digits; recipient / student name; admission no.).
 */
export async function listLogs({ tenantId, branchIds, status, eventType, batchId, from, to, search, page, limit }) {
  const like = search ? `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const phoneDigits = search && /^[+\d\s-]{4,}$/.test(search) ? search.replace(/\D/g, '').slice(-10) : '';
  const digits = phoneDigits.length >= 4 ? phoneDigits : null;
  const { rows } = await pool.query(
    `SELECT l.id, l.tenant_id, l.branch_id, l.batch_id, l.event_type, l.template, l.channel, l.provider,
            l.recipient_phone, l.recipient_user_id, concat_ws(' ', u.first_name, u.last_name) AS recipient_name,
            l.student_id, concat_ws(' ', su.first_name, su.last_name) AS student_name,
            l.status, l.attempts, l.retry_count, l.max_retries, l.next_retry_at,
            l.last_error_code, l.last_error_message, l.last_http_status, l.provider_message_id,
            l.sent_at, l.created_at, l.updated_at,
            count(*) OVER () AS total_count
       FROM notification_logs l
       LEFT JOIN tenants t           ON t.id = l.tenant_id
       LEFT JOIN users u             ON u.id = l.recipient_user_id
       LEFT JOIN student_profiles sp ON sp.id = l.student_id
       LEFT JOIN users su            ON su.id = sp.user_id
      WHERE ($1::uuid   IS NULL OR l.tenant_id = $1)
        AND ($2::uuid[] IS NULL OR l.branch_id = ANY ($2))
        AND ($3::notification_log_status IS NULL OR l.status = $3)
        AND ($4::text   IS NULL OR l.event_type = $4)
        AND ($5::uuid   IS NULL OR l.batch_id = $5)
        AND ($8::date   IS NULL OR (l.created_at AT TIME ZONE COALESCE(t.timezone, 'Asia/Kolkata'))::date >= $8)
        AND ($9::date   IS NULL OR (l.created_at AT TIME ZONE COALESCE(t.timezone, 'Asia/Kolkata'))::date <= $9)
        AND ($10::text  IS NULL
             OR ($11::text IS NOT NULL AND regexp_replace(l.recipient_phone, '\\D', '', 'g') LIKE '%' || $11 || '%')
             OR concat_ws(' ', u.first_name, u.last_name) ILIKE $10
             OR concat_ws(' ', su.first_name, su.last_name) ILIKE $10
             OR sp.admission_number ILIKE $10)
      ORDER BY l.created_at DESC
      LIMIT $6 OFFSET $7`,
    [tenantId, branchIds, status ?? null, eventType ?? null, batchId ?? null, limit, (page - 1) * limit,
      from ?? null, to ?? null, like, digits],
  );
  return rows;
}

export async function batchSummary(batchId) {
  const { rows } = await pool.query(
    `SELECT event_type, tenant_id, branch_id,
            count(*)::int AS total,
            count(*) FILTER (WHERE status = 'sent')::int      AS sent,
            count(*) FILTER (WHERE status = 'sending')::int   AS in_progress,
            count(*) FILTER (WHERE status = 'failed')::int    AS failed,
            count(*) FILTER (WHERE status = 'abandoned')::int AS abandoned,
            count(*) FILTER (WHERE status = 'failed' AND next_retry_at IS NOT NULL)::int AS retry_scheduled,
            min(created_at) AS started_at, max(updated_at) AS last_update_at
       FROM notification_logs
      WHERE batch_id = $1
      GROUP BY event_type, tenant_id, branch_id`,
    [batchId],
  );
  return rows;
}
