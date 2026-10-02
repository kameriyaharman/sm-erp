-- =====================================================================
--  SCHOOL ERP — MIGRATION 02: FEE MANAGEMENT + ACADEMICS & ATTENDANCE
--  Target   : PostgreSQL 15+
--  Requires : school_erp_schema.sql (migration 01) already applied
--
--  Conventions carried over from 01
--  * UUID PKs, tenant_id + branch_id on every row, composite FKs so a row
--    can never point at another branch's / tenant's data.
--  * Tenant/branch deletes CASCADE through everything.
--  * Financial records are protected: a student, invoice or allocation that
--    has money attached cannot be hard-deleted on its own (NO ACTION).
--    NO ACTION (not RESTRICT) is used deliberately so a full tenant/branch
--    cascade still succeeds in one statement.
--  * Academic history (attendance, marks, report cards) belongs to the
--    student and cascades with the student record.
--  * Money is numeric(12,2); totals on invoices are maintained by triggers,
--    never trusted from the application.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Extra composite-FK targets on migration-01 tables
-- ---------------------------------------------------------------------
ALTER TABLE student_profiles ADD CONSTRAINT uq_students_id_branch  UNIQUE (id, branch_id);
ALTER TABLE sections         ADD CONSTRAINT uq_sections_id_branch  UNIQUE (id, branch_id);

-- ---------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------
CREATE TYPE fee_frequency      AS ENUM ('one_time', 'monthly', 'quarterly', 'half_yearly', 'annual');
CREATE TYPE concession_type    AS ENUM ('none', 'percentage', 'flat', 'full_waiver');
CREATE TYPE invoice_status     AS ENUM ('unpaid', 'partially_paid', 'paid', 'cancelled');
CREATE TYPE payment_mode       AS ENUM ('cash', 'cheque', 'demand_draft', 'upi', 'card', 'net_banking', 'bank_transfer', 'wallet', 'other');
CREATE TYPE txn_type           AS ENUM ('payment', 'refund');
CREATE TYPE txn_status         AS ENUM ('initiated', 'pending', 'success', 'failed', 'cancelled');

CREATE TYPE attendance_status  AS ENUM ('present', 'absent', 'late', 'leave', 'half_day');
CREATE TYPE staff_att_status   AS ENUM ('present', 'absent', 'late', 'leave', 'half_day', 'on_duty');
CREATE TYPE attendance_source  AS ENUM ('manual', 'app', 'biometric', 'rfid', 'import');

CREATE TYPE exam_type          AS ENUM ('unit_test', 'periodic', 'mid_term', 'final', 'practical', 'internal', 'other');
CREATE TYPE exam_status        AS ENUM ('draft', 'scheduled', 'ongoing', 'completed', 'results_published');
CREATE TYPE result_status      AS ENUM ('pass', 'fail', 'promoted', 'detained', 'withheld', 'pending');
CREATE TYPE report_card_status AS ENUM ('draft', 'generated', 'published', 'revoked');


-- =====================================================================
-- PART A — FEE MANAGEMENT
-- =====================================================================

-- ---------------------------------------------------------------------
-- A1. fee_heads — Tuition, Transport, Lab, Annual Charges, ...
-- ---------------------------------------------------------------------
CREATE TABLE fee_heads (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid            NOT NULL,
    branch_id       uuid            NOT NULL,
    name            varchar(100)    NOT NULL,
    code            varchar(30)     NOT NULL,
    description     text,
    default_frequency fee_frequency NOT NULL DEFAULT 'monthly',
    is_optional     boolean         NOT NULL DEFAULT false,   -- e.g. transport, hostel
    is_refundable   boolean         NOT NULL DEFAULT false,   -- e.g. caution deposit
    tax_rate        numeric(5,2)    NOT NULL DEFAULT 0,       -- GST % if applicable
    display_order   smallint        NOT NULL DEFAULT 0,
    status          record_status   NOT NULL DEFAULT 'active',
    created_at      timestamptz     NOT NULL DEFAULT now(),
    updated_at      timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT fk_fee_heads_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT uq_fee_heads_branch_code UNIQUE (branch_id, code),
    CONSTRAINT uq_fee_heads_branch_name UNIQUE (branch_id, name),
    CONSTRAINT uq_fee_heads_id_branch   UNIQUE (id, branch_id),
    CONSTRAINT ck_fee_heads_tax CHECK (tax_rate BETWEEN 0 AND 100)
);

CREATE INDEX ix_fee_heads_tenant ON fee_heads (tenant_id);

