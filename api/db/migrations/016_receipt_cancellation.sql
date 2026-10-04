-- =====================================================================
--  SCHOOL ERP — MIGRATION 16: CANCELLING A FEE RECEIPT
--  Requires migrations 02, 04 and 12.
--
--  "Student wale section me fee already paid aa rahi hai ... use unpaid kar sakun":
--  an admin cancels a wrong / bounced / refunded receipt and its invoices become
--  payable again (POST /fees/receipts/:id/cancel, docs/accounts.md section 7).
--
--  Nothing is deleted or rewritten. Inside ONE transaction the API:
--    1. marks the receipt cancelled (status, cancelled_at, cancelled_by, cancel_reason)
--       -> trg_fee_receipts_ledger (012) posts the day-book "out" entry
--          (source fee_cancel, category fee_refund) for the whole receipt;
--    2. records one reversing transaction per payment line of the receipt:
--       txn_type 'refund', refund_of_id = the payment, status 'success'.
--       This is the path trg_fee_transactions_lock_success (002) sanctions
--       ("record a refund instead"): the successful payment rows stay untouched.
--       -> trg_fee_transactions_rollup recomputes paid_amount, the invoice status
--          is derived again (paid -> partially_paid / unpaid);
--       -> trg_fee_transactions_ledger tries to post a fee_refund entry but it is
--          capped at what is left of the receipt (0 after step 1), so the day book
--          gets exactly one reversal.
--  The receipt keeps its number (numbers are never reused) and stays in every list.
-- =====================================================================

BEGIN;

ALTER TABLE fee_receipts
    ADD COLUMN IF NOT EXISTS status        varchar(12)  NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS cancelled_at  timestamptz,
    ADD COLUMN IF NOT EXISTS cancelled_by  uuid,
    ADD COLUMN IF NOT EXISTS cancel_reason varchar(255);

ALTER TABLE fee_receipts DROP CONSTRAINT IF EXISTS ck_receipts_status;
ALTER TABLE fee_receipts
    ADD CONSTRAINT ck_receipts_status CHECK (status IN ('active', 'cancelled'));

ALTER TABLE fee_receipts DROP CONSTRAINT IF EXISTS ck_receipts_cancel;
ALTER TABLE fee_receipts
    ADD CONSTRAINT ck_receipts_cancel CHECK (
        (status = 'cancelled') = (cancelled_at IS NOT NULL)
        AND (status <> 'cancelled' OR cancel_reason IS NOT NULL));

ALTER TABLE fee_receipts DROP CONSTRAINT IF EXISTS fk_receipts_cancelled_by;
ALTER TABLE fee_receipts
    ADD CONSTRAINT fk_receipts_cancelled_by
    FOREIGN KEY (cancelled_by, tenant_id) REFERENCES users (id, tenant_id)
    ON DELETE SET NULL (cancelled_by);

CREATE INDEX IF NOT EXISTS ix_receipts_cancelled
    ON fee_receipts (branch_id, cancelled_at) WHERE status = 'cancelled';

COMMENT ON COLUMN fee_receipts.status IS
    'active | cancelled. A cancelled receipt keeps its number; its payments are reversed by refund transactions.';

-- A cancelled receipt is final: it cannot be restored, re-dated or re-valued (cancel and
-- collect again instead). cancelled_by may still be nulled by its FK when a user is removed.
CREATE OR REPLACE FUNCTION trg_fee_receipts_cancel_guard()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status = 'cancelled' THEN
        IF NEW.status <> 'cancelled'
           OR NEW.amount <> OLD.amount
           OR NEW.received_at IS DISTINCT FROM OLD.received_at
           OR NEW.payment_mode IS DISTINCT FROM OLD.payment_mode
           OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
           OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason THEN
            RAISE EXCEPTION 'fee_receipts %: a cancelled receipt cannot be changed or restored', OLD.id
                USING ERRCODE = 'integrity_constraint_violation';
        END IF;
    ELSIF NEW.status = 'cancelled' THEN
        NEW.cancelled_at := COALESCE(NEW.cancelled_at, now());
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fee_receipts_cancel_guard ON fee_receipts;
CREATE TRIGGER trg_fee_receipts_cancel_guard
    BEFORE UPDATE ON fee_receipts
    FOR EACH ROW EXECUTE FUNCTION trg_fee_receipts_cancel_guard();

COMMIT;
