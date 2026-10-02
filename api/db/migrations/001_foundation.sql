-- =====================================================================
--  SCHOOL ERP — FOUNDATIONAL SCHEMA
--  Target: PostgreSQL 15+
--  Scope : tenants, branches, users, staff_profiles, student_profiles,
--          student_guardians, academic_years, classes, sections
--
--  Design notes
--  * UUID v4 primary keys (gen_random_uuid).
--  * tenant_id is denormalised onto every tenant-scoped table and enforced
--    through composite FKs, so cross-tenant / cross-branch references are
--    impossible at the database level (and RLS can be added later).
--  * Ownership chains CASCADE (tenant -> branch -> users/profiles/classes).
--    Academic references RESTRICT (you can't silently delete a section that
--    still has students).
--  * Role-to-profile integrity is enforced by triggers.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;      -- case-insensitive email / codes
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- exclusion constraint on academic years

-- ---------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------
CREATE TYPE user_role         AS ENUM ('super_admin', 'branch_admin', 'teacher', 'parent', 'student');
CREATE TYPE record_status     AS ENUM ('active', 'inactive', 'suspended', 'archived');
CREATE TYPE gender_type       AS ENUM ('male', 'female', 'other', 'undisclosed');
CREATE TYPE employment_type   AS ENUM ('full_time', 'part_time', 'contract', 'visiting');
CREATE TYPE student_status    AS ENUM ('enrolled', 'promoted', 'transferred', 'graduated', 'withdrawn', 'suspended');
CREATE TYPE guardian_relation AS ENUM ('father', 'mother', 'guardian', 'grandparent', 'sibling', 'other');

-- ---------------------------------------------------------------------
-- Generic trigger functions
-- ---------------------------------------------------------------------

-- Keeps updated_at current on every UPDATE.
CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- Asserts that the user referenced by column TG_ARGV[0] holds one of the
-- roles listed in TG_ARGV[1..n].
--   e.g. EXECUTE FUNCTION trg_assert_user_role('user_id', 'teacher', 'branch_admin')
CREATE OR REPLACE FUNCTION trg_assert_user_role()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_col     text := TG_ARGV[0];
    v_user_id uuid;
    v_role    user_role;
BEGIN
    EXECUTE format('SELECT ($1).%I', v_col) INTO v_user_id USING NEW;

    IF v_user_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT role INTO v_role FROM users WHERE id = v_user_id;

    IF v_role IS NULL OR NOT (v_role::text = ANY (TG_ARGV[1:])) THEN
        RAISE EXCEPTION '%.%: user % has role %, expected one of %',
            TG_TABLE_NAME, v_col, v_user_id, COALESCE(v_role::text, '<none>'), TG_ARGV[1:]
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

-- =====================================================================
-- 1. TENANTS & BRANCHES
-- =====================================================================

CREATE TABLE tenants (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    name            varchar(150)    NOT NULL,
    code            citext          NOT NULL,               -- URL slug / subdomain
    legal_name      varchar(200),
    contact_email   citext,
    contact_phone   varchar(20),
    timezone        varchar(64)     NOT NULL DEFAULT 'Asia/Kolkata',
    locale          varchar(10)     NOT NULL DEFAULT 'en-IN',
    settings        jsonb           NOT NULL DEFAULT '{}'::jsonb,
    status          record_status   NOT NULL DEFAULT 'active',
    created_at      timestamptz     NOT NULL DEFAULT now(),
    updated_at      timestamptz     NOT NULL DEFAULT now(),
    deleted_at      timestamptz,

    CONSTRAINT uq_tenants_code UNIQUE (code),
    CONSTRAINT ck_tenants_code_format CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,62}$')
);

CREATE INDEX ix_tenants_status ON tenants (status) WHERE deleted_at IS NULL;


