-- =====================================================================
--  SCHOOL ERP — MIGRATION 08: OFFICIAL DOCUMENTS
--  Requires migrations 01, 02 and 04.
--
--  * Report cards: exams get a CBSE component code (PT / NB / SEA / MA / PF / TERM)
--    so term marks can be built from weighted components; report cards get a
--    public verification code.
--  * Transfer Certificate / Bonafide: the student fields the CBSE TC format asks
--    for, school identifiers, and a `certificates` register. Each issued
--    certificate keeps a frozen JSON snapshot, a gap-free number and a
--    verification code, so the printed copy can be checked against the school's
--    record and can never silently change.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------- school identifiers
ALTER TABLE branches
    ADD COLUMN school_code  varchar(20),          -- CBSE school code (affiliation_no already exists)
    ADD COLUMN udise_code   varchar(11);          -- UDISE+ code, 11 digits

ALTER TABLE branches
    ADD CONSTRAINT ck_branches_udise CHECK (udise_code IS NULL OR udise_code ~ '^\d{11}$');


-- ---------------------------------------------------------------- student fields used by TC / bonafide
ALTER TABLE student_profiles
    ADD COLUMN father_name          varchar(150),
    ADD COLUMN mother_name          varchar(150),
    ADD COLUMN guardian_name        varchar(150),
    ADD COLUMN social_category      varchar(10),  -- General | SC | ST | OBC | EWS (as in the admission register)
    ADD COLUMN pen_number           varchar(20),  -- UDISE+ Permanent Education Number
    ADD COLUMN apaar_id             varchar(12),  -- APAAR ID (12 digits)
    ADD COLUMN admission_class_id   uuid,         -- class at first admission
    ADD COLUMN date_of_leaving      date;

ALTER TABLE student_profiles
    ADD CONSTRAINT ck_students_category CHECK (social_category IS NULL OR social_category IN ('General', 'SC', 'ST', 'OBC', 'EWS')),
    ADD CONSTRAINT ck_students_apaar    CHECK (apaar_id IS NULL OR apaar_id ~ '^\d{12}$'),
    ADD CONSTRAINT ck_students_leaving  CHECK (date_of_leaving IS NULL OR date_of_leaving >= admission_date),
    ADD CONSTRAINT fk_students_admission_class
        FOREIGN KEY (admission_class_id, branch_id) REFERENCES classes (id, branch_id);   -- NO ACTION

CREATE UNIQUE INDEX uq_students_pen   ON student_profiles (tenant_id, pen_number) WHERE pen_number IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_students_apaar ON student_profiles (apaar_id) WHERE apaar_id IS NOT NULL AND deleted_at IS NULL;


-- ---------------------------------------------------------------- exam components (CBSE)
--   PT   periodic test        NB  notebook submission     SEA subject enrichment
--   MA   multiple assessment  PF  portfolio               TERM half-yearly / yearly / annual exam
ALTER TABLE exams ADD COLUMN component_code varchar(10);
ALTER TABLE exams
    ADD CONSTRAINT ck_exams_component CHECK (component_code IS NULL OR component_code IN ('PT', 'NB', 'SEA', 'MA', 'PF', 'TERM'));


-- ---------------------------------------------------------------- report cards
ALTER TABLE report_cards
    ADD COLUMN verification_code varchar(16),
    ADD COLUMN scheme_code       varchar(20),
    ADD COLUMN is_final          boolean NOT NULL DEFAULT false,   -- annual result (promotion) vs term progress report
    ADD COLUMN snapshot          jsonb,                            -- everything the PDF prints, frozen at generation
    ADD COLUMN result_is_manual  boolean NOT NULL DEFAULT false;   -- the school overrode the computed result
CREATE UNIQUE INDEX uq_rc_verification ON report_cards (verification_code) WHERE verification_code IS NOT NULL;


