-- =====================================================================
--  SCHOOL ERP — MIGRATION 10: TEACHER SUBJECT ASSIGNMENTS + HOMEWORK FILES
--  Requires migrations 01–09.
--
--  teacher_subject_assignments  which teacher teaches which subject in which section
--                               (one teacher per subject per section and year). The API
--                               uses it to limit teachers to their own subjects/sections.
--  homework_attachments         files attached to homework, stored in Postgres (bytea):
--                               this host has no object storage. List queries never
--                               select `data`.
--
--  Same conventions as 09: tenant_id + branch_id on every row, composite FKs so a row
--  can never point at another branch's data, academic references CASCADE, user
--  references SET NULL.
-- =====================================================================

BEGIN;

-- Composite FK targets.
ALTER TABLE sections ADD CONSTRAINT uq_sections_id_year   UNIQUE (id, academic_year_id);
ALTER TABLE homework ADD CONSTRAINT uq_homework_id_branch UNIQUE (id, branch_id);


-- =====================================================================
-- 1. TEACHER SUBJECT ASSIGNMENTS
-- =====================================================================
CREATE TABLE teacher_subject_assignments (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid            NOT NULL,
    branch_id           uuid            NOT NULL,
    academic_year_id    uuid            NOT NULL,
    staff_id            uuid            NOT NULL,            -- staff_profiles.id
    section_id          uuid            NOT NULL,
    subject_id          uuid            NOT NULL,
    assigned_by         uuid,
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT fk_tsa_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_tsa_year
        FOREIGN KEY (academic_year_id, branch_id) REFERENCES academic_years (id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_tsa_staff
        FOREIGN KEY (staff_id, branch_id) REFERENCES staff_profiles (id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_tsa_section
        FOREIGN KEY (section_id, branch_id) REFERENCES sections (id, branch_id) ON DELETE CASCADE,
    -- The section belongs to that academic year.
    CONSTRAINT fk_tsa_section_year
        FOREIGN KEY (section_id, academic_year_id) REFERENCES sections (id, academic_year_id) ON DELETE CASCADE,
    CONSTRAINT fk_tsa_subject
        FOREIGN KEY (subject_id, branch_id) REFERENCES subjects (id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_tsa_assigned_by
        FOREIGN KEY (assigned_by, tenant_id) REFERENCES users (id, tenant_id) ON DELETE SET NULL (assigned_by),

    -- One teacher per subject per section (per year).
    CONSTRAINT uq_tsa_section_subject UNIQUE (academic_year_id, section_id, subject_id)
);

-- "What does this teacher teach?" (every teacher request).
CREATE INDEX ix_tsa_staff   ON teacher_subject_assignments (staff_id, academic_year_id);
CREATE INDEX ix_tsa_section ON teacher_subject_assignments (section_id);
CREATE INDEX ix_tsa_subject ON teacher_subject_assignments (subject_id);
CREATE INDEX ix_tsa_tenant  ON teacher_subject_assignments (tenant_id);


-- =====================================================================
-- 2. HOMEWORK ATTACHMENTS
-- =====================================================================
CREATE TABLE homework_attachments (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    homework_id         uuid            NOT NULL,
    tenant_id           uuid            NOT NULL,
    branch_id           uuid            NOT NULL,
    file_name           varchar(160)    NOT NULL,
    mime_type           varchar(100)    NOT NULL,
    size_bytes          integer         NOT NULL,
    data                bytea           NOT NULL,
    uploaded_by         uuid,
    created_at          timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT fk_hwa_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_hwa_homework
        FOREIGN KEY (homework_id, branch_id) REFERENCES homework (id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_hwa_uploaded_by
        FOREIGN KEY (uploaded_by, tenant_id) REFERENCES users (id, tenant_id) ON DELETE SET NULL (uploaded_by),

    CONSTRAINT ck_hwa_size      CHECK (size_bytes BETWEEN 1 AND 5242880 AND octet_length(data) = size_bytes),
    CONSTRAINT ck_hwa_file_name CHECK (length(btrim(file_name)) >= 1)
);

-- PDFs, images and Office files are already compressed: store out of line without
-- spending CPU on TOAST compression.
ALTER TABLE homework_attachments ALTER COLUMN data SET STORAGE EXTERNAL;

CREATE INDEX ix_hwa_homework ON homework_attachments (homework_id, created_at);
CREATE INDEX ix_hwa_tenant   ON homework_attachments (tenant_id);


-- =====================================================================
-- updated_at trigger
-- =====================================================================
CREATE TRIGGER trg_teacher_subject_assignments_updated_at
    BEFORE UPDATE ON teacher_subject_assignments
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

COMMIT;