CREATE TABLE branches (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid            NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    name            varchar(150)    NOT NULL,
    code            citext          NOT NULL,
    affiliation_no  varchar(50),                            -- e.g. CBSE / ICSE / State board no.
    address_line1   varchar(255),
    address_line2   varchar(255),
    city            varchar(100),
    state           varchar(100),
    postal_code     varchar(15),
    country         char(2)         NOT NULL DEFAULT 'IN',
    phone           varchar(20),
    email           citext,
    is_head_office  boolean         NOT NULL DEFAULT false,
    settings        jsonb           NOT NULL DEFAULT '{}'::jsonb,
    status          record_status   NOT NULL DEFAULT 'active',
    created_at      timestamptz     NOT NULL DEFAULT now(),
    updated_at      timestamptz     NOT NULL DEFAULT now(),
    deleted_at      timestamptz,

    CONSTRAINT uq_branches_tenant_code UNIQUE (tenant_id, code),
    CONSTRAINT uq_branches_id_tenant   UNIQUE (id, tenant_id)   -- composite FK target
);

-- At most one head office per tenant.
CREATE UNIQUE INDEX uq_branches_one_head_office
    ON branches (tenant_id) WHERE is_head_office AND deleted_at IS NULL;

CREATE INDEX ix_branches_tenant_status ON branches (tenant_id, status) WHERE deleted_at IS NULL;

-- =====================================================================
-- 2. USERS (authentication)
-- =====================================================================
--  super_admin  : tenant_id NULL  -> platform-wide; tenant_id set -> school-group owner
--  branch_admin / teacher / student : tenant_id AND branch_id required
--  parent       : tenant_id required; branch_id optional (siblings may span branches)

CREATE TABLE users (
    id                      uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               uuid            REFERENCES tenants (id) ON DELETE CASCADE,
    branch_id               uuid,
    role                    user_role       NOT NULL,
    email                   citext,
    phone                   varchar(20),
    username                citext,
    password_hash           text            NOT NULL,
    first_name              varchar(100)    NOT NULL,
    middle_name             varchar(100),
    last_name               varchar(100),
    avatar_url              text,
    status                  record_status   NOT NULL DEFAULT 'active',
    email_verified_at       timestamptz,
    phone_verified_at       timestamptz,
    last_login_at           timestamptz,
    failed_login_attempts   smallint        NOT NULL DEFAULT 0,
    locked_until            timestamptz,
    password_changed_at     timestamptz,
    created_at              timestamptz     NOT NULL DEFAULT now(),
    updated_at              timestamptz     NOT NULL DEFAULT now(),
    deleted_at              timestamptz,

    CONSTRAINT fk_users_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,

    CONSTRAINT ck_users_tenant_required
        CHECK (role = 'super_admin' OR tenant_id IS NOT NULL),
    CONSTRAINT ck_users_branch_required
        CHECK (role NOT IN ('branch_admin', 'teacher', 'student') OR branch_id IS NOT NULL),
    CONSTRAINT ck_users_branch_needs_tenant
        CHECK (branch_id IS NULL OR tenant_id IS NOT NULL),
    CONSTRAINT ck_users_login_identifier
        CHECK (email IS NOT NULL OR phone IS NOT NULL OR username IS NOT NULL),
    CONSTRAINT ck_users_failed_attempts
        CHECK (failed_login_attempts >= 0),

    -- Composite FK targets for profile tables.
    CONSTRAINT uq_users_id_tenant        UNIQUE (id, tenant_id),
    CONSTRAINT uq_users_id_tenant_branch UNIQUE (id, tenant_id, branch_id)
);

-- Login identifiers: unique per tenant among live accounts (NULLs allowed, soft-deleted
-- identifiers can be reused). Platform super_admins (tenant_id NULL) are unique globally.
CREATE UNIQUE INDEX uq_users_tenant_email
    ON users (tenant_id, email)    WHERE tenant_id IS NOT NULL AND email IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_users_platform_email
    ON users (email)               WHERE tenant_id IS NULL AND email IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_users_tenant_username
    ON users (tenant_id, username) WHERE tenant_id IS NOT NULL AND username IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_users_platform_username
    ON users (username)            WHERE tenant_id IS NULL AND username IS NOT NULL AND deleted_at IS NULL;

-- Login lookups (active users only).
CREATE INDEX ix_users_login_phone   ON users (tenant_id, phone) WHERE deleted_at IS NULL AND phone IS NOT NULL;
-- Directory / admin listings.
CREATE INDEX ix_users_tenant_role   ON users (tenant_id, role)  WHERE deleted_at IS NULL;
CREATE INDEX ix_users_branch_role   ON users (branch_id, role)  WHERE deleted_at IS NULL;
CREATE INDEX ix_users_status        ON users (status)           WHERE deleted_at IS NULL;