-- ---------------------------------------------------------------- certificate register
ALTER TABLE document_sequences DROP CONSTRAINT ck_document_sequences_type;
ALTER TABLE document_sequences
    ADD CONSTRAINT ck_document_sequences_type CHECK (doc_type IN ('invoice', 'receipt', 'tc', 'bonafide'));

CREATE TYPE certificate_type   AS ENUM ('transfer_certificate', 'bonafide');
CREATE TYPE certificate_status AS ENUM ('issued', 'cancelled');

CREATE TABLE certificates (
    id                  uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid                NOT NULL,
    branch_id           uuid                NOT NULL,
    student_id          uuid                NOT NULL,
    certificate_type    certificate_type    NOT NULL,
    certificate_number  varchar(40)         NOT NULL,
    verification_code   varchar(16)         NOT NULL,
    content             jsonb               NOT NULL,      -- frozen snapshot: exactly what is printed
    content_sha256      char(64)            NOT NULL,
    status              certificate_status  NOT NULL DEFAULT 'issued',
    issued_at           timestamptz         NOT NULL DEFAULT now(),
    issued_by           uuid,
    print_count         integer             NOT NULL DEFAULT 0,
    last_printed_at     timestamptz,
    cancelled_at        timestamptz,
    cancelled_by        uuid,
    cancel_reason       varchar(255),
    created_at          timestamptz         NOT NULL DEFAULT now(),
    updated_at          timestamptz         NOT NULL DEFAULT now(),

    CONSTRAINT fk_cert_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_cert_student
        FOREIGN KEY (student_id, branch_id) REFERENCES student_profiles (id, branch_id),     -- NO ACTION: keep the register
    CONSTRAINT fk_cert_issued_by
        FOREIGN KEY (issued_by, tenant_id) REFERENCES users (id, tenant_id) ON DELETE SET NULL (issued_by),
    CONSTRAINT fk_cert_cancelled_by
        FOREIGN KEY (cancelled_by, tenant_id) REFERENCES users (id, tenant_id) ON DELETE SET NULL (cancelled_by),

    CONSTRAINT uq_cert_number       UNIQUE (branch_id, certificate_number),
    CONSTRAINT uq_cert_verification UNIQUE (verification_code),
    CONSTRAINT ck_cert_cancel       CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)
                                           AND (status <> 'cancelled' OR cancel_reason IS NOT NULL)),
    CONSTRAINT ck_cert_print        CHECK (print_count >= 0)
);

-- A student can hold only one valid TC; cancel it before issuing a corrected one.
CREATE UNIQUE INDEX uq_cert_one_tc ON certificates (student_id)
    WHERE certificate_type = 'transfer_certificate' AND status = 'issued';
CREATE INDEX ix_cert_student ON certificates (student_id, issued_at DESC);
CREATE INDEX ix_cert_branch  ON certificates (branch_id, certificate_type, issued_at DESC);
CREATE INDEX ix_cert_tenant  ON certificates (tenant_id);

-- The printed content of an issued certificate is immutable; only status/printing metadata may change.
CREATE OR REPLACE FUNCTION trg_certificates_freeze()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.content IS DISTINCT FROM OLD.content
       OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256
       OR NEW.certificate_number IS DISTINCT FROM OLD.certificate_number
       OR NEW.verification_code IS DISTINCT FROM OLD.verification_code
       OR NEW.student_id IS DISTINCT FROM OLD.student_id
       OR NEW.certificate_type IS DISTINCT FROM OLD.certificate_type THEN
        RAISE EXCEPTION 'certificates %: issued content is immutable; cancel and issue a new certificate', OLD.id
            USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
        RAISE EXCEPTION 'certificates %: a cancelled certificate cannot be reinstated', OLD.id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_certificates_freeze
    BEFORE UPDATE ON certificates FOR EACH ROW EXECUTE FUNCTION trg_certificates_freeze();
CREATE TRIGGER trg_certificates_updated_at
    BEFORE UPDATE ON certificates FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

COMMIT;
