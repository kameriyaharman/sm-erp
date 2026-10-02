-- =====================================================================
--  SCHOOL ERP — MIGRATION 09: SCHOOL OPERATIONS
--  Requires migrations 01–08.
--
--  notices             school notice board (audience + optional class), soft delete
--  homework            homework set for a section, soft delete
--  timetable_periods   weekly timetable of a section (Mon..Sat), replaced as a whole
--  transport_routes    bus routes (vehicle, driver), soft delete
--  transport_stops     ordered stops of a route with pickup / drop times
--  student_transport   which student rides which route / stop (one row per student)
--  expenses            school expenses register, soft delete
--
--  Same conventions as 01/02: tenant_id + branch_id on every row with the
--  composite branch FK (tenant/branch deletes cascade through everything),
--  composite FKs so a row can never point at another branch's data, user
--  references SET NULL, academic references CASCADE.
-- =====================================================================

BEGIN;

-- =====================================================================
-- 1. NOTICES
-- =====================================================================
CREATE TABLE notices (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid            NOT NULL,
    branch_id           uuid            NOT NULL,
    title               varchar(150)    NOT NULL,
    body                text            NOT NULL,
    audience            varchar(10)     NOT NULL DEFAULT 'all',
    class_id            uuid,                                -- NULL = whole school
    pinned              boolean         NOT NULL DEFAULT false,
    broadcast_batch_id  uuid,                                -- notification_logs.batch_id when sent by SMS
    created_by          uuid,
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),
    deleted_at          timestamptz,

    CONSTRAINT fk_notices_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_notices_class
        FOREIGN KEY (class_id, branch_id) REFERENCES classes (id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_notices_created_by
        FOREIGN KEY (created_by, tenant_id) REFERENCES users (id, tenant_id) ON DELETE SET NULL (created_by),

    CONSTRAINT ck_notices_audience CHECK (audience IN ('all', 'parents', 'teachers')),
    CONSTRAINT ck_notices_title    CHECK (length(btrim(title)) >= 3),
    CONSTRAINT ck_notices_body     CHECK (length(body) BETWEEN 3 AND 4000)
);

