-- =====================================================================
--  SCHOOL ERP — MIGRATION 05: ATTENDANCE SUBMISSIONS + PARENT NOTIFICATIONS
--  Requires migrations 01–02.
--
--  * attendance_submissions: one row per section per day, written when the
--    register is submitted. Tells the UI "already taken at 9:12 by Tina" and
--    gives an audit trail of edits.
--  * parent_notifications: a transactional outbox. Rows are inserted in the
--    same transaction as the attendance they describe, so a rolled-back save
--    never notifies anyone. A dispatcher claims queued rows with
--    FOR UPDATE SKIP LOCKED and sends them (simulated in this build).
-- =====================================================================

BEGIN;

CREATE TABLE attendance_submissions (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid            NOT NULL,
    branch_id           uuid            NOT NULL,
    section_id          uuid            NOT NULL,
    academic_year_id    uuid            NOT NULL,
    attendance_date     date            NOT NULL,
    total_students      smallint        NOT NULL,
    present_count       smallint        NOT NULL,
    absent_count        smallint        NOT NULL,
    other_count         smallint        NOT NULL DEFAULT 0,       -- late / leave / half day
    submitted_by        uuid,
    submitted_at        timestamptz     NOT NULL DEFAULT now(),
    last_updated_by     uuid,
    revision            integer         NOT NULL DEFAULT 1,       -- 1 = first submit, 2+ = edits
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT fk_att_sub_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_att_sub_section
        FOREIGN KEY (section_id, branch_id) REFERENCES sections (id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_att_sub_year
        FOREIGN KEY (academic_year_id, branch_id) REFERENCES academic_years (id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_att_sub_submitted_by
        FOREIGN KEY (submitted_by, tenant_id) REFERENCES users (id, tenant_id) ON DELETE SET NULL (submitted_by),
    CONSTRAINT fk_att_sub_updated_by
        FOREIGN KEY (last_updated_by, tenant_id) REFERENCES users (id, tenant_id) ON DELETE SET NULL (last_updated_by),

    CONSTRAINT uq_att_sub_section_day UNIQUE (section_id, attendance_date),
    CONSTRAINT ck_att_sub_counts CHECK (
        total_students >= 0 AND present_count >= 0 AND absent_count >= 0 AND other_count >= 0
        AND present_count + absent_count + other_count = total_students),
    CONSTRAINT ck_att_sub_revision CHECK (revision >= 1)
);

-- "Which sections haven't taken attendance today?" (principal dashboard)
CREATE INDEX ix_att_sub_branch_date ON attendance_submissions (branch_id, attendance_date);
CREATE INDEX ix_att_sub_tenant      ON attendance_submissions (tenant_id);


CREATE TYPE notification_channel AS ENUM ('sms', 'whatsapp', 'push', 'email');
CREATE TYPE notification_status  AS ENUM ('queued', 'sending', 'sent', 'failed', 'cancelled');

CREATE TABLE parent_notifications (
    id                  uuid                    PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid                    NOT NULL,
    branch_id           uuid                    NOT NULL,
    student_id          uuid                    NOT NULL,
    parent_user_id      uuid                    NOT NULL,
    channel             notification_channel    NOT NULL,
    recipient           varchar(255)            NOT NULL,      -- phone / email / device, at send time
    template            varchar(50)             NOT NULL,      -- 'attendance_absent', 'attendance_correction', ...
    payload             jsonb                   NOT NULL DEFAULT '{}'::jsonb,
    message             text                    NOT NULL,      -- rendered text, as sent
    dedupe_key          varchar(200)            NOT NULL,      -- one message per event per parent
    status              notification_status     NOT NULL DEFAULT 'queued',
    attempts            smallint                NOT NULL DEFAULT 0,
    next_attempt_at     timestamptz             NOT NULL DEFAULT now(),
    provider_message_id varchar(100),
    last_error          varchar(500),
    sent_at             timestamptz,
    created_by          uuid,
    created_at          timestamptz             NOT NULL DEFAULT now(),
    updated_at          timestamptz             NOT NULL DEFAULT now(),

    CONSTRAINT fk_notif_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_notif_student
        FOREIGN KEY (student_id, branch_id) REFERENCES student_profiles (id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_notif_parent
        FOREIGN KEY (parent_user_id, tenant_id) REFERENCES users (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_notif_created_by
        FOREIGN KEY (created_by, tenant_id) REFERENCES users (id, tenant_id) ON DELETE SET NULL (created_by),

    CONSTRAINT uq_notif_dedupe UNIQUE (tenant_id, dedupe_key),
    CONSTRAINT ck_notif_attempts CHECK (attempts >= 0),
    CONSTRAINT ck_notif_sent CHECK ((status = 'sent') = (sent_at IS NOT NULL))
);

-- Dispatcher queue: only rows that still need work, oldest first.
CREATE INDEX ix_notif_queue   ON parent_notifications (next_attempt_at) WHERE status = 'queued';
CREATE INDEX ix_notif_student ON parent_notifications (student_id, created_at DESC);
CREATE INDEX ix_notif_parent  ON parent_notifications (parent_user_id, created_at DESC);
CREATE INDEX ix_notif_tenant  ON parent_notifications (tenant_id);

CREATE TRIGGER trg_attendance_submissions_updated_at
    BEFORE UPDATE ON attendance_submissions FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_parent_notifications_updated_at
    BEFORE UPDATE ON parent_notifications FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

COMMIT;
