-- =====================================================================
--  SCHOOL ERP — MIGRATION 03: AUTH REFRESH TOKENS
--  Requires migration 01. Used by the API's /auth/refresh rotation.
--  Only SHA-256 hashes of refresh tokens are stored.
-- =====================================================================

BEGIN;

CREATE TABLE auth_refresh_tokens (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid            NOT NULL REFERENCES users (id)   ON DELETE CASCADE,
    tenant_id       uuid                     REFERENCES tenants (id) ON DELETE CASCADE,
    family_id       uuid            NOT NULL,            -- one family = one device session
    token_hash      bytea           NOT NULL,
    expires_at      timestamptz     NOT NULL,
    revoked_at      timestamptz,
    revoked_reason  varchar(30),                         -- rotated | logout | logout_all | reuse_detected | account_inactive
    replaced_by_id  uuid            REFERENCES auth_refresh_tokens (id) ON DELETE SET NULL,
    created_ip      inet,
    user_agent      varchar(255),
    created_at      timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT uq_refresh_token_hash UNIQUE (token_hash),
    CONSTRAINT ck_refresh_token_expiry CHECK (expires_at > created_at),
    CONSTRAINT ck_refresh_token_revoked CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);

CREATE INDEX ix_refresh_tokens_user_active ON auth_refresh_tokens (user_id) WHERE revoked_at IS NULL;
CREATE INDEX ix_refresh_tokens_family      ON auth_refresh_tokens (family_id) WHERE revoked_at IS NULL;
CREATE INDEX ix_refresh_tokens_expires     ON auth_refresh_tokens (expires_at);   -- nightly cleanup
CREATE INDEX ix_refresh_tokens_replaced_by ON auth_refresh_tokens (replaced_by_id) WHERE replaced_by_id IS NOT NULL;
CREATE INDEX ix_refresh_tokens_tenant      ON auth_refresh_tokens (tenant_id);

COMMIT;