-- ---------------------------------------------------------------------
-- A2. fee_structures — class-wise amount per head per installment
--     One row = "Grade 5, 2026-27, Tuition, installment 3 (June), ₹4,500, due 10-Jun"
-- ---------------------------------------------------------------------
CREATE TABLE fee_structures (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid            NOT NULL,
    branch_id           uuid            NOT NULL,
    academic_year_id    uuid            NOT NULL,
    class_id            uuid            NOT NULL,
    fee_head_id         uuid            NOT NULL,
    frequency           fee_frequency   NOT NULL,
    installment_no      smallint        NOT NULL DEFAULT 1,
    installment_label   varchar(50),                         -- 'April', 'Q1', 'Term 1'
    amount              numeric(12,2)   NOT NULL,
    due_date            date            NOT NULL,
    late_fee_per_day    numeric(10,2)   NOT NULL DEFAULT 0,
    late_fee_cap        numeric(12,2),
    grace_days          smallint        NOT NULL DEFAULT 0,
    status              record_status   NOT NULL DEFAULT 'active',
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT fk_fee_structures_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_fee_structures_year
        FOREIGN KEY (academic_year_id, branch_id) REFERENCES academic_years (id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_fee_structures_class
        FOREIGN KEY (class_id, branch_id) REFERENCES classes (id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_fee_structures_head
        FOREIGN KEY (fee_head_id, branch_id) REFERENCES fee_heads (id, branch_id),   -- NO ACTION

    CONSTRAINT uq_fee_structures_slot
        UNIQUE (academic_year_id, class_id, fee_head_id, installment_no),
    CONSTRAINT uq_fee_structures_id_branch UNIQUE (id, branch_id),

    CONSTRAINT ck_fee_structures_amount      CHECK (amount >= 0),
    CONSTRAINT ck_fee_structures_installment CHECK (installment_no >= 1),
    CONSTRAINT ck_fee_structures_late_fee    CHECK (late_fee_per_day >= 0 AND (late_fee_cap IS NULL OR late_fee_cap >= 0)),
    CONSTRAINT ck_fee_structures_grace       CHECK (grace_days >= 0)
);

CREATE INDEX ix_fee_structures_year_class ON fee_structures (academic_year_id, class_id, due_date);
CREATE INDEX ix_fee_structures_head       ON fee_structures (fee_head_id);
CREATE INDEX ix_fee_structures_tenant     ON fee_structures (tenant_id);

-- ---------------------------------------------------------------------
-- A3. student_fee_allocations — what THIS student actually owes
--     Copied from fee_structures at enrolment, then adjusted with
--     concessions / waivers, or added ad hoc (fee_structure_id NULL).
-- ---------------------------------------------------------------------
CREATE TABLE student_fee_allocations (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid            NOT NULL,
    branch_id           uuid            NOT NULL,
    student_id          uuid            NOT NULL,
    academic_year_id    uuid            NOT NULL,
    fee_head_id         uuid            NOT NULL,
    fee_structure_id    uuid,                                -- NULL = custom / ad-hoc due
    installment_no      smallint        NOT NULL DEFAULT 1,
    due_date            date            NOT NULL,
    base_amount         numeric(12,2)   NOT NULL,
    concession_type     concession_type NOT NULL DEFAULT 'none',
    concession_value    numeric(12,2)   NOT NULL DEFAULT 0,  -- % or flat, per concession_type
    concession_amount   numeric(12,2)   NOT NULL DEFAULT 0,  -- resolved rupee amount
    concession_reason   varchar(255),                        -- 'Sibling', 'Staff ward', 'Merit', 'RTE'
    net_amount          numeric(12,2)   GENERATED ALWAYS AS (base_amount - concession_amount) STORED,
    approved_by         uuid,
    approved_at         timestamptz,
    is_active           boolean         NOT NULL DEFAULT true,
    remarks             text,
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT fk_sfa_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_sfa_student
        FOREIGN KEY (student_id, branch_id) REFERENCES student_profiles (id, branch_id),          -- NO ACTION
    CONSTRAINT fk_sfa_year
        FOREIGN KEY (academic_year_id, branch_id) REFERENCES academic_years (id, branch_id),      -- NO ACTION
    CONSTRAINT fk_sfa_head
        FOREIGN KEY (fee_head_id, branch_id) REFERENCES fee_heads (id, branch_id),                -- NO ACTION
    CONSTRAINT fk_sfa_structure
        FOREIGN KEY (fee_structure_id, branch_id) REFERENCES fee_structures (id, branch_id)
        ON DELETE SET NULL (fee_structure_id),
    CONSTRAINT fk_sfa_approved_by
        FOREIGN KEY (approved_by, tenant_id) REFERENCES users (id, tenant_id)
        ON DELETE SET NULL (approved_by),

    CONSTRAINT uq_sfa_id_branch UNIQUE (id, branch_id),

    CONSTRAINT ck_sfa_amounts
        CHECK (base_amount >= 0 AND concession_amount >= 0 AND concession_amount <= base_amount),
    CONSTRAINT ck_sfa_concession_value
        CHECK (concession_value >= 0 AND (concession_type <> 'percentage' OR concession_value <= 100)),
    CONSTRAINT ck_sfa_waiver_full
        CHECK (concession_type <> 'full_waiver' OR concession_amount = base_amount),
    CONSTRAINT ck_sfa_none_means_zero
        CHECK (concession_type <> 'none' OR concession_amount = 0)
);

-- One allocation per structure slot per student (custom dues are unrestricted).
CREATE UNIQUE INDEX uq_sfa_student_structure
    ON student_fee_allocations (student_id, fee_structure_id) WHERE fee_structure_id IS NOT NULL;

CREATE INDEX ix_sfa_student_year_due ON student_fee_allocations (student_id, academic_year_id, due_date) WHERE is_active;
CREATE INDEX ix_sfa_branch_due       ON student_fee_allocations (branch_id, due_date) WHERE is_active;
CREATE INDEX ix_sfa_concessions      ON student_fee_allocations (branch_id, academic_year_id, concession_type)
    WHERE concession_type <> 'none';                         -- concession register
CREATE INDEX ix_sfa_head             ON student_fee_allocations (fee_head_id);
CREATE INDEX ix_sfa_structure        ON student_fee_allocations (fee_structure_id) WHERE fee_structure_id IS NOT NULL;
CREATE INDEX ix_sfa_tenant           ON student_fee_allocations (tenant_id);

-- ---------------------------------------------------------------------
-- A4. fee_invoices + fee_invoice_items — a bill split into heads
--     gross/concession come from items, paid_amount from successful
--     transactions; both are trigger-maintained. status is derived.
-- ---------------------------------------------------------------------
CREATE TABLE fee_invoices (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid            NOT NULL,
    branch_id           uuid            NOT NULL,
    student_id          uuid            NOT NULL,
    academic_year_id    uuid            NOT NULL,
    invoice_number      varchar(40)     NOT NULL,
    period_label        varchar(50),                         -- 'April 2026', 'Q1 2026-27'
    issue_date          date            NOT NULL DEFAULT CURRENT_DATE,
    due_date            date            NOT NULL,
    gross_amount        numeric(12,2)   NOT NULL DEFAULT 0,  -- trigger: sum(items.amount)
    concession_amount   numeric(12,2)   NOT NULL DEFAULT 0,  -- trigger: sum(items.concession_amount)
    fine_amount         numeric(12,2)   NOT NULL DEFAULT 0,  -- late fee, set by billing job
    paid_amount         numeric(12,2)   NOT NULL DEFAULT 0,  -- trigger: successful payments - refunds
    net_amount          numeric(12,2)   GENERATED ALWAYS AS
                            (gross_amount - concession_amount + fine_amount) STORED,
    balance_amount      numeric(12,2)   GENERATED ALWAYS AS
                            (gross_amount - concession_amount + fine_amount - paid_amount) STORED,
    status              invoice_status  NOT NULL DEFAULT 'unpaid',   -- trigger-derived
    fully_paid_at       timestamptz,
    cancelled_at        timestamptz,
    cancel_reason       varchar(255),
    generated_by        uuid,
    notes               text,
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT fk_invoices_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_invoices_student
        FOREIGN KEY (student_id, branch_id) REFERENCES student_profiles (id, branch_id),          -- NO ACTION
    CONSTRAINT fk_invoices_year
        FOREIGN KEY (academic_year_id, branch_id) REFERENCES academic_years (id, branch_id),      -- NO ACTION
    CONSTRAINT fk_invoices_generated_by
        FOREIGN KEY (generated_by, tenant_id) REFERENCES users (id, tenant_id)
        ON DELETE SET NULL (generated_by),

    CONSTRAINT uq_invoices_number    UNIQUE (branch_id, invoice_number),
    CONSTRAINT uq_invoices_id_branch UNIQUE (id, branch_id),
    CONSTRAINT uq_invoices_id_student UNIQUE (id, student_id),

    CONSTRAINT ck_invoices_amounts
        CHECK (gross_amount >= 0 AND concession_amount >= 0 AND fine_amount >= 0
               AND concession_amount <= gross_amount),
    CONSTRAINT ck_invoices_dates   CHECK (due_date >= issue_date),
    CONSTRAINT ck_invoices_cancel  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);

-- ---- Outstanding-dues indexes (the hot path for defaulter lists / reminders) ----
-- Branch defaulter list ordered by due date, answerable from the index alone.
CREATE INDEX ix_invoices_outstanding_branch
    ON fee_invoices (branch_id, due_date)
    INCLUDE (student_id, balance_amount, status)
    WHERE status IN ('unpaid', 'partially_paid');
-- "What does this student owe?" (parent app, fee counter).
CREATE INDEX ix_invoices_outstanding_student
    ON fee_invoices (student_id, due_date)
    INCLUDE (balance_amount)
    WHERE status IN ('unpaid', 'partially_paid');
-- Year-wise collection / status dashboards.
CREATE INDEX ix_invoices_year_status  ON fee_invoices (academic_year_id, status);
CREATE INDEX ix_invoices_student_year ON fee_invoices (student_id, academic_year_id);
CREATE INDEX ix_invoices_tenant       ON fee_invoices (tenant_id);


CREATE TABLE fee_invoice_items (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid            NOT NULL,
    branch_id           uuid            NOT NULL,
    invoice_id          uuid            NOT NULL,
    allocation_id       uuid,                                -- source allocation (if any)
    fee_head_id         uuid            NOT NULL,
    description         varchar(255),
    amount              numeric(12,2)   NOT NULL,
    concession_amount   numeric(12,2)   NOT NULL DEFAULT 0,
    net_amount          numeric(12,2)   GENERATED ALWAYS AS (amount - concession_amount) STORED,
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT fk_invoice_items_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_invoice_items_invoice
        FOREIGN KEY (invoice_id, branch_id) REFERENCES fee_invoices (id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_invoice_items_allocation
        FOREIGN KEY (allocation_id, branch_id) REFERENCES student_fee_allocations (id, branch_id),  -- NO ACTION
    CONSTRAINT fk_invoice_items_head
        FOREIGN KEY (fee_head_id, branch_id) REFERENCES fee_heads (id, branch_id),                -- NO ACTION

    CONSTRAINT ck_invoice_items_amounts
        CHECK (amount >= 0 AND concession_amount >= 0 AND concession_amount <= amount)
);

-- An allocation can be billed on only one invoice line.
CREATE UNIQUE INDEX uq_invoice_items_allocation
    ON fee_invoice_items (allocation_id) WHERE allocation_id IS NOT NULL;
CREATE INDEX ix_invoice_items_invoice ON fee_invoice_items (invoice_id);
CREATE INDEX ix_invoice_items_head    ON fee_invoice_items (fee_head_id);   -- head-wise collection report
CREATE INDEX ix_invoice_items_tenant  ON fee_invoice_items (tenant_id);

-- ---------------------------------------------------------------------
-- A5. fee_transactions — every payment attempt / refund, gateway or counter
-- ---------------------------------------------------------------------
CREATE TABLE fee_transactions (
    id                      uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               uuid            NOT NULL,
    branch_id               uuid            NOT NULL,
    invoice_id              uuid            NOT NULL,
    student_id              uuid            NOT NULL,
    txn_type                txn_type        NOT NULL DEFAULT 'payment',
    refund_of_id            uuid,                            -- original payment for a refund
    amount                  numeric(12,2)   NOT NULL,
    currency                char(3)         NOT NULL DEFAULT 'INR',
    payment_mode            payment_mode    NOT NULL,
    status                  txn_status      NOT NULL DEFAULT 'initiated',
    receipt_number          varchar(40),                     -- assigned when status = success
    idempotency_key         varchar(100),                    -- client/app retry protection

    -- Gateway (Razorpay / PayU / Cashfree / Stripe ...)
    gateway                 varchar(30),
    gateway_order_id        varchar(100),
    gateway_payment_id      varchar(100),
    gateway_signature       varchar(255),
    gateway_status          varchar(50),                     -- raw status string from gateway
    gateway_fee             numeric(10,2),
    gateway_response        jsonb,                           -- full webhook / callback payload
    failure_reason          varchar(255),

    -- Offline instruments
    instrument_number       varchar(50),                     -- cheque / DD / UTR number
    instrument_date         date,
    bank_name               varchar(100),

    initiated_at            timestamptz     NOT NULL DEFAULT now(),
    completed_at            timestamptz,                     -- success / failure time
    collected_by            uuid,                            -- cashier for counter payments
    remarks                 text,
    created_at              timestamptz     NOT NULL DEFAULT now(),
    updated_at              timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT fk_txn_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    -- Invoice must belong to the same student; invoices with payments can't be deleted.
    CONSTRAINT fk_txn_invoice
        FOREIGN KEY (invoice_id, student_id) REFERENCES fee_invoices (id, student_id),            -- NO ACTION
    CONSTRAINT fk_txn_invoice_branch
        FOREIGN KEY (invoice_id, branch_id) REFERENCES fee_invoices (id, branch_id),              -- NO ACTION
    CONSTRAINT fk_txn_refund_of
        FOREIGN KEY (refund_of_id) REFERENCES fee_transactions (id),                              -- NO ACTION
    CONSTRAINT fk_txn_collected_by
        FOREIGN KEY (collected_by, tenant_id) REFERENCES users (id, tenant_id)
        ON DELETE SET NULL (collected_by),

    CONSTRAINT ck_txn_amount          CHECK (amount > 0),
    CONSTRAINT ck_txn_refund_link     CHECK ((txn_type = 'refund') = (refund_of_id IS NOT NULL)),
    CONSTRAINT ck_txn_receipt_success CHECK (receipt_number IS NULL OR status = 'success'),
    CONSTRAINT ck_txn_completed       CHECK (status NOT IN ('success', 'failed') OR completed_at IS NOT NULL)
);

CREATE UNIQUE INDEX uq_txn_receipt
    ON fee_transactions (branch_id, receipt_number) WHERE receipt_number IS NOT NULL;
CREATE UNIQUE INDEX uq_txn_gateway_payment
    ON fee_transactions (gateway, gateway_payment_id) WHERE gateway_payment_id IS NOT NULL;   -- webhook dedupe
CREATE UNIQUE INDEX uq_txn_idempotency
    ON fee_transactions (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX ix_txn_gateway_order     ON fee_transactions (gateway_order_id) WHERE gateway_order_id IS NOT NULL;
CREATE INDEX ix_txn_invoice           ON fee_transactions (invoice_id) INCLUDE (txn_type, status, amount);
CREATE INDEX ix_txn_student           ON fee_transactions (student_id, completed_at DESC);
-- Daily collection / day-book report.
CREATE INDEX ix_txn_branch_daybook    ON fee_transactions (branch_id, completed_at)
    INCLUDE (amount, payment_mode, txn_type) WHERE status = 'success';
-- Reconciliation queue: attempts stuck in initiated/pending.
CREATE INDEX ix_txn_pending           ON fee_transactions (branch_id, initiated_at)
    WHERE status IN ('initiated', 'pending');
CREATE INDEX ix_txn_refund_of         ON fee_transactions (refund_of_id) WHERE refund_of_id IS NOT NULL;
CREATE INDEX ix_txn_tenant            ON fee_transactions (tenant_id);

-- ---------------------------------------------------------------------
-- A6. Fee triggers — keep invoice totals and status honest
-- ---------------------------------------------------------------------

-- Derive invoice status from amounts (runs before every insert/update of an invoice).
CREATE OR REPLACE FUNCTION trg_fee_invoice_derive_status()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_net numeric(12,2);
BEGIN
    IF NEW.status = 'cancelled' THEN
        NEW.cancelled_at := COALESCE(NEW.cancelled_at, now());
        RETURN NEW;
    END IF;
    NEW.cancelled_at := NULL;

    v_net := NEW.gross_amount - NEW.concession_amount + NEW.fine_amount;

    IF NEW.paid_amount >= v_net AND v_net > 0 THEN
        NEW.status := 'paid';
    ELSIF NEW.paid_amount >= v_net AND v_net = 0 AND NEW.gross_amount > 0 THEN
        NEW.status := 'paid';                         -- fully waived
    ELSIF NEW.paid_amount > 0 THEN
        NEW.status := 'partially_paid';
    ELSE
        NEW.status := 'unpaid';
    END IF;

    IF NEW.status = 'paid' THEN
        NEW.fully_paid_at := COALESCE(NEW.fully_paid_at, now());
    ELSE
        NEW.fully_paid_at := NULL;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_fee_invoices_status
    BEFORE INSERT OR UPDATE ON fee_invoices
    FOR EACH ROW EXECUTE FUNCTION trg_fee_invoice_derive_status();

-- Roll item totals up to the invoice.
CREATE OR REPLACE FUNCTION trg_fee_invoice_items_rollup()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE fee_invoices i
       SET gross_amount      = s.gross,
           concession_amount = s.conc
      FROM (
            SELECT inv.id,
                   COALESCE(SUM(it.amount), 0)            AS gross,
                   COALESCE(SUM(it.concession_amount), 0) AS conc
              FROM fee_invoices inv
              LEFT JOIN fee_invoice_items it ON it.invoice_id = inv.id
             WHERE inv.id IN (
                   CASE WHEN TG_OP <> 'DELETE' THEN NEW.invoice_id END,
                   CASE WHEN TG_OP <> 'INSERT' THEN OLD.invoice_id END)
             GROUP BY inv.id
           ) s
     WHERE i.id = s.id;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_fee_invoice_items_rollup
    AFTER INSERT OR UPDATE OR DELETE ON fee_invoice_items
    FOR EACH ROW EXECUTE FUNCTION trg_fee_invoice_items_rollup();

-- Roll successful payments minus successful refunds up to the invoice.
CREATE OR REPLACE FUNCTION trg_fee_transactions_rollup()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE fee_invoices i
       SET paid_amount = s.paid
      FROM (
            SELECT inv.id,
                   COALESCE(SUM(CASE WHEN t.txn_type = 'payment' THEN t.amount ELSE -t.amount END)
                            FILTER (WHERE t.status = 'success'), 0) AS paid
              FROM fee_invoices inv
              LEFT JOIN fee_transactions t ON t.invoice_id = inv.id
             WHERE inv.id IN (
                   CASE WHEN TG_OP <> 'DELETE' THEN NEW.invoice_id END,
                   CASE WHEN TG_OP <> 'INSERT' THEN OLD.invoice_id END)
             GROUP BY inv.id
           ) s
     WHERE i.id = s.id
       AND i.paid_amount IS DISTINCT FROM s.paid;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_fee_transactions_rollup
    AFTER INSERT OR DELETE OR UPDATE OF status, amount, txn_type, invoice_id ON fee_transactions
    FOR EACH ROW EXECUTE FUNCTION trg_fee_transactions_rollup();

-- A successful transaction is a financial record: it can't be edited back or deleted.
CREATE OR REPLACE FUNCTION trg_fee_transactions_lock_success()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    -- Deletes arriving through an FK cascade (tenant/branch removal) run inside the
    -- FK's own trigger, so pg_trigger_depth() > 1; only direct deletes are blocked.
    IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
        RETURN OLD;
    END IF;

    IF OLD.status = 'success' THEN
        IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'fee_transactions %: successful transactions cannot be deleted; record a refund instead', OLD.id
                USING ERRCODE = 'integrity_constraint_violation';
        ELSIF NEW.status <> 'success' OR NEW.amount <> OLD.amount
              OR NEW.invoice_id <> OLD.invoice_id OR NEW.txn_type <> OLD.txn_type THEN
            RAISE EXCEPTION 'fee_transactions %: status/amount/invoice of a successful transaction are immutable', OLD.id
                USING ERRCODE = 'integrity_constraint_violation';
        END IF;
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER trg_fee_transactions_lock
    BEFORE UPDATE OR DELETE ON fee_transactions
    FOR EACH ROW EXECUTE FUNCTION trg_fee_transactions_lock_success();


-- =====================================================================
-- PART B — ACADEMICS & ATTENDANCE
-- =====================================================================

-- ---------------------------------------------------------------------
-- B1. Supporting masters: academic_terms, subjects, grade_scales
-- ---------------------------------------------------------------------
CREATE TABLE academic_terms (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid            NOT NULL,
    branch_id           uuid            NOT NULL,
    academic_year_id    uuid            NOT NULL,
    name                varchar(50)     NOT NULL,            -- 'Term 1', 'Semester 2'
    sequence_no         smallint        NOT NULL,
    start_date          date            NOT NULL,
    end_date            date            NOT NULL,
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT fk_terms_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_terms_year
        FOREIGN KEY (academic_year_id, branch_id) REFERENCES academic_years (id, branch_id) ON DELETE CASCADE,
    CONSTRAINT uq_terms_year_name   UNIQUE (academic_year_id, name),
    CONSTRAINT uq_terms_year_seq    UNIQUE (academic_year_id, sequence_no),
    CONSTRAINT uq_terms_id_year     UNIQUE (id, academic_year_id),
    CONSTRAINT ck_terms_dates       CHECK (end_date > start_date),
    CONSTRAINT ex_terms_no_overlap
        EXCLUDE USING gist (academic_year_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
);

CREATE INDEX ix_terms_tenant ON academic_terms (tenant_id);


CREATE TABLE subjects (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid            NOT NULL,
    branch_id       uuid            NOT NULL,
    name            varchar(100)    NOT NULL,
    code            varchar(20)     NOT NULL,
    subject_type    varchar(20)     NOT NULL DEFAULT 'theory',   -- theory | practical | both | activity
    is_graded_only  boolean         NOT NULL DEFAULT false,      -- co-scholastic: grade, no marks
    display_order   smallint        NOT NULL DEFAULT 0,
    status          record_status   NOT NULL DEFAULT 'active',
    created_at      timestamptz     NOT NULL DEFAULT now(),
    updated_at      timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT fk_subjects_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT uq_subjects_branch_code UNIQUE (branch_id, code),
    CONSTRAINT uq_subjects_id_branch   UNIQUE (id, branch_id),
    CONSTRAINT ck_subjects_type CHECK (subject_type IN ('theory', 'practical', 'both', 'activity'))
);

CREATE INDEX ix_subjects_tenant ON subjects (tenant_id);


-- Percentage -> grade mapping (e.g. CBSE 9-point scale). Several named scales per branch.
CREATE TABLE grade_scales (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid            NOT NULL,
    branch_id       uuid            NOT NULL,
    scale_name      varchar(50)     NOT NULL DEFAULT 'default',
    grade           varchar(5)      NOT NULL,                -- 'A1', 'B2', 'E'
    min_percentage  numeric(5,2)    NOT NULL,
    max_percentage  numeric(5,2)    NOT NULL,
    grade_point     numeric(4,2),
    is_passing      boolean         NOT NULL DEFAULT true,
    description     varchar(100),
    created_at      timestamptz     NOT NULL DEFAULT now(),
    updated_at      timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT fk_grade_scales_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT uq_grade_scales_grade UNIQUE (branch_id, scale_name, grade),
    CONSTRAINT ck_grade_scales_range CHECK (min_percentage >= 0 AND max_percentage <= 100
                                            AND min_percentage <= max_percentage),
    CONSTRAINT ex_grade_scales_no_overlap
        EXCLUDE USING gist (branch_id WITH =, scale_name WITH =,
                            numrange(min_percentage, max_percentage, '[]') WITH &&)
);

-- ---------------------------------------------------------------------
-- B2. student_attendance — daily log, RANGE-partitioned by date
--     (~200 school days x every student per year; partitioning keeps
--      indexes small and lets old years be detached/archived).
-- ---------------------------------------------------------------------
CREATE TABLE student_attendance (
    id                  uuid                NOT NULL DEFAULT gen_random_uuid(),
    tenant_id           uuid                NOT NULL,
    branch_id           uuid                NOT NULL,
    academic_year_id    uuid                NOT NULL,
    section_id          uuid                NOT NULL,        -- snapshot: section on that day
    student_id          uuid                NOT NULL,
    attendance_date     date                NOT NULL,
    status              attendance_status   NOT NULL,
    check_in_time       time,
    leave_reason        varchar(255),
    remarks             varchar(255),
    source              attendance_source   NOT NULL DEFAULT 'manual',
    marked_by           uuid,
    created_at          timestamptz         NOT NULL DEFAULT now(),
    updated_at          timestamptz         NOT NULL DEFAULT now(),

    CONSTRAINT pk_student_attendance PRIMARY KEY (id, attendance_date),
    CONSTRAINT uq_student_attendance_day UNIQUE (student_id, attendance_date),

    CONSTRAINT fk_satt_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_satt_year
        FOREIGN KEY (academic_year_id, branch_id) REFERENCES academic_years (id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_satt_section
        FOREIGN KEY (section_id, branch_id) REFERENCES sections (id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_satt_student
        FOREIGN KEY (student_id, branch_id) REFERENCES student_profiles (id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_satt_marked_by
        FOREIGN KEY (marked_by, tenant_id) REFERENCES users (id, tenant_id)
        ON DELETE SET NULL (marked_by)
) PARTITION BY RANGE (attendance_date);

-- Class register for a day (also serves "which sections haven't marked today").
CREATE INDEX ix_satt_section_date ON student_attendance (section_id, attendance_date) INCLUDE (status);
-- Absentee / late lists for SMS alerts and the principal dashboard.
CREATE INDEX ix_satt_branch_date_absent ON student_attendance (branch_id, attendance_date)
    INCLUDE (student_id, section_id) WHERE status IN ('absent', 'late');
-- Per-student attendance % for a year (report cards, parent app).
CREATE INDEX ix_satt_student_year ON student_attendance (student_id, academic_year_id) INCLUDE (status);
CREATE INDEX ix_satt_tenant       ON student_attendance (tenant_id);

-- Yearly partitions (calendar years). Add one each year via a job or migration.
CREATE TABLE student_attendance_2025 PARTITION OF student_attendance FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE student_attendance_2026 PARTITION OF student_attendance FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE TABLE student_attendance_2027 PARTITION OF student_attendance FOR VALUES FROM ('2027-01-01') TO ('2028-01-01');
CREATE TABLE student_attendance_2028 PARTITION OF student_attendance FOR VALUES FROM ('2028-01-01') TO ('2029-01-01');
CREATE TABLE student_attendance_default PARTITION OF student_attendance DEFAULT;

-- ---------------------------------------------------------------------
-- B3. staff_attendance
-- ---------------------------------------------------------------------
CREATE TABLE staff_attendance (
    id                  uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid                NOT NULL,
    branch_id           uuid                NOT NULL,
    staff_id            uuid                NOT NULL,
    attendance_date     date                NOT NULL,
    status              staff_att_status    NOT NULL,
    check_in_at         timestamptz,
    check_out_at        timestamptz,
    worked_minutes      integer             GENERATED ALWAYS AS (
                            CASE WHEN check_in_at IS NOT NULL AND check_out_at IS NOT NULL
                                 THEN (EXTRACT(EPOCH FROM (check_out_at - check_in_at)) / 60)::integer
                            END) STORED,
    leave_type          varchar(30),                         -- CL / SL / EL / LWP
    remarks             varchar(255),
    source              attendance_source   NOT NULL DEFAULT 'manual',
    marked_by           uuid,
    created_at          timestamptz         NOT NULL DEFAULT now(),
    updated_at          timestamptz         NOT NULL DEFAULT now(),

    CONSTRAINT fk_statt_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_statt_staff
        FOREIGN KEY (staff_id, branch_id) REFERENCES staff_profiles (id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_statt_marked_by
        FOREIGN KEY (marked_by, tenant_id) REFERENCES users (id, tenant_id)
        ON DELETE SET NULL (marked_by),

    CONSTRAINT uq_staff_attendance_day UNIQUE (staff_id, attendance_date),
    CONSTRAINT ck_statt_times CHECK (check_out_at IS NULL OR check_in_at IS NULL OR check_out_at >= check_in_at)
);

CREATE INDEX ix_statt_branch_date ON staff_attendance (branch_id, attendance_date) INCLUDE (staff_id, status);
CREATE INDEX ix_statt_tenant      ON staff_attendance (tenant_id);

-- ---------------------------------------------------------------------
-- B4. exams & exam_schedules
-- ---------------------------------------------------------------------
CREATE TABLE exams (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid            NOT NULL,
    branch_id           uuid            NOT NULL,
    academic_year_id    uuid            NOT NULL,
    term_id             uuid,                                -- NULL = annual / not term-bound
    name                varchar(100)    NOT NULL,            -- 'Periodic Test 1', 'Half Yearly'
    exam_type           exam_type       NOT NULL,
    start_date          date,
    end_date            date,
    weightage           numeric(5,2),                        -- % contribution to term/annual result
    status              exam_status     NOT NULL DEFAULT 'draft',
    results_published_at timestamptz,
    created_by          uuid,
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT fk_exams_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_exams_year
        FOREIGN KEY (academic_year_id, branch_id) REFERENCES academic_years (id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_exams_term
        FOREIGN KEY (term_id, academic_year_id) REFERENCES academic_terms (id, academic_year_id) ON DELETE CASCADE,
    CONSTRAINT fk_exams_created_by
        FOREIGN KEY (created_by, tenant_id) REFERENCES users (id, tenant_id)
        ON DELETE SET NULL (created_by),

    CONSTRAINT uq_exams_year_name       UNIQUE (academic_year_id, name),
    CONSTRAINT uq_exams_id_year_branch  UNIQUE (id, academic_year_id, branch_id),
    CONSTRAINT uq_exams_id_year         UNIQUE (id, academic_year_id),
    CONSTRAINT uq_exams_id_term         UNIQUE (id, term_id),

    CONSTRAINT ck_exams_dates     CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
    CONSTRAINT ck_exams_weightage CHECK (weightage IS NULL OR weightage BETWEEN 0 AND 100),
    CONSTRAINT ck_exams_published CHECK (status <> 'results_published' OR results_published_at IS NOT NULL)
);

CREATE INDEX ix_exams_year_term   ON exams (academic_year_id, term_id);
CREATE INDEX ix_exams_branch_stat ON exams (branch_id, status);
CREATE INDEX ix_exams_tenant      ON exams (tenant_id);


-- One row = one paper: exam x class (x optional section) x subject.
CREATE TABLE exam_schedules (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid            NOT NULL,
    branch_id           uuid            NOT NULL,
    exam_id             uuid            NOT NULL,
    academic_year_id    uuid            NOT NULL,
    class_id            uuid            NOT NULL,
    section_id          uuid,                                -- NULL = all sections of the class
    subject_id          uuid            NOT NULL,
    exam_date           date            NOT NULL,
    start_time          time,
    end_time            time,
    room                varchar(30),
    max_marks           numeric(6,2)    NOT NULL,
    pass_marks          numeric(6,2),
    invigilator_id      uuid,                                -- staff_profiles.id
    marks_locked        boolean         NOT NULL DEFAULT false,
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT fk_esch_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_esch_exam
        FOREIGN KEY (exam_id, academic_year_id, branch_id)
        REFERENCES exams (id, academic_year_id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_esch_class
        FOREIGN KEY (class_id, branch_id) REFERENCES classes (id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_esch_section
        FOREIGN KEY (section_id, class_id, academic_year_id, branch_id)
        REFERENCES sections (id, class_id, academic_year_id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_esch_subject
        FOREIGN KEY (subject_id, branch_id) REFERENCES subjects (id, branch_id),                  -- NO ACTION
    CONSTRAINT fk_esch_invigilator
        FOREIGN KEY (invigilator_id, branch_id) REFERENCES staff_profiles (id, branch_id)
        ON DELETE SET NULL (invigilator_id),

    CONSTRAINT uq_esch_paper UNIQUE NULLS NOT DISTINCT (exam_id, class_id, section_id, subject_id),
    CONSTRAINT uq_esch_id_exam_subject UNIQUE (id, exam_id, subject_id),

    CONSTRAINT ck_esch_marks CHECK (max_marks > 0 AND (pass_marks IS NULL OR pass_marks BETWEEN 0 AND max_marks)),
    CONSTRAINT ck_esch_times CHECK (end_time IS NULL OR start_time IS NULL OR end_time > start_time)
);

CREATE INDEX ix_esch_class_date  ON exam_schedules (class_id, exam_date);         -- class timetable / date sheet
CREATE INDEX ix_esch_exam        ON exam_schedules (exam_id);
CREATE INDEX ix_esch_section     ON exam_schedules (section_id) WHERE section_id IS NOT NULL;
CREATE INDEX ix_esch_subject     ON exam_schedules (subject_id);
CREATE INDEX ix_esch_invigilator ON exam_schedules (invigilator_id, exam_date) WHERE invigilator_id IS NOT NULL;
CREATE INDEX ix_esch_tenant      ON exam_schedules (tenant_id);

-- ---------------------------------------------------------------------
-- B5. marks_entry — one row per student per paper
--     exam_id / subject_id / term_id / academic_year_id are denormalised
--     (and FK-checked against their source) so performance queries never
--     need to join through exam_schedules.
-- ---------------------------------------------------------------------
CREATE TABLE marks_entry (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid            NOT NULL,
    branch_id           uuid            NOT NULL,
    exam_schedule_id    uuid            NOT NULL,
    exam_id             uuid            NOT NULL,
    subject_id          uuid            NOT NULL,
    academic_year_id    uuid            NOT NULL,
    term_id             uuid,
    student_id          uuid            NOT NULL,
    marks_obtained      numeric(6,2),
    max_marks           numeric(6,2)    NOT NULL,            -- copied from schedule at entry time
    percentage          numeric(5,2)    GENERATED ALWAYS AS (
                            CASE WHEN marks_obtained IS NOT NULL
                                 THEN round(marks_obtained * 100 / max_marks, 2) END) STORED,
    grade               varchar(5),
    is_absent           boolean         NOT NULL DEFAULT false,
    is_exempted         boolean         NOT NULL DEFAULT false,
    remarks             varchar(255),
    entered_by          uuid,
    verified_by         uuid,
    verified_at         timestamptz,
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT fk_marks_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    -- Deleting a paper that already has marks is blocked.
    CONSTRAINT fk_marks_schedule
        FOREIGN KEY (exam_schedule_id, exam_id, subject_id)
        REFERENCES exam_schedules (id, exam_id, subject_id),                                      -- NO ACTION
    CONSTRAINT fk_marks_exam_year
        FOREIGN KEY (exam_id, academic_year_id) REFERENCES exams (id, academic_year_id),          -- NO ACTION
    CONSTRAINT fk_marks_exam_term
        FOREIGN KEY (exam_id, term_id) REFERENCES exams (id, term_id),                            -- NO ACTION
    CONSTRAINT fk_marks_student
        FOREIGN KEY (student_id, branch_id) REFERENCES student_profiles (id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_marks_entered_by
        FOREIGN KEY (entered_by, tenant_id) REFERENCES users (id, tenant_id)
        ON DELETE SET NULL (entered_by),
    CONSTRAINT fk_marks_verified_by
        FOREIGN KEY (verified_by, tenant_id) REFERENCES users (id, tenant_id)
        ON DELETE SET NULL (verified_by),

    CONSTRAINT uq_marks_student_paper UNIQUE (exam_schedule_id, student_id),

    CONSTRAINT ck_marks_range  CHECK (max_marks > 0 AND (marks_obtained IS NULL
                                       OR marks_obtained BETWEEN 0 AND max_marks)),
    CONSTRAINT ck_marks_absent CHECK (NOT (is_absent AND marks_obtained IS NOT NULL)),
    CONSTRAINT ck_marks_verify CHECK ((verified_by IS NULL) = (verified_at IS NULL))
);

-- ---- Student-performance indexes ----
-- Student report: all subjects for a term / year.
CREATE INDEX ix_marks_student_term    ON marks_entry (student_id, academic_year_id, term_id, subject_id)
    INCLUDE (marks_obtained, max_marks, percentage, grade);
-- Subject analysis / toppers / rank within an exam.
CREATE INDEX ix_marks_exam_subject_pc ON marks_entry (exam_id, subject_id, percentage DESC NULLS LAST)
    INCLUDE (student_id);
-- Student's progress in one subject across exams (trend graph).
CREATE INDEX ix_marks_student_subject ON marks_entry (student_id, subject_id, exam_id);
-- At-risk list: low scorers per branch/year.
CREATE INDEX ix_marks_low_scores      ON marks_entry (branch_id, academic_year_id, percentage)
    WHERE percentage < 40;
-- Pending verification queue.
CREATE INDEX ix_marks_unverified      ON marks_entry (exam_id) WHERE verified_at IS NULL;
CREATE INDEX ix_marks_tenant          ON marks_entry (tenant_id);

-- Copy max_marks from the paper and block edits once the paper is locked.
CREATE OR REPLACE FUNCTION trg_marks_entry_guard()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_max    numeric(6,2);
    v_locked boolean;
BEGIN
    SELECT max_marks, marks_locked INTO v_max, v_locked
      FROM exam_schedules WHERE id = NEW.exam_schedule_id;

    IF v_locked THEN
        RAISE EXCEPTION 'marks_entry: paper % is locked; unlock it before changing marks', NEW.exam_schedule_id
            USING ERRCODE = 'check_violation';
    END IF;

    NEW.max_marks := v_max;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_marks_entry_guard
    BEFORE INSERT OR UPDATE ON marks_entry
    FOR EACH ROW EXECUTE FUNCTION trg_marks_entry_guard();

-- ---------------------------------------------------------------------
-- B6. report_cards — one per student per term (term_id NULL = annual)
-- ---------------------------------------------------------------------
CREATE TABLE report_cards (
    id                  uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid                NOT NULL,
    branch_id           uuid                NOT NULL,
    student_id          uuid                NOT NULL,
    academic_year_id    uuid                NOT NULL,
    term_id             uuid,
    class_id            uuid                NOT NULL,        -- snapshot at generation time
    section_id          uuid,
    total_marks         numeric(8,2),
    max_marks           numeric(8,2),
    percentage          numeric(5,2)        GENERATED ALWAYS AS (
                            CASE WHEN max_marks > 0 AND total_marks IS NOT NULL
                                 THEN round(total_marks * 100 / max_marks, 2) END) STORED,
    overall_grade       varchar(5),
    grade_point         numeric(4,2),                        -- CGPA
    rank_in_section     integer,
    rank_in_class       integer,
    days_present        smallint,
    days_total          smallint,
    subject_summary     jsonb               NOT NULL DEFAULT '[]'::jsonb,  -- frozen per-subject snapshot
    co_scholastic       jsonb               NOT NULL DEFAULT '{}'::jsonb,
    result              result_status       NOT NULL DEFAULT 'pending',
    teacher_remarks     text,
    principal_remarks   text,
    status              report_card_status  NOT NULL DEFAULT 'draft',
    generated_at        timestamptz,
    published_at        timestamptz,
    published_by        uuid,
    pdf_url             text,
    created_at          timestamptz         NOT NULL DEFAULT now(),
    updated_at          timestamptz         NOT NULL DEFAULT now(),

    CONSTRAINT fk_rc_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_rc_student
        FOREIGN KEY (student_id, branch_id) REFERENCES student_profiles (id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_rc_year
        FOREIGN KEY (academic_year_id, branch_id) REFERENCES academic_years (id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_rc_term
        FOREIGN KEY (term_id, academic_year_id) REFERENCES academic_terms (id, academic_year_id) ON DELETE CASCADE,
    CONSTRAINT fk_rc_class
        FOREIGN KEY (class_id, branch_id) REFERENCES classes (id, branch_id),                     -- NO ACTION
    CONSTRAINT fk_rc_section
        FOREIGN KEY (section_id, class_id, academic_year_id, branch_id)
        REFERENCES sections (id, class_id, academic_year_id, branch_id)
        ON DELETE SET NULL (section_id),
    CONSTRAINT fk_rc_published_by
        FOREIGN KEY (published_by, tenant_id) REFERENCES users (id, tenant_id)
        ON DELETE SET NULL (published_by),

    CONSTRAINT uq_rc_student_term UNIQUE NULLS NOT DISTINCT (student_id, academic_year_id, term_id),

    CONSTRAINT ck_rc_marks      CHECK (total_marks IS NULL OR max_marks IS NULL OR total_marks BETWEEN 0 AND max_marks),
    CONSTRAINT ck_rc_attendance CHECK (days_present IS NULL OR days_total IS NULL OR days_present BETWEEN 0 AND days_total),
    CONSTRAINT ck_rc_rank       CHECK ((rank_in_section IS NULL OR rank_in_section > 0)
                                       AND (rank_in_class IS NULL OR rank_in_class > 0)),
    CONSTRAINT ck_rc_published  CHECK (status <> 'published' OR published_at IS NOT NULL)
);

-- Merit list / section ranking for a term.
CREATE INDEX ix_rc_section_term_pc ON report_cards (section_id, term_id, percentage DESC NULLS LAST)
    INCLUDE (student_id, overall_grade);
CREATE INDEX ix_rc_class_year_pc   ON report_cards (class_id, academic_year_id, percentage DESC NULLS LAST);
-- Parent app: published cards for a student.
CREATE INDEX ix_rc_student_published ON report_cards (student_id, academic_year_id)
    WHERE status = 'published';
-- Promotion / detention review.
CREATE INDEX ix_rc_result          ON report_cards (branch_id, academic_year_id, result)
    WHERE result IN ('fail', 'detained', 'withheld');
CREATE INDEX ix_rc_tenant          ON report_cards (tenant_id);


-- =====================================================================
-- PART C — Reporting view
-- =====================================================================

-- Outstanding dues per student, served by ix_invoices_outstanding_*.
CREATE VIEW v_fee_outstanding AS
SELECT i.tenant_id,
       i.branch_id,
       i.student_id,
       sp.admission_number,
       sp.class_id,
       sp.section_id,
       count(*)                                         AS open_invoices,
       sum(i.balance_amount)                            AS total_due,
       sum(i.balance_amount) FILTER (WHERE i.due_date < CURRENT_DATE) AS overdue_amount,
       min(i.due_date)                                  AS oldest_due_date,
       GREATEST(CURRENT_DATE - min(i.due_date), 0)      AS max_days_overdue
  FROM fee_invoices i
  JOIN student_profiles sp ON sp.id = i.student_id
 WHERE i.status IN ('unpaid', 'partially_paid')
 GROUP BY i.tenant_id, i.branch_id, i.student_id, sp.admission_number, sp.class_id, sp.section_id;


-- =====================================================================
-- updated_at triggers for the new tables
-- =====================================================================
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'fee_heads', 'fee_structures', 'student_fee_allocations',
        'fee_invoices', 'fee_invoice_items', 'fee_transactions',
        'academic_terms', 'subjects', 'grade_scales',
        'student_attendance', 'staff_attendance',
        'exams', 'exam_schedules', 'marks_entry', 'report_cards'
    ]
    LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_%1$s_updated_at
                 BEFORE UPDATE ON %1$I
                 FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at()', t);
    END LOOP;
END;
$$;

COMMIT;
