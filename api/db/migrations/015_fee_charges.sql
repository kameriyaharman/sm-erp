-- =====================================================================
--  SCHOOL ERP — MIGRATION 15: ONE-OFF CHARGES ("EXTRA FEE")
--  Requires migration 02.
--
--  POST /fees/charges bills a one-off amount (exam fee, picnic, lost ID
--  card…) to one student or to every student of a class / section, as one
--  invoice per student. The client sends a batchId; each invoice remembers
--  it, and (batch, student) is unique, so a retried or double-clicked
--  request never bills a student twice for the same charge.
-- =====================================================================

BEGIN;

ALTER TABLE fee_invoices ADD COLUMN IF NOT EXISTS charge_batch_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_charge_batch
    ON fee_invoices (charge_batch_id, student_id)
 WHERE charge_batch_id IS NOT NULL;

COMMENT ON COLUMN fee_invoices.charge_batch_id IS
    'One-off charge batch (POST /fees/charges) that created this invoice; NULL for regular billing.';

COMMIT;
