-- =====================================================================
--  SCHOOL ERP — MIGRATION 17: SAAS PLANS + SCHOOL SETTINGS ENGINE
--  Requires migrations 01–16.
--
--  Platform (SM ERP operator):
--    plans                    what each plan includes (modules) and its limits
--    tenant_subscriptions     one row per school: plan, status, per-school overrides
--
--  School (set by the school's own admins under Settings):
--    tenant_settings          typed JSON sections (attendance policy, calendar, notification
--                             preferences ...), school-wide or per branch, with a version number
--    communication_channels   the school's own WhatsApp / SMS / email account, or the platform's;
--                             secrets AES-256-GCM encrypted by the app (SETTINGS_ENCRYPTION_KEY)
--    message_templates        the school's text per event + channel (defaults live in code)
--    notification_rules       per event: on/off, channels in fallback order, audience, timing
--    attendance_devices       RFID / biometric / face / QR devices and gate apps
--    attendance_identifiers   card numbers / device user IDs -> student or staff member
--    device_punches           raw punches with what was done with each
--    scheduled_runs           "this daily job already ran today for this school" (once across replicas)
--    settings_audit_log       who changed which setting, when
--
--  notification_logs gains e-mail recipients and records whose account sent each message
--  (school's own or the platform's), which is what platform message quotas count.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. PLANS + SUBSCRIPTIONS
-- ---------------------------------------------------------------------

CREATE TYPE subscription_status AS ENUM ('trial', 'active', 'past_due', 'suspended', 'cancelled');

CREATE TABLE plans (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    code            citext          NOT NULL,
    name            varchar(80)     NOT NULL,
    description     varchar(500),
    modules         text[]          NOT NULL DEFAULT '{}',      -- optional module keys (core modules are implied)
    limits          jsonb           NOT NULL DEFAULT '{}'::jsonb, -- { maxStudents, maxBranches, whatsappPerMonth, smsPerMonth, emailsPerMonth }; missing/null = unlimited
    price_monthly   numeric(12,2),
    price_yearly    numeric(12,2),
    price_note      varchar(200),                              -- e.g. "per student per year"
    is_active       boolean         NOT NULL DEFAULT true,
    sort_order      smallint        NOT NULL DEFAULT 0,
    created_at      timestamptz     NOT NULL DEFAULT now(),
    updated_at      timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT uq_plans_code UNIQUE (code),
    CONSTRAINT ck_plans_code CHECK (code ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
    CONSTRAINT ck_plans_prices CHECK ((price_monthly IS NULL OR price_monthly >= 0) AND (price_yearly IS NULL OR price_yearly >= 0))
);

CREATE TABLE tenant_subscriptions (
    tenant_id           uuid                PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
    plan_id             uuid                NOT NULL REFERENCES plans (id) ON DELETE RESTRICT,
    status              subscription_status NOT NULL DEFAULT 'trial',
    trial_ends_at       date,
    current_period_end  date,
    module_overrides    jsonb               NOT NULL DEFAULT '{}'::jsonb,  -- { "transport": true, "sms": false }
    limit_overrides     jsonb               NOT NULL DEFAULT '{}'::jsonb,  -- { "maxStudents": 1500 }
    notes               varchar(1000),
    updated_by          uuid                REFERENCES users (id) ON DELETE SET NULL,
    created_at          timestamptz         NOT NULL DEFAULT now(),
    updated_at          timestamptz         NOT NULL DEFAULT now()
);

CREATE INDEX ix_tenant_subscriptions_plan ON tenant_subscriptions (plan_id);

-- ---------------------------------------------------------------------
-- 2. TENANT SETTINGS (typed sections, validated by the app)
-- ---------------------------------------------------------------------

CREATE TABLE tenant_settings (
    id          uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid            NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    branch_id   uuid,                                       -- NULL = whole school
    section     varchar(40)     NOT NULL,                   -- 'attendance', 'calendar', 'modules', 'messaging'
    value       jsonb           NOT NULL DEFAULT '{}'::jsonb,
    version     integer         NOT NULL DEFAULT 1,         -- optimistic concurrency for the settings screens
    updated_by  uuid            REFERENCES users (id) ON DELETE SET NULL,
    created_at  timestamptz     NOT NULL DEFAULT now(),
    updated_at  timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT fk_tenant_settings_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT ck_tenant_settings_section CHECK (section ~ '^[a-z][a-z_]{1,39}$'),
    CONSTRAINT ck_tenant_settings_version CHECK (version >= 1)
);

CREATE UNIQUE INDEX uq_tenant_settings_scope
    ON tenant_settings (tenant_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), section);

-- ---------------------------------------------------------------------
-- 3. COMMUNICATION CHANNELS, TEMPLATES, RULES
-- ---------------------------------------------------------------------

CREATE TABLE communication_channels (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid            NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    branch_id       uuid,                                   -- NULL = whole school; a row per branch overrides it
    channel         varchar(20)     NOT NULL,
    provider        varchar(30)     NOT NULL,
    config          jsonb           NOT NULL DEFAULT '{}'::jsonb,   -- non-secret settings (phone number ID, sender ID, SMTP host ...)
    secrets_enc     text,                                   -- sealed JSON of the secrets (access token, auth key, SMTP password)
    secret_hints    jsonb           NOT NULL DEFAULT '{}'::jsonb,   -- { "accessToken": "a1b2" } last 4 characters, for the screen
    enabled         boolean         NOT NULL DEFAULT false,
    verified_at     timestamptz,
    verify_error    varchar(300),
    last_used_at    timestamptz,
    updated_by      uuid            REFERENCES users (id) ON DELETE SET NULL,
    created_at      timestamptz     NOT NULL DEFAULT now(),
    updated_at      timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT fk_comm_channels_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT ck_comm_channels_channel CHECK (channel IN ('whatsapp', 'sms', 'email')),
    CONSTRAINT ck_comm_channels_provider CHECK (
        (channel = 'whatsapp' AND provider IN ('platform', 'meta_cloud', 'wati', 'twilio'))
     OR (channel = 'sms'      AND provider IN ('platform', 'msg91', 'twilio'))
     OR (channel = 'email'    AND provider IN ('platform', 'smtp'))),
    CONSTRAINT ck_comm_channels_secrets CHECK (provider = 'platform' OR secrets_enc IS NOT NULL)
);

CREATE UNIQUE INDEX uq_comm_channels_scope
    ON communication_channels (tenant_id, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), channel);