CREATE INDEX ix_notices_branch_feed ON notices (branch_id, pinned DESC, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX ix_notices_class       ON notices (class_id) WHERE class_id IS NOT NULL;
CREATE INDEX ix_notices_tenant      ON notices (tenant_id);


-- =====================================================================
-- 2. HOMEWORK
-- =====================================================================
CREATE TABLE homework (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid            NOT NULL,
    branch_id           uuid            NOT NULL,
    section_id          uuid            NOT NULL,
    subject_id          uuid,
    title               varchar(200)    NOT NULL,
    details             text,
    assigned_at         timestamptz     NOT NULL DEFAULT now(),
    due_date            date            NOT NULL,
    created_by          uuid,
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),
    deleted_at          timestamptz,

    CONSTRAINT fk_homework_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_homework_section
        FOREIGN KEY (section_id, branch_id) REFERENCES sections (id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_homework_subject
        FOREIGN KEY (subject_id, branch_id) REFERENCES subjects (id, branch_id) ON DELETE SET NULL (subject_id),
    CONSTRAINT fk_homework_created_by
        FOREIGN KEY (created_by, tenant_id) REFERENCES users (id, tenant_id) ON DELETE SET NULL (created_by),

    CONSTRAINT ck_homework_title   CHECK (length(btrim(title)) >= 3),
    CONSTRAINT ck_homework_details CHECK (details IS NULL OR length(details) <= 4000)
);

CREATE INDEX ix_homework_section_feed ON homework (section_id, assigned_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX ix_homework_branch_feed  ON homework (branch_id, assigned_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX ix_homework_subject      ON homework (subject_id) WHERE subject_id IS NOT NULL;
CREATE INDEX ix_homework_tenant       ON homework (tenant_id);


-- =====================================================================
-- 3. TIMETABLE
-- =====================================================================
CREATE TABLE timetable_periods (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid            NOT NULL,
    branch_id           uuid            NOT NULL,
    section_id          uuid            NOT NULL,
    weekday             smallint        NOT NULL,            -- ISO: 1 = Monday .. 6 = Saturday
    period_no           smallint        NOT NULL,
    start_time          time            NOT NULL,
    end_time            time            NOT NULL,
    kind                varchar(10)     NOT NULL DEFAULT 'class',
    subject_id          uuid,
    label               varchar(60),                         -- free text for breaks / assembly / activities
    teacher_staff_id    uuid,                                -- staff_profiles.id
    room                varchar(30),
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT fk_tt_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_tt_section
        FOREIGN KEY (section_id, branch_id) REFERENCES sections (id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_tt_subject
        FOREIGN KEY (subject_id, branch_id) REFERENCES subjects (id, branch_id) ON DELETE SET NULL (subject_id),
    CONSTRAINT fk_tt_teacher
        FOREIGN KEY (teacher_staff_id, branch_id) REFERENCES staff_profiles (id, branch_id) ON DELETE SET NULL (teacher_staff_id),

    CONSTRAINT uq_tt_slot UNIQUE (section_id, weekday, period_no),

    CONSTRAINT ck_tt_weekday CHECK (weekday BETWEEN 1 AND 6),
    CONSTRAINT ck_tt_period  CHECK (period_no BETWEEN 1 AND 15),
    CONSTRAINT ck_tt_times   CHECK (end_time > start_time),
    CONSTRAINT ck_tt_kind    CHECK (kind IN ('class', 'break', 'assembly', 'activity'))
);

-- "Is this teacher free?" when saving another section's timetable.
CREATE INDEX ix_tt_teacher ON timetable_periods (teacher_staff_id, weekday) WHERE teacher_staff_id IS NOT NULL;
CREATE INDEX ix_tt_subject ON timetable_periods (subject_id) WHERE subject_id IS NOT NULL;
CREATE INDEX ix_tt_tenant  ON timetable_periods (tenant_id);


-- =====================================================================
-- 4. TRANSPORT
-- =====================================================================
CREATE TABLE transport_routes (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid            NOT NULL,
    branch_id           uuid            NOT NULL,
    name                varchar(100)    NOT NULL,
    vehicle_number      varchar(20)     NOT NULL,
    driver_name         varchar(100)    NOT NULL,
    driver_phone        varchar(20)     NOT NULL,
    attendant_name      varchar(100),
    capacity            smallint,
    status              record_status   NOT NULL DEFAULT 'active',
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),
    deleted_at          timestamptz,

    CONSTRAINT fk_routes_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT uq_routes_id_branch UNIQUE (id, branch_id),
    CONSTRAINT ck_routes_capacity  CHECK (capacity IS NULL OR capacity > 0)
);

CREATE UNIQUE INDEX uq_routes_branch_name ON transport_routes (branch_id, lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX ix_routes_tenant ON transport_routes (tenant_id);


CREATE TABLE transport_stops (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid            NOT NULL,
    branch_id           uuid            NOT NULL,
    route_id            uuid            NOT NULL,
    name                varchar(100)    NOT NULL,
    sequence_no         smallint        NOT NULL,
    pickup_time         time            NOT NULL,
    drop_time           time            NOT NULL,
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT fk_stops_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_stops_route
        FOREIGN KEY (route_id, branch_id) REFERENCES transport_routes (id, branch_id) ON DELETE CASCADE,
    -- Deferred: re-ordering stops swaps sequence numbers inside one transaction.
    CONSTRAINT uq_stops_route_seq UNIQUE (route_id, sequence_no) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT uq_stops_id_route  UNIQUE (id, route_id),
    CONSTRAINT ck_stops_seq       CHECK (sequence_no >= 1)
);

CREATE INDEX ix_stops_tenant ON transport_stops (tenant_id);


CREATE TABLE student_transport (
    student_id          uuid            PRIMARY KEY,
    tenant_id           uuid            NOT NULL,
    branch_id           uuid            NOT NULL,
    route_id            uuid            NOT NULL,
    stop_id             uuid            NOT NULL,
    assigned_by         uuid,
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),

    CONSTRAINT fk_stu_transport_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_stu_transport_student
        FOREIGN KEY (student_id, branch_id) REFERENCES student_profiles (id, branch_id) ON DELETE CASCADE,
    CONSTRAINT fk_stu_transport_route
        FOREIGN KEY (route_id, branch_id) REFERENCES transport_routes (id, branch_id) ON DELETE CASCADE,
    -- The stop must be on that route.
    CONSTRAINT fk_stu_transport_stop
        FOREIGN KEY (stop_id, route_id) REFERENCES transport_stops (id, route_id) ON DELETE CASCADE,
    CONSTRAINT fk_stu_transport_assigned_by
        FOREIGN KEY (assigned_by, tenant_id) REFERENCES users (id, tenant_id) ON DELETE SET NULL (assigned_by)
);

CREATE INDEX ix_stu_transport_route ON student_transport (route_id, stop_id);
CREATE INDEX ix_stu_transport_stop  ON student_transport (stop_id);
CREATE INDEX ix_stu_transport_tenant ON student_transport (tenant_id);


-- =====================================================================
-- 5. EXPENSES
-- =====================================================================
CREATE TABLE expenses (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid            NOT NULL,
    branch_id           uuid            NOT NULL,
    category            varchar(20)     NOT NULL,
    description         varchar(255)    NOT NULL,
    amount              numeric(12,2)   NOT NULL,
    expense_date        date            NOT NULL,
    payment_mode        varchar(20)     NOT NULL,
    vendor              varchar(150),
    reference           varchar(100),                        -- bill / cheque / UTR number
    created_by          uuid,
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now(),
    deleted_at          timestamptz,

    CONSTRAINT fk_expenses_branch
        FOREIGN KEY (branch_id, tenant_id) REFERENCES branches (id, tenant_id) ON DELETE CASCADE,
    CONSTRAINT fk_expenses_created_by
        FOREIGN KEY (created_by, tenant_id) REFERENCES users (id, tenant_id) ON DELETE SET NULL (created_by),

    CONSTRAINT ck_expenses_amount   CHECK (amount > 0),
    CONSTRAINT ck_expenses_category CHECK (category IN ('salary', 'utilities', 'maintenance', 'transport', 'supplies', 'events', 'other')),
    CONSTRAINT ck_expenses_mode     CHECK (payment_mode IN ('cash', 'upi', 'bank_transfer', 'cheque', 'card')),
    CONSTRAINT ck_expenses_desc     CHECK (length(btrim(description)) >= 3)
);

CREATE INDEX ix_expenses_branch_date ON expenses (branch_id, expense_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX ix_expenses_tenant      ON expenses (tenant_id);


-- =====================================================================
-- updated_at triggers
-- =====================================================================
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'notices', 'homework', 'timetable_periods',
        'transport_routes', 'transport_stops', 'student_transport', 'expenses'
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
