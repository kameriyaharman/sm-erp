-- =====================================================================
--  SCHOOL ERP — MIGRATION 11: STUDENT PROFILE + SCHOOL SETUP
--  Requires migrations 01–10.
--
--  student_profiles   the admission-register fields that were missing: Aadhaar, religion,
--                     house, identification marks, both parents' contact + occupation,
--                     guardian relation/phone, emergency contact, previous school (board,
--                     last class passed, TC number/date), allergies + medical notes.
--                     Already there and reused (not duplicated): address (jsonb, now with a
--                     fixed shape), blood_group, nationality, mother_tongue, previous_school,
--                     father_name, mother_name, guardian_name, social_category, pen_number,
--                     apaar_id.
--  student_photos     one passport photo per student, bytea (no object storage on this host),
--                     jpeg / png / webp, at most 2 MB.
--  branches           school-profile fields: website, principal, board, established year,
--                     medium of instruction. (affiliation_no, school_code, udise_code, address,
--                     phone, email already exist.)
--  branch_logos       the school logo printed on certificates and report cards (png / jpeg:
--                     the two formats PDFKit embeds), at most 1 MB.
--
--  Aadhaar: the full number is stored (the admission register needs it), but the API only
--  ever returns it masked (XXXX-XXXX-1234); admins can reveal it through a separate,
--  logged endpoint. Unique per tenant among live records (catches double admissions).
-- =====================================================================

BEGIN;

-- =====================================================================
-- 1. STUDENT PROFILE FIELDS
-- =====================================================================
ALTER TABLE student_profiles
    ADD COLUMN aadhaar_number              varchar(12),
    ADD COLUMN religion                    varchar(30),
    ADD COLUMN house                       varchar(30),
    ADD COLUMN identification_marks        varchar(255),
    ADD COLUMN father_phone                varchar(20),
    ADD COLUMN father_email                citext,
    ADD COLUMN father_occupation           varchar(100),
    ADD COLUMN mother_phone                varchar(20),
    ADD COLUMN mother_email                citext,
    ADD COLUMN mother_occupation           varchar(100),
    ADD COLUMN guardian_relation           varchar(30),
    ADD COLUMN guardian_phone              varchar(20),
    ADD COLUMN emergency_contact_name      varchar(150),
    ADD COLUMN emergency_contact_relation  varchar(30),
    ADD COLUMN emergency_contact_phone     varchar(20),
    ADD COLUMN previous_school_board       varchar(50),
    ADD COLUMN last_class_passed           varchar(30),
    ADD COLUMN tc_number                   varchar(40),
    ADD COLUMN tc_date                     date,
    ADD COLUMN allergies                   varchar(255),
    ADD COLUMN medical_notes               varchar(1000);

ALTER TABLE student_profiles
    ADD CONSTRAINT ck_students_aadhaar CHECK (aadhaar_number IS NULL OR aadhaar_number ~ '^[2-9]\d{11}$'),
    -- address: {} or { line1, line2?, city, state, pincode } (all strings); pincode is 6 digits.
    ADD CONSTRAINT ck_students_address CHECK (
        jsonb_typeof(address) = 'object'
        AND (NOT address ? 'pincode' OR address->>'pincode' ~ '^[1-9]\d{5}$')
    );

CREATE UNIQUE INDEX uq_students_aadhaar
    ON student_profiles (tenant_id, aadhaar_number) WHERE aadhaar_number IS NOT NULL AND deleted_at IS NULL;


-- =====================================================================
-- 2. STUDENT PHOTOS
-- =====================================================================
CREATE TABLE student_photos (
    student_id          uuid            PRIMARY KEY,
    tenant_id           uuid            NOT NULL,
    branch_id           uuid            NOT NULL,
    mime_type           varchar(20)     NOT NULL,
    size_bytes          integer         NOT NULL,
    sha256              char(64)        NOT NULL,         -- ETag
    data                bytea           NOT NULL,
    uploaded_by         uuid,
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT fk_student_photos_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_student_photos_student
        FOREIGN KEY (student_id, branch_id) REFERENCES student_profiles (id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_student_photos_uploaded_by
        FOREIGN KEY (uploaded_by, tenant_id) REFERENCES users (id, tenant_id) ON DELETE SET NULL (uploaded_by),

    CONSTRAINT ck_student_photos_mime CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
    CONSTRAINT ck_student_photos_size CHECK (size_bytes BETWEEN 1 AND 2097152 AND octet_length(data) = size_bytes)
);
ALTER TABLE student_photos ALTER COLUMN data SET STORAGE EXTERNAL;   -- already compressed
CREATE INDEX ix_student_photos_tenant ON student_photos (tenant_id);


-- =====================================================================
-- 3. SCHOOL PROFILE (branches) + LOGO
-- =====================================================================
ALTER TABLE branches
    ADD COLUMN website                 varchar(150),
    ADD COLUMN principal_name          varchar(150),
    ADD COLUMN board                   varchar(60),       -- 'CBSE, New Delhi', 'ICSE', 'UP Board', ...
    ADD COLUMN established_year        smallint,
    ADD COLUMN medium_of_instruction   varchar(30);

ALTER TABLE branches
    ADD CONSTRAINT ck_branches_established CHECK (established_year IS NULL OR established_year BETWEEN 1800 AND 2100);

CREATE TABLE branch_logos (
    branch_id           uuid            PRIMARY KEY,
    tenant_id           uuid            NOT NULL,
    mime_type           varchar(20)     NOT NULL,
    size_bytes          integer         NOT NULL,
    sha256              char(64)        NOT NULL,
    data                bytea           NOT NULL,
    uploaded_by         uuid,
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT fk_branch_logos_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_branch_logos_uploaded_by
        FOREIGN KEY (uploaded_by, tenant_id) REFERENCES users (id, tenant_id) ON DELETE SET NULL (uploaded_by),

    CONSTRAINT ck_branch_logos_mime CHECK (mime_type IN ('image/jpeg', 'image/png')),
    CONSTRAINT ck_branch_logos_size CHECK (size_bytes BETWEEN 1 AND 1048576 AND octet_length(data) = size_bytes)
);
ALTER TABLE branch_logos ALTER COLUMN data SET STORAGE EXTERNAL;
CREATE INDEX ix_branch_logos_tenant ON branch_logos (tenant_id);


-- =====================================================================
-- 4. ACADEMIC SETUP: lookups used by the safe-delete checks
-- =====================================================================
-- "Is this class still used?" checks admission_class_id, which had no index.
CREATE INDEX ix_students_admission_class ON student_profiles (admission_class_id) WHERE admission_class_id IS NOT NULL;


-- =====================================================================
-- updated_at triggers
-- =====================================================================
CREATE TRIGGER trg_student_photos_updated_at
    BEFORE UPDATE ON student_photos FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_branch_logos_updated_at
    BEFORE UPDATE ON branch_logos FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

COMMIT;