CREATE TABLE message_templates (
    id                      uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               uuid            NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    event_type              varchar(40)     NOT NULL,
    channel                 varchar(20)     NOT NULL,
    language                varchar(10)     NOT NULL DEFAULT 'en',
    name                    varchar(512),   -- WhatsApp: approved template name; SMS: DLT template ID / MSG91 flow ID
    subject                 varchar(200),   -- email only
    body                    text            NOT NULL,
    params                  text[]          NOT NULL DEFAULT '{}',   -- variables in {{1}}, {{2}} ... order (WhatsApp, MSG91 flows)
    approval_status         varchar(20)     NOT NULL DEFAULT 'not_required',
    approval_note           varchar(500),
    provider_template_id    varchar(100),
    submitted_at            timestamptz,
    synced_at               timestamptz,
    updated_by              uuid            REFERENCES users (id) ON DELETE SET NULL,
    created_at              timestamptz     NOT NULL DEFAULT now(),
    updated_at              timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT uq_message_templates UNIQUE (tenant_id, event_type, channel),
    CONSTRAINT ck_message_templates_channel CHECK (channel IN ('whatsapp', 'sms', 'email')),
    CONSTRAINT ck_message_templates_status CHECK (approval_status IN ('not_required', 'draft', 'pending', 'approved', 'rejected', 'paused')),
    CONSTRAINT ck_message_templates_body CHECK (length(body) BETWEEN 1 AND 4000)
);

CREATE TABLE notification_rules (
    id          uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid            NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    event_type  varchar(40)     NOT NULL,
    enabled     boolean         NOT NULL,
    channels    text[]          NOT NULL DEFAULT '{}',      -- fallback order, e.g. {whatsapp,sms}
    audience    varchar(20)     NOT NULL DEFAULT 'guardians',
    timing      jsonb           NOT NULL DEFAULT '{"mode":"immediate"}'::jsonb,
    updated_by  uuid            REFERENCES users (id) ON DELETE SET NULL,
    created_at  timestamptz     NOT NULL DEFAULT now(),
    updated_at  timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT uq_notification_rules UNIQUE (tenant_id, event_type),
    CONSTRAINT ck_notification_rules_channels CHECK (channels <@ ARRAY['whatsapp', 'sms', 'email']::text[]),
    CONSTRAINT ck_notification_rules_audience CHECK (audience IN ('guardians', 'primary_parent'))
);

-- ---------------------------------------------------------------------
-- 4. ATTENDANCE DEVICES
-- ---------------------------------------------------------------------

