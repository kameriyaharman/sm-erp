-- =====================================================================
--  SCHOOL ERP — MIGRATION 07: ONLINE PAYMENTS (RAZORPAY)
--  Requires migrations 01, 02 and 04.
--
--  payment_orders          one row per gateway order created for a parent's checkout
--  payment_order_items     which invoices that order pays, and how much of each
--  payment_webhook_events  every verified webhook, unique per gateway event id, so a
--                          re-delivered event is recognised and ignored
--
--  A webhook is applied in ONE transaction: event row -> lock order -> post
--  receipt + transactions -> mark order paid. If anything fails, nothing is
--  kept and the gateway's retry processes it again from scratch.
-- =====================================================================

BEGIN;

CREATE TYPE payment_order_status AS ENUM ('created', 'paid', 'failed', 'expired', 'needs_review');

CREATE TABLE payment_orders (
    id                  uuid                    PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid                    NOT NULL,
    branch_id           uuid                    NOT NULL,
    student_id          uuid                    NOT NULL,
    gateway             varchar(20)             NOT NULL DEFAULT 'razorpay',
    gateway_order_id    varchar(64)             NOT NULL,
    receipt_ref         varchar(40)             NOT NULL,      -- our reference sent to the gateway (max 40)
    amount              numeric(12,2)           NOT NULL,
    currency            char(3)                 NOT NULL DEFAULT 'INR',
    status              payment_order_status    NOT NULL DEFAULT 'created',
    idempotency_key     varchar(100),
    created_by          uuid,
    expires_at          timestamptz             NOT NULL,
    gateway_payment_id  varchar(64),
    paid_at             timestamptz,
    receipt_id          uuid,
    review_reason       varchar(500),
    created_at          timestamptz             NOT NULL DEFAULT now(),
    updated_at          timestamptz             NOT NULL DEFAULT now(),

    CONSTRAINT fk_payorders_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_payorders_student
        FOREIGN KEY (student_id, branch_id) REFERENCES student_profiles (id, branch_id),   -- NO ACTION
    CONSTRAINT fk_payorders_created_by
        FOREIGN KEY (created_by, tenant_id) REFERENCES users (id, tenant_id) ON DELETE SET NULL (created_by),
    CONSTRAINT fk_payorders_receipt
        FOREIGN KEY (receipt_id, branch_id) REFERENCES fee_receipts (id, branch_id),       -- NO ACTION

    CONSTRAINT uq_payorders_gateway_order UNIQUE (gateway, gateway_order_id),
    CONSTRAINT uq_payorders_receipt_ref   UNIQUE (receipt_ref),
    CONSTRAINT uq_payorders_id_branch     UNIQUE (id, branch_id),
    CONSTRAINT ck_payorders_amount        CHECK (amount >= 1),
    CONSTRAINT ck_payorders_paid          CHECK (status <> 'paid' OR (paid_at IS NOT NULL AND gateway_payment_id IS NOT NULL AND receipt_id IS NOT NULL))
);

CREATE UNIQUE INDEX uq_payorders_idempotency ON payment_orders (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX ix_payorders_student  ON payment_orders (student_id, created_at DESC);
CREATE INDEX ix_payorders_review   ON payment_orders (branch_id, created_at) WHERE status = 'needs_review';
CREATE INDEX ix_payorders_tenant   ON payment_orders (tenant_id);


CREATE TABLE payment_order_items (
    order_id    uuid            NOT NULL,
    invoice_id  uuid            NOT NULL,
    branch_id   uuid            NOT NULL,
    amount      numeric(12,2)   NOT NULL,
    CONSTRAINT pk_payment_order_items PRIMARY KEY (order_id, invoice_id),
    CONSTRAINT fk_poi_order   FOREIGN KEY (order_id, branch_id) REFERENCES payment_orders (id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_poi_invoice FOREIGN KEY (invoice_id, branch_id) REFERENCES fee_invoices (id, branch_id),   -- NO ACTION
    CONSTRAINT ck_poi_amount  CHECK (amount > 0)
);
CREATE INDEX ix_poi_invoice ON payment_order_items (invoice_id);


CREATE TABLE payment_webhook_events (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    gateway             varchar(20)     NOT NULL,
    event_id            varchar(100)    NOT NULL,      -- x-razorpay-event-id
    event_type          varchar(60)     NOT NULL,
    gateway_order_id    varchar(64),
    gateway_payment_id  varchar(64),
    payment_order_id    uuid            REFERENCES payment_orders (id) ON DELETE SET NULL,
    outcome             varchar(30)     NOT NULL,      -- processed | ignored | unknown_order | already_paid | needs_review
    detail              varchar(500),
    payload             jsonb           NOT NULL,
    received_at         timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT uq_webhook_event UNIQUE (gateway, event_id)
);
CREATE INDEX ix_webhook_events_payment ON payment_webhook_events (gateway, gateway_payment_id) WHERE gateway_payment_id IS NOT NULL;
CREATE INDEX ix_webhook_events_review  ON payment_webhook_events (received_at) WHERE outcome IN ('needs_review', 'unknown_order');


-- One online payment can settle several invoices (split dues): uniqueness moves
-- from (gateway, payment id) to (gateway, payment id, invoice).
DROP INDEX uq_txn_gateway_payment;
CREATE UNIQUE INDEX uq_txn_gateway_payment_invoice
    ON fee_transactions (gateway, gateway_payment_id, invoice_id) WHERE gateway_payment_id IS NOT NULL;


CREATE TRIGGER trg_payment_orders_updated_at
    BEFORE UPDATE ON payment_orders FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

COMMIT;
