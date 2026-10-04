-- =====================================================================
--  SCHOOL ERP — MIGRATION 12: FEE SETUP (CONCESSION RULES) + ACCOUNTS / DAY BOOK
--  Requires migrations 01–10 (011 / 013 belong to other modules and are not needed).
--
--  Fee setup reuses fee_heads, fee_structures and student_fee_allocations from 002.
--  Only the per-student concession RULES are new (student_fee_concessions): a rule says
--  "this student gets X off this head (or every head) this year"; it is stamped onto the
--  student's un-invoiced allocations and onto allocations created later by
--  "apply structure to students". Issued invoices are never touched.
--
--  Day book = one materialised ledger (ledger_entries). Every rupee that enters or leaves
--  an account is one row, posted by the DATABASE so no code path can forget it:
--    fee_receipts INSERT          -> "in",  category fees, voucher = receipt number
--                                    (counter and online receipts alike; cash -> Cash
--                                    account, every other mode -> default Bank account)
--    fee_receipts cancelled       -> "out" reversal of what is not reversed yet
--                                    (detected generically: a status = 'cancelled' or a
--                                    non-null cancelled_at column, whichever exists)
--    fee_transactions refund      -> "out" reversal (category fee_refund), capped so a
--                                    receipt is never reversed for more than it was
--    expenses INSERT              -> "out", voucher VCH; soft delete -> entry soft-deleted
--    manual income                -> written by the API (source manual)
--    transfers (contra)           -> two rows, one voucher, shared transfer_id
--  Unique partial indexes make each source post at most once, so nothing double counts.
--  Existing receipts / refunds / expenses are back-posted at the end of this file.
--  Design notes: docs/accounts.md.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0. Document numbering: allow more document types than invoice/receipt
--    ('voucher' here; other modules may add their own).
-- ---------------------------------------------------------------------
ALTER TABLE document_sequences DROP CONSTRAINT IF EXISTS ck_document_sequences_type;
ALTER TABLE document_sequences
    ADD CONSTRAINT ck_document_sequences_type CHECK (doc_type ~ '^[a-z][a-z_]{1,19}$');