CREATE TABLE attendance_devices (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid            NOT NULL,
    branch_id       uuid            NOT NULL,
    name            varchar(100)    NOT NULL,
    kind            varchar(20)     NOT NULL,               -- rfid | biometric | face | qr | gate_app
    protocol        varchar(10)     NOT NULL DEFAULT 'http',-- http (our JSON API, X-Device-Key) | adms (ZKTeco / eSSL push)
    serial_number   citext,                                 -- ADMS devices identify themselves by serial number
    api_key_hash    char(64),                               -- sha256 hex of the device key (http)
    api_key_prefix  varchar(12),
    location        varchar(100),
    applies_to      varchar(10)     NOT NULL DEFAULT 'both',-- students | staff | both
    status          record_status   NOT NULL DEFAULT 'active',
    last_seen_at    timestamptz,
    last_ip         varchar(64),
    created_by      uuid            REFERENCES users (id) ON DELETE SET NULL,
    created_at      timestamptz     NOT NULL DEFAULT now(),
    updated_at      timestamptz     NOT NULL DEFAULT now(),
    deleted_at      timestamptz,

    CONSTRAINT fk_att_devices_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT uq_att_devices_id_tenant UNIQUE (id, tenant_id),
    CONSTRAINT ck_att_devices_kind CHECK (kind IN ('rfid', 'biometric', 'face', 'qr', 'gate_app')),
    CONSTRAINT ck_att_devices_protocol CHECK (protocol IN ('http', 'adms')),
    CONSTRAINT ck_att_devices_applies CHECK (applies_to IN ('students', 'staff', 'both')),
    CONSTRAINT ck_att_devices_auth CHECK (
        (protocol = 'http' AND api_key_hash IS NOT NULL) OR (protocol = 'adms' AND serial_number IS NOT NULL))
);

CREATE UNIQUE INDEX uq_att_devices_key    ON attendance_devices (api_key_hash) WHERE api_key_hash IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_att_devices_serial ON attendance_devices (serial_number) WHERE serial_number IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX ix_att_devices_tenant        ON attendance_devices (tenant_id) WHERE deleted_at IS NULL;

