-- =====================================================================
--  SCHOOL ERP — MIGRATION 06: NOTIFICATION LOGS
--  Requires migration 01.
--
--  One row per message dispatch (WhatsApp / SMS), written BEFORE the gateway
--  is called and updated with the outcome. Gives:
--    * a delivery audit trail (who was messaged, when, through which gateway);
--    * a retry queue: failed rows with next_retry_at are re-sent by the worker;
--    * de-duplication: a dedupe_key (e.g. one fee reminder per student per
--      parent per day) can only be used once per tenant.
--
--  recipient_phone is stored in full because retries need it. Treat this
--  table as personal data: restrict access and purge old rows (see README).
-- =====================================================================

BEGIN;

CREATE TYPE notification_log_status AS ENUM ('sending', 'sent', 'failed', 'abandoned');

CREATE TABLE notification_logs (
    id                  uuid                        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid                        REFERENCES tenants (id) ON DELETE CASCADE,
    branch_id           uuid                        REFERENCES branches (id) ON DELETE CASCADE,
    batch_id            uuid,                       -- groups a broadcast or a reminder run
    event_type          varchar(40)                 NOT NULL,   -- absentee_alert | fee_due_reminder | broadcast_notice | attendance_correction
    template            varchar(50)                 NOT NULL,
    channel             varchar(20),                            -- channel of the last attempt
    provider            varchar(40),
    recipient_phone     varchar(20)                 NOT NULL,   -- E.164
    recipient_user_id   uuid                        REFERENCES users (id) ON DELETE SET NULL,
    student_id          uuid                        REFERENCES student_profiles (id) ON DELETE SET NULL,
    payload             jsonb                       NOT NULL,   -- template variables, enough to re-send
    status              notification_log_status     NOT NULL DEFAULT 'sending',
    attempts            smallint                    NOT NULL DEFAULT 0,   -- gateway calls so far
    retry_count         smallint                    NOT NULL DEFAULT 0,   -- worker re-dispatches so far
    max_retries         smallint                    NOT NULL DEFAULT 4,   -- 0 = never auto-retry
    next_retry_at       timestamptz,
    last_error_code     varchar(50),
    last_error_message  varchar(500),
    last_http_status    smallint,
    provider_message_id varchar(100),
    dedupe_key          varchar(200),
    created_by          uuid                        REFERENCES users (id) ON DELETE SET NULL,
    sent_at             timestamptz,
    created_at          timestamptz                 NOT NULL DEFAULT now(),
    updated_at          timestamptz                 NOT NULL DEFAULT now(),

    CONSTRAINT ck_notification_logs_counts CHECK (attempts >= 0 AND retry_count >= 0 AND max_retries >= 0),
    CONSTRAINT ck_notification_logs_sent   CHECK ((status = 'sent') = (sent_at IS NOT NULL)),
    CONSTRAINT ck_notification_logs_retry  CHECK (next_retry_at IS NULL OR status = 'failed')
);

-- One use per dedupe key per tenant (platform-level messages share the NULL tenant bucket).
CREATE UNIQUE INDEX uq_notification_logs_dedupe
    ON notification_logs (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), dedupe_key)
    WHERE dedupe_key IS NOT NULL;

-- Retry worker queue: failed rows that are due.
CREATE INDEX ix_notification_logs_retry_queue
    ON notification_logs (next_retry_at)
    WHERE status = 'failed' AND next_retry_at IS NOT NULL;

-- Rows stuck in 'sending' after a crash.
CREATE INDEX ix_notification_logs_stuck
    ON notification_logs (updated_at)
    WHERE status = 'sending';

-- Admin "failed messages" screen and batch reports.
CREATE INDEX ix_notification_logs_tenant_status ON notification_logs (tenant_id, status, created_at DESC);
CREATE INDEX ix_notification_logs_branch        ON notification_logs (branch_id, created_at DESC) WHERE branch_id IS NOT NULL;
CREATE INDEX ix_notification_logs_batch         ON notification_logs (batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX ix_notification_logs_student       ON notification_logs (student_id, created_at DESC) WHERE student_id IS NOT NULL;
CREATE INDEX ix_notification_logs_recipient     ON notification_logs (recipient_user_id) WHERE recipient_user_id IS NOT NULL;

CREATE TRIGGER trg_notification_logs_updated_at
    BEFORE UPDATE ON notification_logs FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

COMMIT;
