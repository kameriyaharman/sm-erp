-- =====================================================================
--  SCHOOL ERP — MIGRATION 13: SCHOOL-OWNED PAYMENT GATEWAY + PORTAL LOGINS
--  Requires migrations 01 and 07.
--
--  payment_gateway_settings   each school connects its OWN Razorpay account
--                             (one row per tenant = school default, optional
--                             per-branch overrides). Secrets are stored
--                             encrypted by the API (AES-256-GCM, key in the
--                             SETTINGS_ENCRYPTION_KEY env var); the database
--                             never sees them in plain text.
--  payment_orders             remembers which Razorpay account (key id) and
--                             mode each order was created with, so the right
--                             webhook secret / API keys settle or reconcile it.
--  payment_webhook_events     dedupe per tenant (a school's webhook URL carries
--                             its code; the legacy URL keeps the old rule).
--  users                      portal logins: must_change_password (temporary
--                             passwords), password_set_at (NULL = the account
--                             only has a random placeholder and cannot log in).
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Gateway settings
-- ---------------------------------------------------------------------
CREATE TABLE payment_gateway_settings (
    id                      uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               uuid            NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    branch_id               uuid,                                   -- NULL = school default; set = override for one branch
    provider                varchar(20)     NOT NULL DEFAULT 'razorpay',
    key_id                  varchar(64)     NOT NULL,               -- public: rzp_test_... / rzp_live_...
    mode                    varchar(4)      NOT NULL,               -- derived from the key id prefix
    key_secret_enc          text            NOT NULL,               -- v1:<iv>:<tag>:<ciphertext> (base64url)
    key_secret_last4        varchar(4)      NOT NULL,
    webhook_secret_enc      text            NOT NULL,
    webhook_secret_last4    varchar(4)      NOT NULL,
    enabled                 boolean         NOT NULL DEFAULT false,
    allow_partial           boolean         NOT NULL DEFAULT false, -- parents may pay part of a bill
    min_amount              numeric(12,2)   NOT NULL DEFAULT 1,     -- smallest part payment (rupees)
    verified_at             timestamptz,                            -- last successful "Test connection"
    verify_error            varchar(200),
    last_webhook_at         timestamptz,                            -- last correctly signed webhook
    created_at              timestamptz     NOT NULL DEFAULT now(),
    updated_at              timestamptz     NOT NULL DEFAULT now(),
    updated_by              uuid,

    CONSTRAINT fk_pgs_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_pgs_updated_by
        FOREIGN KEY (updated_by, tenant_id) REFERENCES users (id, tenant_id) ON DELETE SET NULL (updated_by),
    CONSTRAINT ck_pgs_provider   CHECK (provider = 'razorpay'),
    CONSTRAINT ck_pgs_key_id     CHECK (key_id ~ '^rzp_(test|live)_[A-Za-z0-9]{6,40}$'),
    CONSTRAINT ck_pgs_mode       CHECK (mode IN ('test', 'live') AND key_id LIKE 'rzp_' || mode || '_%'),
    CONSTRAINT ck_pgs_min_amount CHECK (min_amount >= 1)
);

CREATE UNIQUE INDEX uq_pgs_tenant_default ON payment_gateway_settings (tenant_id) WHERE branch_id IS NULL;
CREATE UNIQUE INDEX uq_pgs_branch         ON payment_gateway_settings (branch_id) WHERE branch_id IS NOT NULL;

CREATE TRIGGER trg_payment_gateway_settings_updated_at
    BEFORE UPDATE ON payment_gateway_settings FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();


-- ---------------------------------------------------------------------
-- Orders: which account / mode created them; why an attempt failed
-- ---------------------------------------------------------------------
ALTER TABLE payment_orders
    ADD COLUMN gateway_key_id   varchar(64),        -- NULL on orders created before this migration (platform account)
    ADD COLUMN gateway_mode     varchar(4),         -- test | live
    ADD COLUMN failure_reason   varchar(300),
    ADD CONSTRAINT ck_payorders_mode CHECK (gateway_mode IS NULL OR gateway_mode IN ('test', 'live'));

-- No backfill: older orders were created with the platform (env) account, whose mode the database doesn't know.

CREATE INDEX ix_payorders_tenant_created ON payment_orders (tenant_id, created_at DESC);
CREATE INDEX ix_payorders_branch_created ON payment_orders (branch_id, created_at DESC);


-- ---------------------------------------------------------------------
-- Webhook events: dedupe per tenant for the per-school URL
-- ---------------------------------------------------------------------
ALTER TABLE payment_webhook_events
    ADD COLUMN tenant_id uuid REFERENCES tenants (id) ON DELETE CASCADE;

ALTER TABLE payment_webhook_events DROP CONSTRAINT uq_webhook_event;
-- Legacy URL (/finance/webhook, platform account): one row per gateway event id, as before.
CREATE UNIQUE INDEX uq_webhook_event_platform ON payment_webhook_events (gateway, event_id) WHERE tenant_id IS NULL;
-- School URL (/finance/webhook/:tenantCode): one row per (school, gateway event id).
CREATE UNIQUE INDEX uq_webhook_event_tenant   ON payment_webhook_events (gateway, tenant_id, event_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX ix_webhook_events_order ON payment_webhook_events (payment_order_id) WHERE payment_order_id IS NOT NULL;


-- ---------------------------------------------------------------------
-- Portal logins
-- ---------------------------------------------------------------------
ALTER TABLE users
    ADD COLUMN must_change_password boolean NOT NULL DEFAULT false,
    ADD COLUMN password_set_at      timestamptz;      -- NULL = random placeholder password, no usable login

-- Accounts that have demonstrably been used, and all staff accounts (created with a real password),
-- count as having a login. Parents and students created by admission got a random placeholder.
UPDATE users
   SET password_set_at = COALESCE(password_changed_at, last_login_at, created_at)
 WHERE role NOT IN ('parent', 'student') OR last_login_at IS NOT NULL OR password_changed_at IS NOT NULL;

-- Login by phone (parents) and by admission number (students), within a school.
CREATE INDEX ix_users_login_phone_digits ON users (tenant_id, (regexp_replace(phone, '\D', '', 'g')))
    WHERE phone IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX ix_student_profiles_admission_ci ON student_profiles (tenant_id, lower(admission_number))
    WHERE deleted_at IS NULL;

COMMIT;
