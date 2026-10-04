-- =====================================================================
--  SCHOOL ERP — MIGRATION 14: INDEXES FOR THE LIST FILTERS
--  Requires migrations 01, 09 and 12.
--
--  Every list screen now filters by class / section / dates on the server
--  (docs/api-v2-contract.md, "Filters"). Most of those filters ride on the
--  existing branch + date indexes; these cover the ones that would otherwise
--  scan a branch's whole table:
--
--  student_profiles (section_id)       section filter without a class (teachers,
--                                       homework, portal logins, ledger, logs)
--  homework (branch_id, due_date)       "due between" on the homework list
--  ledger_entries (fee_receipt_id)      day-book class / section filter joins
--                                       fee entries to the student's receipt
--  notices (branch_id, created_at)      date range on the notice board (the feed
--                                       index leads with pinned)
-- =====================================================================

BEGIN;

CREATE INDEX IF NOT EXISTS ix_students_section ON student_profiles (section_id) WHERE deleted_at IS NULL AND section_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_homework_branch_due ON homework (branch_id, due_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_ledger_fee_receipt ON ledger_entries (fee_receipt_id) WHERE fee_receipt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_notices_branch_created ON notices (branch_id, created_at DESC) WHERE deleted_at IS NULL;

COMMIT;