-- =====================================================================
-- 1. FEE CONCESSION RULES
-- =====================================================================
CREATE TABLE student_fee_concessions (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid            NOT NULL,
    branch_id           uuid            NOT NULL,
    student_id          uuid            NOT NULL,
    academic_year_id    uuid            NOT NULL,
    fee_head_id         uuid,                                -- NULL = every head
    concession_type     concession_type NOT NULL,
    concession_value    numeric(12,2)   NOT NULL DEFAULT 0,  -- % or flat rupees per instalment
    reason              varchar(255)    NOT NULL,
    approved_by_name    varchar(150),                        -- as written on the approval ('Principal')
    approved_by         uuid,                                -- user who recorded it
    approved_at         timestamptz     NOT NULL DEFAULT now(),
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT fk_sfc_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_sfc_student
        FOREIGN KEY (student_id, branch_id) REFERENCES student_profiles (id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_sfc_year
        FOREIGN KEY (academic_year_id, branch_id) REFERENCES academic_years (id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_sfc_head
        FOREIGN KEY (fee_head_id, branch_id) REFERENCES fee_heads (id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_sfc_approved_by
        FOREIGN KEY (approved_by, tenant_id) REFERENCES users (id, tenant_id) ON DELETE SET NULL (approved_by),

    CONSTRAINT ck_sfc_type  CHECK (concession_type <> 'none'),
    CONSTRAINT ck_sfc_value CHECK (concession_value >= 0
                                   AND (concession_type <> 'percentage' OR concession_value <= 100)),
    CONSTRAINT ck_sfc_reason CHECK (length(btrim(reason)) >= 2)
);

-- One rule per (student, year, head); NULL head = "all heads" counts as one value.
CREATE UNIQUE INDEX uq_sfc_student_year_head
    ON student_fee_concessions (student_id, academic_year_id, COALESCE(fee_head_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX ix_sfc_tenant ON student_fee_concessions (tenant_id);

CREATE TRIGGER trg_student_fee_concessions_updated_at
    BEFORE UPDATE ON student_fee_concessions FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- Back-fill rules from concessions already stamped on allocations (e.g. "Sibling 10% on
-- Tuition"), when every allocation of that student/year/head carries the same concession.
INSERT INTO student_fee_concessions (tenant_id, branch_id, student_id, academic_year_id, fee_head_id,
                                     concession_type, concession_value, reason, approved_by, approved_at)
SELECT a.tenant_id, a.branch_id, a.student_id, a.academic_year_id, a.fee_head_id,
       min(a.concession_type::text)::concession_type, min(a.concession_value),
       COALESCE(min(a.concession_reason), 'Concession'), (array_agg(a.approved_by))[1], COALESCE(min(a.approved_at), now())
  FROM student_fee_allocations a
 WHERE a.is_active AND a.concession_type <> 'none'
 GROUP BY a.tenant_id, a.branch_id, a.student_id, a.academic_year_id, a.fee_head_id
HAVING count(DISTINCT (a.concession_type, a.concession_value, COALESCE(a.concession_reason, ''))) = 1
   AND count(*) = (SELECT count(*) FROM student_fee_allocations b
                    WHERE b.student_id = a.student_id AND b.academic_year_id = a.academic_year_id
                      AND b.fee_head_id = a.fee_head_id AND b.is_active);


-- =====================================================================
-- 2. ACCOUNTS
-- =====================================================================
CREATE TABLE accounts (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid            NOT NULL,
    branch_id           uuid            NOT NULL,
    name                varchar(100)    NOT NULL,
    account_type        varchar(10)     NOT NULL,            -- cash | bank | upi
    details             varchar(150),                        -- 'SBI Dwarka Sec-6, A/c ••4521'
    default_for         varchar(10),                         -- 'cash' | 'bank': where auto entries post
    opening_balance     numeric(14,2)   NOT NULL DEFAULT 0,  -- balance at the start of opening_date
    opening_date        date            NOT NULL,
    is_active           boolean         NOT NULL DEFAULT true,
    created_by          uuid,
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT fk_accounts_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_accounts_created_by
        FOREIGN KEY (created_by, tenant_id) REFERENCES users (id, tenant_id) ON DELETE SET NULL (created_by),
    CONSTRAINT uq_accounts_id_branch UNIQUE (id, branch_id),
    CONSTRAINT ck_accounts_type    CHECK (account_type IN ('cash', 'bank', 'upi')),
    CONSTRAINT ck_accounts_default CHECK (default_for IS NULL OR (default_for IN ('cash', 'bank') AND is_active)),
    CONSTRAINT ck_accounts_default_type CHECK (default_for IS NULL OR (default_for = 'cash') = (account_type = 'cash')),
    CONSTRAINT ck_accounts_name    CHECK (length(btrim(name)) >= 2)
);

CREATE UNIQUE INDEX uq_accounts_branch_name    ON accounts (branch_id, lower(name));
CREATE UNIQUE INDEX uq_accounts_branch_default ON accounts (branch_id, default_for) WHERE default_for IS NOT NULL;
CREATE INDEX ix_accounts_tenant ON accounts (tenant_id);

CREATE TRIGGER trg_accounts_updated_at
    BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();


-- =====================================================================
-- 3. EXPENSES: account, delete reason, more categories
-- =====================================================================
ALTER TABLE expenses
    ADD COLUMN account_id     uuid,
    ADD COLUMN deleted_by     uuid,
    ADD COLUMN delete_reason  varchar(255);
ALTER TABLE expenses
    ADD CONSTRAINT fk_expenses_account
        FOREIGN KEY (account_id, branch_id) REFERENCES accounts (id, branch_id),            -- NO ACTION
    ADD CONSTRAINT fk_expenses_deleted_by
        FOREIGN KEY (deleted_by, tenant_id) REFERENCES users (id, tenant_id) ON DELETE SET NULL (deleted_by);

ALTER TABLE expenses DROP CONSTRAINT ck_expenses_category;
ALTER TABLE expenses ADD CONSTRAINT ck_expenses_category CHECK (category IN (
    'salary', 'utilities', 'maintenance', 'transport', 'supplies', 'events', 'other',
    'rent', 'printing', 'canteen', 'bank_charges', 'taxes'));


-- =====================================================================
-- 4. LEDGER (the day book)
-- =====================================================================
CREATE TABLE ledger_entries (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid            NOT NULL,
    branch_id           uuid            NOT NULL,
    entry_date          date            NOT NULL,            -- school-local calendar date
    posted_at           timestamptz     NOT NULL DEFAULT now(),  -- order within the day
    direction           varchar(3)      NOT NULL,            -- in | out
    account_id          uuid            NOT NULL,
    category            varchar(30)     NOT NULL,
    amount              numeric(12,2)   NOT NULL,
    party               varchar(150),                        -- received from / paid to
    description         varchar(255)    NOT NULL,
    payment_mode        varchar(20)     NOT NULL,
    reference           varchar(100),                        -- cheque / UTR / bill number
    voucher_no          varchar(40),                         -- VCH number, or the fee receipt number
    source              varchar(20)     NOT NULL,            -- fee_receipt | fee_refund | fee_cancel | expense | manual | transfer
    fee_receipt_id      uuid,
    fee_transaction_id  uuid,                                -- the refund transaction
    expense_id          uuid,
    transfer_id         uuid,                                -- both legs of one transfer
    reverses_entry_id   uuid,                                -- refund / cancellation of a receipt entry
    created_by          uuid,
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),
    deleted_at          timestamptz,
    deleted_by          uuid,
    delete_reason       varchar(255),

    CONSTRAINT fk_ledger_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_ledger_account
        FOREIGN KEY (account_id, branch_id) REFERENCES accounts (id, branch_id),            -- NO ACTION
    CONSTRAINT fk_ledger_receipt
        FOREIGN KEY (fee_receipt_id, branch_id) REFERENCES fee_receipts (id, branch_id),    -- NO ACTION
    CONSTRAINT fk_ledger_txn
        FOREIGN KEY (fee_transaction_id) REFERENCES fee_transactions (id),                  -- NO ACTION
    CONSTRAINT fk_ledger_expense
        FOREIGN KEY (expense_id) REFERENCES expenses (id),                                  -- NO ACTION
    CONSTRAINT fk_ledger_reverses
        FOREIGN KEY (reverses_entry_id) REFERENCES ledger_entries (id),                     -- NO ACTION
    CONSTRAINT fk_ledger_created_by
        FOREIGN KEY (created_by, tenant_id) REFERENCES users (id, tenant_id) ON DELETE SET NULL (created_by),
    CONSTRAINT fk_ledger_deleted_by
        FOREIGN KEY (deleted_by, tenant_id) REFERENCES users (id, tenant_id) ON DELETE SET NULL (deleted_by),

    CONSTRAINT ck_ledger_direction CHECK (direction IN ('in', 'out')),
    CONSTRAINT ck_ledger_amount    CHECK (amount > 0),
    CONSTRAINT ck_ledger_source    CHECK (source IN ('fee_receipt', 'fee_refund', 'fee_cancel', 'expense', 'manual', 'transfer')),
    CONSTRAINT ck_ledger_mode      CHECK (payment_mode IN ('cash', 'upi', 'card', 'bank_transfer', 'cheque', 'demand_draft',
                                                           'net_banking', 'wallet', 'online', 'other')),
    CONSTRAINT ck_ledger_links CHECK (
        (source = 'fee_receipt' AND fee_receipt_id IS NOT NULL AND direction = 'in')
     OR (source = 'fee_refund'  AND fee_transaction_id IS NOT NULL AND direction = 'out')
     OR (source = 'fee_cancel'  AND fee_receipt_id IS NOT NULL AND direction = 'out')
     OR (source = 'expense'     AND expense_id IS NOT NULL AND direction = 'out')
     OR (source = 'transfer'    AND transfer_id IS NOT NULL)
     OR (source = 'manual')),
    CONSTRAINT ck_ledger_deleted CHECK ((deleted_at IS NULL) = (delete_reason IS NULL)),
    CONSTRAINT ck_ledger_description CHECK (length(btrim(description)) >= 2)
);

-- Each source posts at most once.
CREATE UNIQUE INDEX uq_ledger_receipt ON ledger_entries (fee_receipt_id) WHERE source = 'fee_receipt';
CREATE UNIQUE INDEX uq_ledger_cancel  ON ledger_entries (fee_receipt_id) WHERE source = 'fee_cancel';
CREATE UNIQUE INDEX uq_ledger_refund  ON ledger_entries (fee_transaction_id) WHERE source = 'fee_refund';
CREATE UNIQUE INDEX uq_ledger_expense ON ledger_entries (expense_id) WHERE source = 'expense';
CREATE UNIQUE INDEX uq_ledger_transfer_leg ON ledger_entries (transfer_id, direction) WHERE transfer_id IS NOT NULL;
-- Vouchers are unique per branch (a transfer's two legs share one).
CREATE UNIQUE INDEX uq_ledger_voucher ON ledger_entries (branch_id, voucher_no, direction) WHERE voucher_no IS NOT NULL;

CREATE INDEX ix_ledger_daybook  ON ledger_entries (branch_id, entry_date, posted_at) WHERE deleted_at IS NULL;
CREATE INDEX ix_ledger_account  ON ledger_entries (account_id, entry_date) INCLUDE (direction, amount) WHERE deleted_at IS NULL;
CREATE INDEX ix_ledger_reverses ON ledger_entries (reverses_entry_id) WHERE reverses_entry_id IS NOT NULL;
CREATE INDEX ix_ledger_tenant   ON ledger_entries (tenant_id);

CREATE TRIGGER trg_ledger_entries_updated_at
    BEFORE UPDATE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- Money in the book is immutable: amount / direction / account / date of a live entry change
-- only through its source (receipt re-dated, expense corrected), never by hand; rows are never
-- hard-deleted except by a tenant/branch cascade.
CREATE OR REPLACE FUNCTION trg_ledger_entries_guard()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
        RAISE EXCEPTION 'ledger_entries %: entries cannot be deleted; soft-delete with a reason', OLD.id
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
        RAISE EXCEPTION 'ledger_entries %: a deleted entry cannot be restored', OLD.id
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF OLD.source IN ('manual', 'transfer')
       AND (NEW.amount <> OLD.amount OR NEW.direction <> OLD.direction OR NEW.account_id <> OLD.account_id
            OR NEW.entry_date <> OLD.entry_date) THEN
        RAISE EXCEPTION 'ledger_entries %: delete and re-enter instead of editing money', OLD.id
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ledger_entries_guard
    BEFORE UPDATE OR DELETE ON ledger_entries
    FOR EACH ROW EXECUTE FUNCTION trg_ledger_entries_guard();


-- =====================================================================
-- 5. POSTING FUNCTIONS
-- =====================================================================

-- Indian financial year of a date: 2026-05-10 -> '2026-27', 2027-02-01 -> '2026-27'.
CREATE OR REPLACE FUNCTION ledger_fy_key(p_date date)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN extract(month FROM p_date) >= 4
                THEN extract(year FROM p_date)::int || '-' || lpad(((extract(year FROM p_date)::int + 1) % 100)::text, 2, '0')
                ELSE (extract(year FROM p_date)::int - 1) || '-' || lpad((extract(year FROM p_date)::int % 100)::text, 2, '0')
           END;
$$;

CREATE OR REPLACE FUNCTION ledger_fy_start(p_date date)
RETURNS date
LANGUAGE sql IMMUTABLE AS $$
    SELECT make_date(CASE WHEN extract(month FROM p_date) >= 4 THEN extract(year FROM p_date)::int
                          ELSE extract(year FROM p_date)::int - 1 END, 4, 1);
$$;

-- Next gap-free voucher number for (branch, financial year): 'DPS/VCH/2026-27/00007'.
-- Uses the same row-locked counter as invoices and receipts, so it rolls back with the transaction.
CREATE OR REPLACE FUNCTION ledger_next_voucher(p_branch uuid, p_date date)
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
    v_fy   text := ledger_fy_key(p_date);
    v_seq  integer;
    v_code text;
BEGIN
    INSERT INTO document_sequences (branch_id, doc_type, period_key, last_value)
    VALUES (p_branch, 'voucher', v_fy, 1)
    ON CONFLICT (branch_id, doc_type, period_key)
    DO UPDATE SET last_value = document_sequences.last_value + 1
    RETURNING last_value INTO v_seq;
    SELECT upper(code::text) INTO v_code FROM branches WHERE id = p_branch;
    RETURN v_code || '/VCH/' || v_fy || '/' || lpad(v_seq::text, 5, '0');
END;
$$;

-- The branch's default Cash or Bank account; created on first use (opening ₹0 at the start of
-- that financial year) so an automatic posting can never fail for lack of an account.
CREATE OR REPLACE FUNCTION ledger_default_account(p_tenant uuid, p_branch uuid, p_kind text, p_date date)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
    v_id uuid;
BEGIN
    SELECT id INTO v_id FROM accounts WHERE branch_id = p_branch AND default_for = p_kind;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;

    INSERT INTO accounts (tenant_id, branch_id, name, account_type, default_for, opening_balance, opening_date)
    VALUES (p_tenant, p_branch,
            CASE WHEN p_kind = 'cash' THEN 'Cash in hand' ELSE 'Bank account' END,
            p_kind, p_kind, 0, LEAST(p_date, ledger_fy_start(p_date)))
    ON CONFLICT DO NOTHING;

    SELECT id INTO v_id FROM accounts WHERE branch_id = p_branch AND default_for = p_kind;
    IF v_id IS NULL THEN
        -- A non-default account already uses the name: make it the default instead.
        UPDATE accounts SET default_for = p_kind, is_active = true
         WHERE branch_id = p_branch
           AND lower(name) = CASE WHEN p_kind = 'cash' THEN 'cash in hand' ELSE 'bank account' END
           AND (account_type = 'cash') = (p_kind = 'cash')
        RETURNING id INTO v_id;
    END IF;
    IF v_id IS NULL THEN
        RAISE EXCEPTION 'No % account for branch % and none could be created', p_kind, p_branch;
    END IF;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION ledger_kind_for_mode(p_mode text)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN p_mode = 'cash' THEN 'cash' ELSE 'bank' END;
$$;

-- An account's book starts on its opening date. An automatic posting dated earlier (a
-- back-dated receipt) moves the opening date back so every entry stays inside the book.
CREATE OR REPLACE FUNCTION ledger_cover_date(p_account uuid, p_date date)
RETURNS void
LANGUAGE sql AS $$
    UPDATE accounts SET opening_date = p_date WHERE id = p_account AND opening_date > p_date;
$$;

-- ---- fee receipt -> "in"
CREATE OR REPLACE FUNCTION ledger_post_fee_receipt(p_receipt uuid)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    r       record;
    v_acct  uuid;
BEGIN
    IF EXISTS (SELECT 1 FROM ledger_entries WHERE fee_receipt_id = p_receipt AND source = 'fee_receipt') THEN
        RETURN;
    END IF;
    SELECT fr.*, (fr.received_at AT TIME ZONE t.timezone)::date AS local_date,
           concat_ws(' ', u.first_name, u.last_name) AS student_name, sp.admission_number,
           c.name AS class_name, s.name AS section_name
      INTO r
      FROM fee_receipts fr
      JOIN tenants t           ON t.id = fr.tenant_id
      JOIN student_profiles sp ON sp.id = fr.student_id
      JOIN users u             ON u.id = sp.user_id
      LEFT JOIN classes c      ON c.id = sp.class_id
      LEFT JOIN sections s     ON s.id = sp.section_id
     WHERE fr.id = p_receipt;
    IF NOT FOUND THEN RETURN; END IF;

    v_acct := ledger_default_account(r.tenant_id, r.branch_id, ledger_kind_for_mode(r.payment_mode::text), r.local_date);
    PERFORM ledger_cover_date(v_acct, r.local_date);

    INSERT INTO ledger_entries (tenant_id, branch_id, entry_date, posted_at, direction, account_id, category, amount,
                                party, description, payment_mode, reference, voucher_no, source, fee_receipt_id, created_by)
    VALUES (r.tenant_id, r.branch_id, r.local_date, r.received_at, 'in', v_acct, 'fees', r.amount,
            left(r.student_name || ' (' || r.admission_number || ')', 150),
            left('Fee received' || COALESCE(' - ' || concat_ws(' ', r.class_name, r.section_name), ''), 255),
            r.payment_mode::text, r.instrument_number, r.receipt_number, 'fee_receipt', r.id, r.collected_by);
END;
$$;

-- What is still un-reversed of a receipt's ledger entry (receipt amount - refunds - cancellation).
CREATE OR REPLACE FUNCTION ledger_receipt_unreversed(p_entry uuid)
RETURNS numeric
LANGUAGE sql STABLE AS $$
    SELECT e.amount - COALESCE((SELECT sum(x.amount) FROM ledger_entries x
                                 WHERE x.reverses_entry_id = e.id AND x.deleted_at IS NULL), 0)
      FROM ledger_entries e WHERE e.id = p_entry;
$$;

-- ---- refund transaction -> "out" (never more than what is left of the receipt)
CREATE OR REPLACE FUNCTION ledger_post_fee_refund(p_txn uuid)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    t        record;
    v_orig   record;
    v_amount numeric(12,2);
    v_acct   uuid;
BEGIN
    IF EXISTS (SELECT 1 FROM ledger_entries WHERE fee_transaction_id = p_txn AND source = 'fee_refund') THEN
        RETURN;
    END IF;
    SELECT ft.*, (COALESCE(ft.completed_at, ft.updated_at) AT TIME ZONE tn.timezone)::date AS local_date,
           COALESCE(ft.completed_at, ft.updated_at) AS at_time,
           concat_ws(' ', u.first_name, u.last_name) AS student_name, sp.admission_number,
           orig.receipt_id AS orig_receipt_id
      INTO t
      FROM fee_transactions ft
      JOIN tenants tn          ON tn.id = ft.tenant_id
      JOIN student_profiles sp ON sp.id = ft.student_id
      JOIN users u             ON u.id = sp.user_id
      LEFT JOIN fee_transactions orig ON orig.id = ft.refund_of_id
     WHERE ft.id = p_txn AND ft.txn_type = 'refund' AND ft.status = 'success';
    IF NOT FOUND THEN RETURN; END IF;

    SELECT * INTO v_orig FROM ledger_entries
     WHERE fee_receipt_id = t.orig_receipt_id AND source = 'fee_receipt' AND t.orig_receipt_id IS NOT NULL;

    IF FOUND THEN
        v_amount := LEAST(t.amount, ledger_receipt_unreversed(v_orig.id));
        v_acct := v_orig.account_id;
    ELSE
        v_amount := t.amount;
        v_acct := ledger_default_account(t.tenant_id, t.branch_id, ledger_kind_for_mode(t.payment_mode::text), t.local_date);
    END IF;
    IF v_amount <= 0 THEN RETURN; END IF;
    PERFORM ledger_cover_date(v_acct, t.local_date);

    INSERT INTO ledger_entries (tenant_id, branch_id, entry_date, posted_at, direction, account_id, category, amount,
                                party, description, payment_mode, reference, voucher_no, source,
                                fee_transaction_id, fee_receipt_id, reverses_entry_id, created_by)
    VALUES (t.tenant_id, t.branch_id, t.local_date, t.at_time, 'out', v_acct, 'fee_refund', v_amount,
            left(t.student_name || ' (' || t.admission_number || ')', 150),
            left('Fee refund' || COALESCE(' against receipt ' || v_orig.voucher_no, ''), 255),
            t.payment_mode::text, COALESCE(t.instrument_number, t.gateway_payment_id),
            ledger_next_voucher(t.branch_id, t.local_date), 'fee_refund',
            t.id, t.orig_receipt_id, v_orig.id, t.collected_by);
END;
$$;

-- ---- receipt cancelled -> reverse what is left of it (column names are read generically
-- because the receipt-cancellation columns are owned by another module).
CREATE OR REPLACE FUNCTION ledger_post_fee_cancel(p_receipt uuid)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    v_orig   record;
    v_row    jsonb;
    v_amount numeric(12,2);
    v_at     timestamptz;
    v_date   date;
BEGIN
    IF EXISTS (SELECT 1 FROM ledger_entries WHERE fee_receipt_id = p_receipt AND source = 'fee_cancel') THEN
        RETURN;
    END IF;
    SELECT * INTO v_orig FROM ledger_entries WHERE fee_receipt_id = p_receipt AND source = 'fee_receipt';
    IF NOT FOUND THEN RETURN; END IF;
    v_amount := ledger_receipt_unreversed(v_orig.id);
    IF v_amount <= 0 THEN RETURN; END IF;

    SELECT to_jsonb(fr) INTO v_row FROM fee_receipts fr WHERE fr.id = p_receipt;
    v_at := COALESCE(NULLIF(v_row->>'cancelled_at', '')::timestamptz, now());
    SELECT (v_at AT TIME ZONE t.timezone)::date INTO v_date FROM tenants t WHERE t.id = v_orig.tenant_id;
    PERFORM ledger_cover_date(v_orig.account_id, v_date);

    INSERT INTO ledger_entries (tenant_id, branch_id, entry_date, posted_at, direction, account_id, category, amount,
                                party, description, payment_mode, reference, voucher_no, source,
                                fee_receipt_id, reverses_entry_id, created_by)
    VALUES (v_orig.tenant_id, v_orig.branch_id, v_date, v_at, 'out', v_orig.account_id, 'fee_refund', v_amount,
            v_orig.party,
            left('Receipt ' || v_orig.voucher_no || ' cancelled' || COALESCE(': ' || NULLIF(v_row->>'cancel_reason', ''), ''), 255),
            v_orig.payment_mode, NULL, ledger_next_voucher(v_orig.branch_id, v_date), 'fee_cancel',
            p_receipt, v_orig.id, NULLIF(v_row->>'cancelled_by', '')::uuid);
END;
$$;

-- ---- expense -> "out"
CREATE OR REPLACE FUNCTION ledger_post_expense(p_expense uuid)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    e       record;
    v_acct  uuid;
BEGIN
    IF EXISTS (SELECT 1 FROM ledger_entries WHERE expense_id = p_expense AND source = 'expense') THEN
        RETURN;
    END IF;
    SELECT * INTO e FROM expenses WHERE id = p_expense AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN; END IF;

    v_acct := COALESCE(e.account_id, ledger_default_account(e.tenant_id, e.branch_id, ledger_kind_for_mode(e.payment_mode), e.expense_date));
    PERFORM ledger_cover_date(v_acct, e.expense_date);

    INSERT INTO ledger_entries (tenant_id, branch_id, entry_date, posted_at, direction, account_id, category, amount,
                                party, description, payment_mode, reference, voucher_no, source, expense_id, created_by, created_at)
    VALUES (e.tenant_id, e.branch_id, e.expense_date, e.created_at, 'out', v_acct, e.category, e.amount,
            e.vendor, e.description, e.payment_mode, e.reference,
            ledger_next_voucher(e.branch_id, e.expense_date), 'expense', e.id, e.created_by, e.created_at);
END;
$$;


-- =====================================================================
-- 6. TRIGGERS ON THE SOURCES
-- =====================================================================
CREATE OR REPLACE FUNCTION trg_fee_receipts_ledger()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_new    jsonb;
    v_old    jsonb;
    v_date   date;
    v_acct   uuid;
    v_entry  record;
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM ledger_post_fee_receipt(NEW.id);
        RETURN NULL;
    END IF;

    -- Re-dated / corrected receipt: keep its "in" entry in step.
    IF NEW.received_at IS DISTINCT FROM OLD.received_at OR NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.payment_mode IS DISTINCT FROM OLD.payment_mode OR NEW.instrument_number IS DISTINCT FROM OLD.instrument_number THEN
        SELECT * INTO v_entry FROM ledger_entries WHERE fee_receipt_id = NEW.id AND source = 'fee_receipt';
        IF FOUND THEN
            SELECT (NEW.received_at AT TIME ZONE t.timezone)::date INTO v_date FROM tenants t WHERE t.id = NEW.tenant_id;
            v_acct := v_entry.account_id;
            IF NEW.payment_mode IS DISTINCT FROM OLD.payment_mode THEN
                v_acct := ledger_default_account(NEW.tenant_id, NEW.branch_id, ledger_kind_for_mode(NEW.payment_mode::text), v_date);
            END IF;
            PERFORM ledger_cover_date(v_acct, v_date);
            UPDATE ledger_entries
               SET entry_date = v_date, posted_at = NEW.received_at, amount = NEW.amount,
                   payment_mode = NEW.payment_mode::text, reference = NEW.instrument_number, account_id = v_acct
             WHERE id = v_entry.id;
        ELSE
            PERFORM ledger_post_fee_receipt(NEW.id);
        END IF;
    END IF;

    -- Cancellation, whichever shape the receipt table uses (status = 'cancelled' or cancelled_at).
    v_new := to_jsonb(NEW);
    v_old := to_jsonb(OLD);
    IF (v_new->>'status' = 'cancelled' AND v_old->>'status' IS DISTINCT FROM 'cancelled')
       OR (v_new->>'cancelled_at' IS NOT NULL AND v_old->>'cancelled_at' IS NULL) THEN
        PERFORM ledger_post_fee_cancel(NEW.id);
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_fee_receipts_ledger
    AFTER INSERT OR UPDATE ON fee_receipts
    FOR EACH ROW EXECUTE FUNCTION trg_fee_receipts_ledger();

CREATE OR REPLACE FUNCTION trg_fee_transactions_ledger()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.txn_type = 'refund' AND NEW.status = 'success'
       AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'success') THEN
        PERFORM ledger_post_fee_refund(NEW.id);
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_fee_transactions_ledger
    AFTER INSERT OR UPDATE OF status ON fee_transactions
    FOR EACH ROW EXECUTE FUNCTION trg_fee_transactions_ledger();

CREATE OR REPLACE FUNCTION trg_expenses_ledger()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_acct uuid;
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM ledger_post_expense(NEW.id);
        RETURN NULL;
    END IF;

    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        UPDATE ledger_entries
           SET deleted_at = NEW.deleted_at, deleted_by = NEW.deleted_by,
               delete_reason = COALESCE(NEW.delete_reason, 'Expense deleted')
         WHERE expense_id = NEW.id AND source = 'expense' AND deleted_at IS NULL;
        RETURN NULL;
    END IF;

    IF NEW.deleted_at IS NULL THEN
        v_acct := COALESCE(NEW.account_id,
                           ledger_default_account(NEW.tenant_id, NEW.branch_id, ledger_kind_for_mode(NEW.payment_mode), NEW.expense_date));
        PERFORM ledger_cover_date(v_acct, NEW.expense_date);
        UPDATE ledger_entries
           SET entry_date = NEW.expense_date, amount = NEW.amount, category = NEW.category, description = NEW.description,
               party = NEW.vendor, payment_mode = NEW.payment_mode, reference = NEW.reference, account_id = v_acct
         WHERE expense_id = NEW.id AND source = 'expense' AND deleted_at IS NULL;
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_expenses_ledger
    AFTER INSERT OR UPDATE ON expenses
    FOR EACH ROW EXECUTE FUNCTION trg_expenses_ledger();


-- =====================================================================
-- 7. BACK-POST EXISTING MONEY (in date order, so vouchers run in date order)
-- =====================================================================
DO $$
DECLARE
    v record;
BEGIN
    FOR v IN SELECT fr.id FROM fee_receipts fr ORDER BY fr.received_at, fr.created_at, fr.id LOOP
        PERFORM ledger_post_fee_receipt(v.id);
    END LOOP;
    FOR v IN
        SELECT x.kind, x.id FROM (
            SELECT 'expense' AS kind, e.id, e.expense_date AS d, e.created_at AS at FROM expenses e WHERE e.deleted_at IS NULL
            UNION ALL
            SELECT 'refund', ft.id, (COALESCE(ft.completed_at, ft.updated_at) AT TIME ZONE 'Asia/Kolkata')::date, COALESCE(ft.completed_at, ft.updated_at)
              FROM fee_transactions ft WHERE ft.txn_type = 'refund' AND ft.status = 'success'
        ) x ORDER BY x.d, x.at, x.id
    LOOP
        IF v.kind = 'expense' THEN PERFORM ledger_post_expense(v.id); ELSE PERFORM ledger_post_fee_refund(v.id); END IF;
    END LOOP;
END;
$$;

COMMIT;