CREATE TABLE attendance_identifiers (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid            NOT NULL,
    branch_id       uuid            NOT NULL,
    kind            varchar(20)     NOT NULL,               -- rfid | biometric | face | qr
    value           varchar(64)     NOT NULL,               -- card number / device user ID (PIN) / QR payload
    student_id      uuid,
    staff_id        uuid,
    created_by      uuid            REFERENCES users (id) ON DELETE SET NULL,
    created_at      timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT fk_att_ident_student
        FOREIGN KEY (student_id, branch_id) REFERENCES student_profiles (id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_att_ident_staff
        FOREIGN KEY (staff_id, branch_id) REFERENCES staff_profiles (id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_att_ident_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT uq_att_ident_value UNIQUE (tenant_id, kind, value),
    CONSTRAINT ck_att_ident_kind CHECK (kind IN ('rfid', 'biometric', 'face', 'qr')),
    CONSTRAINT ck_att_ident_person CHECK ((student_id IS NULL) <> (staff_id IS NULL))
);

CREATE INDEX ix_att_ident_student ON attendance_identifiers (student_id) WHERE student_id IS NOT NULL;
CREATE INDEX ix_att_ident_staff   ON attendance_identifiers (staff_id)   WHERE staff_id IS NOT NULL;

CREATE TABLE device_punches (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid            NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    branch_id       uuid            NOT NULL,
    device_id       uuid            NOT NULL REFERENCES attendance_devices (id) ON DELETE CASCADE,
    identifier      varchar(64)     NOT NULL,
    kind            varchar(20)     NOT NULL,
    punched_at      timestamptz     NOT NULL,
    student_id      uuid,
    staff_id        uuid,
    result          varchar(30)     NOT NULL,   -- present | late | already_marked | staff_in | staff_out | unknown_identifier | holiday | outside_window | not_enrolled
    detail          varchar(200),
    created_at      timestamptz     NOT NULL DEFAULT now(),

    -- ADMS devices re-send their log after a reconnect: the same punch is stored once.
    CONSTRAINT uq_device_punches UNIQUE (device_id, identifier, punched_at)
);

CREATE INDEX ix_device_punches_tenant ON device_punches (tenant_id, created_at DESC);
CREATE INDEX ix_device_punches_device ON device_punches (device_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 5. SCHEDULED RUNS + AUDIT
-- ---------------------------------------------------------------------

CREATE TABLE scheduled_runs (
    tenant_id   uuid            NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    job         varchar(40)     NOT NULL,       -- fee_due_reminder | birthday_wish | attendance_cutoff
    run_key     varchar(80)     NOT NULL,       -- the school's local date (+ branch for per-branch jobs)
    started_at  timestamptz     NOT NULL DEFAULT now(),
    finished_at timestamptz,
    summary     jsonb,
    PRIMARY KEY (tenant_id, job, run_key)
);

CREATE TABLE settings_audit_log (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid            REFERENCES tenants (id) ON DELETE CASCADE,   -- NULL = platform-level change (plans)
    branch_id       uuid            REFERENCES branches (id) ON DELETE SET NULL,
    actor_user_id   uuid            REFERENCES users (id) ON DELETE SET NULL,
    area            varchar(40)     NOT NULL,   -- modules | communication | templates | rules | attendance | devices | subscription | plans
    action          varchar(40)     NOT NULL,   -- update | create | delete | test | submit ...
    summary         varchar(300)    NOT NULL,
    changes         jsonb,                      -- { field: [before, after] }, secrets never included
    created_at      timestamptz     NOT NULL DEFAULT now()
);

CREATE INDEX ix_settings_audit_tenant ON settings_audit_log (tenant_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 6. NOTIFICATION LOGS: e-mail recipients + whose account sent it
-- ---------------------------------------------------------------------

ALTER TABLE notification_logs
    ALTER COLUMN recipient_phone DROP NOT NULL,
    ADD COLUMN recipient_email citext,
    ADD COLUMN account varchar(10),            -- 'school' (school's own provider account) | 'platform'
    ADD CONSTRAINT ck_notification_logs_recipient CHECK (recipient_phone IS NOT NULL OR recipient_email IS NOT NULL),
    ADD CONSTRAINT ck_notification_logs_account CHECK (account IS NULL OR account IN ('school', 'platform'));

-- Monthly usage per school and channel (plan quotas, the usage panel).
CREATE INDEX ix_notification_logs_usage
    ON notification_logs (tenant_id, created_at)
    INCLUDE (channel, account)
    WHERE status = 'sent';

-- ---------------------------------------------------------------------
-- 7. TRIGGERS
-- ---------------------------------------------------------------------

CREATE TRIGGER trg_plans_updated_at                BEFORE UPDATE ON plans                  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_tenant_subscriptions_updated_at BEFORE UPDATE ON tenant_subscriptions   FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_tenant_settings_updated_at      BEFORE UPDATE ON tenant_settings        FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_comm_channels_updated_at        BEFORE UPDATE ON communication_channels FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_message_templates_updated_at    BEFORE UPDATE ON message_templates      FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_notification_rules_updated_at   BEFORE UPDATE ON notification_rules     FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_attendance_devices_updated_at   BEFORE UPDATE ON attendance_devices     FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ---------------------------------------------------------------------
-- 8. STARTER PLANS. Existing schools keep every feature they have today (Premium, active).
--    Prices are left for the operator to set in the platform console.
-- ---------------------------------------------------------------------

INSERT INTO plans (code, name, description, modules, limits, price_note, sort_order) VALUES
  ('basic', 'Basic',
   'Records, attendance and fee collection with SMS alerts.',
   ARRAY['notices', 'homework', 'timetable', 'parent_portal', 'sms'],
   '{"maxStudents": 500, "maxBranches": 1, "whatsappPerMonth": 0, "smsPerMonth": 2000, "emailsPerMonth": 2000}',
   'per student per year', 1),
  ('standard', 'Standard',
   'Everything a single school runs on: exams, report cards, transport, online fees, WhatsApp.',
   ARRAY['notices', 'homework', 'timetable', 'parent_portal', 'sms', 'whatsapp', 'email',
         'exams', 'report_cards', 'certificates', 'transport', 'online_payments', 'expenses', 'accounts'],
   '{"maxStudents": 2000, "maxBranches": 3, "whatsappPerMonth": 5000, "smsPerMonth": 5000, "emailsPerMonth": 10000}',
   'per student per year', 2),
  ('premium', 'Premium',
   'For school groups: every module, device attendance, no student or branch limits.',
   ARRAY['notices', 'homework', 'timetable', 'parent_portal', 'sms', 'whatsapp', 'email',
         'exams', 'report_cards', 'certificates', 'transport', 'online_payments', 'expenses', 'accounts',
         'device_attendance'],
   '{"maxStudents": null, "maxBranches": null, "whatsappPerMonth": 20000, "smsPerMonth": 20000, "emailsPerMonth": 50000}',
   'per student per year', 3);

INSERT INTO tenant_subscriptions (tenant_id, plan_id, status)
SELECT t.id, p.id, 'active'
  FROM tenants t CROSS JOIN plans p
 WHERE p.code = 'premium' AND t.deleted_at IS NULL;

COMMIT;