-- =====================================================================
-- 3. STAFF PROFILES
-- =====================================================================

CREATE TABLE staff_profiles (
    id                      uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 uuid            NOT NULL,
    tenant_id               uuid            NOT NULL,
    branch_id               uuid            NOT NULL,
    employee_code           varchar(30)     NOT NULL,
    designation             varchar(100),
    department              varchar(100),
    employment_type         employment_type NOT NULL DEFAULT 'full_time',
    date_of_joining         date            NOT NULL,
    date_of_leaving         date,
    date_of_birth           date,
    gender                  gender_type,
    qualification           varchar(255),
    specialization          varchar(255),
    experience_years        numeric(4,1),
    address                 jsonb           NOT NULL DEFAULT '{}'::jsonb,
    emergency_contact_name  varchar(150),
    emergency_contact_phone varchar(20),
    status                  record_status   NOT NULL DEFAULT 'active',
    created_at              timestamptz     NOT NULL DEFAULT now(),
    updated_at              timestamptz     NOT NULL DEFAULT now(),
    deleted_at              timestamptz,

    -- Profile must live in the same tenant + branch as its user; dies with the user.
    CONSTRAINT fk_staff_user
        FOREIGN KEY (user_id, tenant_id, branch_id)
        REFERENCES users (id, tenant_id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_staff_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,

    CONSTRAINT uq_staff_user          UNIQUE (user_id),
    CONSTRAINT uq_staff_employee_code UNIQUE (branch_id, employee_code),
    CONSTRAINT uq_staff_id_branch     UNIQUE (id, branch_id),          -- composite FK target

    CONSTRAINT ck_staff_dates      CHECK (date_of_leaving IS NULL OR date_of_leaving >= date_of_joining),
    CONSTRAINT ck_staff_experience CHECK (experience_years IS NULL OR experience_years >= 0)
);

CREATE INDEX ix_staff_tenant           ON staff_profiles (tenant_id);
CREATE INDEX ix_staff_branch_dept      ON staff_profiles (branch_id, department) WHERE deleted_at IS NULL;
CREATE INDEX ix_staff_branch_status    ON staff_profiles (branch_id, status)     WHERE deleted_at IS NULL;

CREATE TRIGGER trg_staff_user_role
    BEFORE INSERT OR UPDATE OF user_id ON staff_profiles
    FOR EACH ROW EXECUTE FUNCTION trg_assert_user_role('user_id', 'branch_admin', 'teacher');

-- =====================================================================
-- 5. ACADEMIC STRUCTURE: academic_years, classes, sections
--    (created before student_profiles, which references them)
-- =====================================================================

CREATE TABLE academic_years (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid            NOT NULL,
    branch_id       uuid            NOT NULL,
    name            varchar(20)     NOT NULL,                -- e.g. '2026-27'
    start_date      date            NOT NULL,
    end_date        date            NOT NULL,
    is_current      boolean         NOT NULL DEFAULT false,
    status          record_status   NOT NULL DEFAULT 'active',
    created_at      timestamptz     NOT NULL DEFAULT now(),
    updated_at      timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT fk_academic_years_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,

    CONSTRAINT uq_academic_years_branch_name UNIQUE (branch_id, name),
    CONSTRAINT uq_academic_years_id_branch   UNIQUE (id, branch_id),   -- composite FK target

    CONSTRAINT ck_academic_years_dates CHECK (end_date > start_date),

    -- No overlapping academic years within a branch.
    CONSTRAINT ex_academic_years_no_overlap
        EXCLUDE USING gist (branch_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
);

-- Exactly one "current" year per branch.
CREATE UNIQUE INDEX uq_academic_years_one_current
    ON academic_years (branch_id) WHERE is_current;

CREATE INDEX ix_academic_years_tenant ON academic_years (tenant_id);


CREATE TABLE classes (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid            NOT NULL,
    branch_id       uuid            NOT NULL,
    name            varchar(50)     NOT NULL,                -- e.g. 'Grade 5', 'LKG'
    code            varchar(20),
    numeric_level   smallint,                                -- for promotion ordering: LKG=-1, UKG=0, 1..12
    display_order   smallint        NOT NULL DEFAULT 0,
    description     text,
    status          record_status   NOT NULL DEFAULT 'active',
    created_at      timestamptz     NOT NULL DEFAULT now(),
    updated_at      timestamptz     NOT NULL DEFAULT now(),
    deleted_at      timestamptz,

    CONSTRAINT fk_classes_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,

    CONSTRAINT uq_classes_branch_name UNIQUE (branch_id, name),
    CONSTRAINT uq_classes_id_branch   UNIQUE (id, branch_id)          -- composite FK target
);

CREATE UNIQUE INDEX uq_classes_branch_code
    ON classes (branch_id, code) WHERE code IS NOT NULL;
CREATE INDEX ix_classes_branch_order ON classes (branch_id, display_order) WHERE deleted_at IS NULL;
CREATE INDEX ix_classes_tenant       ON classes (tenant_id);


-- A section is a class instance within a specific academic year (e.g. Grade 5-A, 2026-27).
CREATE TABLE sections (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid            NOT NULL,
    branch_id           uuid            NOT NULL,
    academic_year_id    uuid            NOT NULL,
    class_id            uuid            NOT NULL,
    name                varchar(20)     NOT NULL,            -- e.g. 'A', 'Rose'
    capacity            smallint,
    room_number         varchar(20),
    class_teacher_id    uuid,                                -- staff_profiles.id
    status              record_status   NOT NULL DEFAULT 'active',
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),
    deleted_at          timestamptz,

    CONSTRAINT fk_sections_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_sections_academic_year
        FOREIGN KEY (academic_year_id, branch_id) REFERENCES academic_years (id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_sections_class
        FOREIGN KEY (class_id, branch_id) REFERENCES classes (id, branch_id) ON DELETE CASCADE,
    -- Teacher must belong to the same branch; if the staff record is removed, only the teacher is cleared.
    CONSTRAINT fk_sections_class_teacher
        FOREIGN KEY (class_teacher_id, branch_id) REFERENCES staff_profiles (id, branch_id)
        ON DELETE SET NULL (class_teacher_id),

    CONSTRAINT uq_sections_year_class_name UNIQUE (academic_year_id, class_id, name),
    CONSTRAINT uq_sections_composite       UNIQUE (id, class_id, academic_year_id, branch_id), -- FK target

    CONSTRAINT ck_sections_capacity CHECK (capacity IS NULL OR capacity > 0)
);

CREATE INDEX ix_sections_class_year    ON sections (class_id, academic_year_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_sections_branch_year   ON sections (branch_id, academic_year_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_sections_class_teacher ON sections (class_teacher_id) WHERE class_teacher_id IS NOT NULL;
CREATE INDEX ix_sections_tenant        ON sections (tenant_id);

-- =====================================================================
-- 4. STUDENT PROFILES
-- =====================================================================

CREATE TABLE student_profiles (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid            NOT NULL,
    tenant_id           uuid            NOT NULL,
    branch_id           uuid            NOT NULL,
    admission_number    varchar(30)     NOT NULL,
    admission_date      date            NOT NULL DEFAULT CURRENT_DATE,
    roll_number         varchar(20),
    academic_year_id    uuid,
    class_id            uuid,
    section_id          uuid,
    parent_id           uuid,                                -- primary parent (users.id, role = parent)
    date_of_birth       date            NOT NULL,
    gender              gender_type,
    blood_group         varchar(5),
    nationality         varchar(50),
    mother_tongue       varchar(50),
    address             jsonb           NOT NULL DEFAULT '{}'::jsonb,
    previous_school     varchar(255),
    status              student_status  NOT NULL DEFAULT 'enrolled',
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),
    deleted_at          timestamptz,

    CONSTRAINT fk_students_user
        FOREIGN KEY (user_id, tenant_id, branch_id)
        REFERENCES users (id, tenant_id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_students_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,

    -- Academic placement: RESTRICT so classes/sections/years with enrolled students can't vanish.
    CONSTRAINT fk_students_academic_year
        FOREIGN KEY (academic_year_id, branch_id) REFERENCES academic_years (id, branch_id) ON DELETE RESTRICT,
    CONSTRAINT fk_students_class
        FOREIGN KEY (class_id, branch_id) REFERENCES classes (id, branch_id) ON DELETE RESTRICT,
    -- Guarantees the section actually belongs to the stated class + year + branch.
    CONSTRAINT fk_students_section
        FOREIGN KEY (section_id, class_id, academic_year_id, branch_id)
        REFERENCES sections (id, class_id, academic_year_id, branch_id) ON DELETE RESTRICT,

    -- Parent must be in the same tenant; deleting the parent account only clears the link.
    CONSTRAINT fk_students_parent
        FOREIGN KEY (parent_id, tenant_id) REFERENCES users (id, tenant_id)
        ON DELETE SET NULL (parent_id),

    CONSTRAINT uq_students_user           UNIQUE (user_id),
    CONSTRAINT uq_students_admission_no   UNIQUE (branch_id, admission_number),
    CONSTRAINT uq_students_section_roll   UNIQUE (section_id, roll_number),

    CONSTRAINT ck_students_section_needs_class
        CHECK (section_id IS NULL OR (class_id IS NOT NULL AND academic_year_id IS NOT NULL)),
    CONSTRAINT ck_students_roll_needs_section
        CHECK (roll_number IS NULL OR section_id IS NOT NULL),
    CONSTRAINT ck_students_blood_group
        CHECK (blood_group IS NULL OR blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
    CONSTRAINT ck_students_dob
        CHECK (date_of_birth < admission_date)
);

CREATE INDEX ix_students_parent          ON student_profiles (parent_id)  WHERE parent_id IS NOT NULL;
CREATE INDEX ix_students_class_section   ON student_profiles (class_id, section_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_students_year_class      ON student_profiles (academic_year_id, class_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_students_branch_status   ON student_profiles (branch_id, status) WHERE deleted_at IS NULL;
CREATE INDEX ix_students_tenant          ON student_profiles (tenant_id);

CREATE TRIGGER trg_students_user_role
    BEFORE INSERT OR UPDATE OF user_id ON student_profiles
    FOR EACH ROW EXECUTE FUNCTION trg_assert_user_role('user_id', 'student');

CREATE TRIGGER trg_students_parent_role
    BEFORE INSERT OR UPDATE OF parent_id ON student_profiles
    FOR EACH ROW EXECUTE FUNCTION trg_assert_user_role('parent_id', 'parent');


-- Many-to-many parent/guardian mapping (both parents, guardians, siblings across branches).
-- student_profiles.parent_id remains the fast-path "primary contact".
CREATE TABLE student_guardians (
    student_id          uuid                NOT NULL REFERENCES student_profiles (id) ON DELETE CASCADE,
    guardian_user_id    uuid                NOT NULL REFERENCES users (id)            ON DELETE CASCADE,
    tenant_id           uuid                NOT NULL REFERENCES tenants (id)          ON DELETE CASCADE,
    relation            guardian_relation   NOT NULL,
    is_primary          boolean             NOT NULL DEFAULT false,
    can_pickup          boolean             NOT NULL DEFAULT true,
    receives_notices    boolean             NOT NULL DEFAULT true,
    created_at          timestamptz         NOT NULL DEFAULT now(),
    updated_at          timestamptz         NOT NULL DEFAULT now(),

    CONSTRAINT pk_student_guardians PRIMARY KEY (student_id, guardian_user_id),
    CONSTRAINT fk_student_guardians_user_tenant
        FOREIGN KEY (guardian_user_id, tenant_id) REFERENCES users (id, tenant_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX uq_student_guardians_one_primary
    ON student_guardians (student_id) WHERE is_primary;
CREATE INDEX ix_student_guardians_guardian ON student_guardians (guardian_user_id);  -- "my children" lookup
CREATE INDEX ix_student_guardians_tenant   ON student_guardians (tenant_id);

CREATE TRIGGER trg_student_guardians_role
    BEFORE INSERT OR UPDATE OF guardian_user_id ON student_guardians
    FOR EACH ROW EXECUTE FUNCTION trg_assert_user_role('guardian_user_id', 'parent');

-- =====================================================================
-- updated_at triggers on every table
-- =====================================================================
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'tenants', 'branches', 'users', 'staff_profiles',
        'academic_years', 'classes', 'sections',
        'student_profiles', 'student_guardians'
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
