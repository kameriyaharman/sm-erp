-- =====================================================================
--  SCHOOL ERP — MIGRATION 04: FEE RECEIPTS + DOCUMENT NUMBERING
--  Requires migrations 01–02.
--
--  * document_sequences: gap-free per-branch, per-year counters for invoice
--    and receipt numbers. Incremented inside the same transaction as the
--    document, so a rolled-back payment never burns a number.
--  * fee_receipts: one receipt per counter/online payment. A single payment
--    can settle several invoices; each invoice gets its own fee_transactions
--    row pointing back to the receipt.
-- =====================================================================

BEGIN;

CREATE TABLE document_sequences (
    branch_id       uuid            NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
    doc_type        varchar(20)     NOT NULL,            -- 'invoice' | 'receipt'
    period_key      varchar(20)     NOT NULL,            -- academic year name, e.g. '2026-27'
    last_value      integer         NOT NULL DEFAULT 0,
    created_at      timestamptz     NOT NULL DEFAULT now(),
    updated_at      timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT pk_document_sequences PRIMARY KEY (branch_id, doc_type, period_key),
    CONSTRAINT ck_document_sequences_type  CHECK (doc_type IN ('invoice', 'receipt')),
    CONSTRAINT ck_document_sequences_value CHECK (last_value >= 0)
);


CREATE TABLE fee_receipts (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid            NOT NULL,
    branch_id           uuid            NOT NULL,
    student_id          uuid            NOT NULL,
    academic_year_id    uuid            NOT NULL,
    receipt_number      varchar(40)     NOT NULL,
    amount              numeric(12,2)   NOT NULL,
    payment_mode        payment_mode    NOT NULL,
    instrument_number   varchar(50),                         -- cheque / DD / UTR / card ref
    instrument_date     date,
    bank_name           varchar(100),
    remarks             varchar(255),
    collected_by        uuid,
    received_at         timestamptz     NOT NULL DEFAULT now(),
    idempotency_key     varchar(100),
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT fk_receipts_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_receipts_student
        FOREIGN KEY (student_id, branch_id) REFERENCES student_profiles (id, branch_id),          -- NO ACTION
    CONSTRAINT fk_receipts_year
        FOREIGN KEY (academic_year_id, branch_id) REFERENCES academic_years (id, branch_id),      -- NO ACTION
    CONSTRAINT fk_receipts_collected_by
        FOREIGN KEY (collected_by, tenant_id) REFERENCES users (id, tenant_id)
        ON DELETE SET NULL (collected_by),

    CONSTRAINT uq_receipts_number    UNIQUE (branch_id, receipt_number),
    CONSTRAINT uq_receipts_id_branch UNIQUE (id, branch_id),
    CONSTRAINT ck_receipts_amount    CHECK (amount > 0)
);

-- Double-click / network-retry protection for the "Collect fee" action.
CREATE UNIQUE INDEX uq_receipts_idempotency
    ON fee_receipts (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX ix_receipts_student  ON fee_receipts (student_id, received_at DESC);
CREATE INDEX ix_receipts_daybook  ON fee_receipts (branch_id, received_at) INCLUDE (amount, payment_mode);
CREATE INDEX ix_receipts_tenant   ON fee_receipts (tenant_id);

ALTER TABLE fee_transactions ADD COLUMN receipt_id uuid;
ALTER TABLE fee_transactions
    ADD CONSTRAINT fk_txn_receipt
    FOREIGN KEY (receipt_id, branch_id) REFERENCES fee_receipts (id, branch_id);            -- NO ACTION
CREATE INDEX ix_txn_receipt ON fee_transactions (receipt_id) WHERE receipt_id IS NOT NULL;

CREATE TRIGGER trg_fee_receipts_updated_at
    BEFORE UPDATE ON fee_receipts FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_document_sequences_updated_at
    BEFORE UPDATE ON document_sequences FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

COMMIT;
