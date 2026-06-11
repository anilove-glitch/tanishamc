-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =========================================================
-- 1. ENUM TYPES
-- =========================================================

CREATE TYPE request_type_enum AS ENUM (
    'INVITE_FROM_PRIMARY',
    'APPLICATION_FROM_STUDENT'
);

CREATE TYPE request_status_enum AS ENUM (
    'PENDING',
    'ACCEPTED',
    'REJECTED',
    'CANCELED'
);

CREATE TYPE batch_status_enum AS ENUM (
    'PENDING',
    'ACTIVE',
    'EVALUATING',
    'COMPLETED'
);

CREATE TYPE assigned_by_enum AS ENUM (
    'ALGORITHM',
    'ROLLOVER_PROTECTION',
    'FINAL_SWEEP',
    'ADMIN'
);

CREATE TYPE system_phase_enum AS ENUM (
    'LOBBY',
    'SOFT_LOCK',
    'LIVE_BATCHES',
    'FINAL_SWEEP',
    'ADMIN_MODE'
);

CREATE TYPE group_status_enum AS ENUM (
    'FORMING',
    'SOFT_LOCKED',
    'HARD_LOCKED',
    'ALLOCATED',
    'SHATTERED',
    'PENALIZED'
);

CREATE TYPE allocation_result_enum AS ENUM (
    'PENDING',
    'ALLOCATED',
    'FAILED',
    'ROLLED_OVER',
    'PENALIZED'
);

CREATE TYPE assignment_status_enum AS ENUM (
    'UPCOMING',
    'ACTIVE',
    'PAST'
);

-- =========================================================
-- 2. CORE TABLES
-- =========================================================

CREATE TABLE admins (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    authority_level INTEGER NOT NULL CHECK (authority_level IN (1,2,3)),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE hostels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    name VARCHAR(100) UNIQUE NOT NULL,

    type VARCHAR(50),

    total_capacity INT CHECK (total_capacity >= 0),

    current_phase system_phase_enum
        DEFAULT 'ADMIN_MODE',

    is_paused BOOLEAN DEFAULT FALSE
);

CREATE TABLE batches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    hostel_id UUID NOT NULL
        REFERENCES hostels(id)
        ON DELETE RESTRICT,

    batch_number INT UNIQUE NOT NULL,

    start_time TIMESTAMP WITH TIME ZONE NOT NULL,

    end_time TIMESTAMP WITH TIME ZONE NOT NULL,

    status batch_status_enum DEFAULT 'PENDING',

    CHECK (end_time > start_time)
);

CREATE TABLE rooms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    hostel_id UUID NOT NULL
        REFERENCES hostels(id)
        ON DELETE RESTRICT,

    room_number VARCHAR(50) NOT NULL,

    room_type VARCHAR(50),

    max_capacity INT NOT NULL
        CHECK (max_capacity IN (1,2,3,4)),

    -- Represents RESERVED capacity
    current_occupancy INT DEFAULT 0
        CHECK (
            current_occupancy >= 0
            AND current_occupancy <= max_capacity
        ),

    UNIQUE(hostel_id, room_number)
);

-- =========================================================
-- 3. STUDENTS
-- =========================================================

CREATE TABLE students (
    id SERIAL PRIMARY KEY,

    name VARCHAR(255) NOT NULL,

    father_name VARCHAR(255),

    roll_no VARCHAR(50) UNIQUE NOT NULL,

    department VARCHAR(100),

    semester INTEGER,

    email VARCHAR(255) UNIQUE NOT NULL,

    password_hash VARCHAR(255) NOT NULL,

    student_number VARCHAR(20),

    parent_number VARCHAR(20),

    category VARCHAR(50),

    blood_group VARCHAR(10),

    state VARCHAR(100),

    address TEXT,

    pincode VARCHAR(20),

    cgpa NUMERIC(4,2),

    individual_rank INTEGER UNIQUE,

    group_id UUID,

    is_allotted BOOLEAN DEFAULT FALSE,

    -- Current occupied room
    physical_room_id UUID
        REFERENCES rooms(id)
        ON DELETE SET NULL,

    -- Future reserved room
    allocated_room_id UUID
        REFERENCES rooms(id)
        ON DELETE SET NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================================================
-- 4. GROUPS
-- =========================================================

CREATE TABLE housing_group (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    primary_applicant_id INTEGER NOT NULL
        REFERENCES students(id),

    group_rank INT,

    batch_id UUID
        REFERENCES batches(id)
        ON DELETE SET NULL,

    status group_status_enum
        DEFAULT 'FORMING',

    rollover_count INT DEFAULT 0,

    is_rollover_priority BOOLEAN DEFAULT FALSE
);

ALTER TABLE students
ADD CONSTRAINT fk_group
FOREIGN KEY (group_id)
REFERENCES housing_group(id)
ON DELETE SET NULL;

-- =========================================================
-- 5. GROUP REQUESTS
-- =========================================================

CREATE TABLE group_request (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    group_id UUID NOT NULL
        REFERENCES housing_group(id)
        ON DELETE CASCADE,

    student_id INTEGER NOT NULL
        REFERENCES students(id)
        ON DELETE CASCADE,

    request_type request_type_enum NOT NULL,

    status request_status_enum
        DEFAULT 'PENDING',

    created_at TIMESTAMP WITH TIME ZONE
        DEFAULT CURRENT_TIMESTAMP
);

-- =========================================================
-- 6. ALLOCATION SUBMISSIONS
-- =========================================================

CREATE TABLE allocation_submission (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    group_id UUID NOT NULL
        REFERENCES housing_group(id)
        ON DELETE CASCADE,

    batch_id UUID NOT NULL
        REFERENCES batches(id)
        ON DELETE CASCADE,

    submitted_by INTEGER NOT NULL
        REFERENCES students(id),

    round_number INT NOT NULL
        CHECK (
            round_number >= 1
            AND round_number <= 6
        ),

    submitted_at TIMESTAMP WITH TIME ZONE
        DEFAULT CURRENT_TIMESTAMP,

    is_processed BOOLEAN DEFAULT FALSE,

    allocation_result allocation_result_enum
        DEFAULT 'PENDING',

    -- Immutable historical context
    effective_group_rank INT NOT NULL,

    effective_leader_rank INT NOT NULL,

    effective_group_size INT NOT NULL,

    UNIQUE(group_id, batch_id, round_number)
);

CREATE TABLE submission_preference (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    submission_id UUID NOT NULL
        REFERENCES allocation_submission(id)
        ON DELETE CASCADE,

    room_id UUID NOT NULL
        REFERENCES rooms(id)
        ON DELETE CASCADE,

    preference_order INT NOT NULL
        CHECK (
            preference_order >= 1
            AND preference_order <= 10
        ),

    UNIQUE(submission_id, room_id),

    UNIQUE(submission_id, preference_order)
);

-- =========================================================
-- 7. ROOM ASSIGNMENTS
-- =========================================================

CREATE TABLE room_assignment (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    room_id UUID NOT NULL
        REFERENCES rooms(id)
        ON DELETE CASCADE,

    student_id INTEGER NOT NULL
        REFERENCES students(id)
        ON DELETE CASCADE,

    assigned_by assigned_by_enum NOT NULL,

    assignment_status assignment_status_enum
        DEFAULT 'UPCOMING',

    valid_from DATE,

    valid_until DATE,

    ended_at TIMESTAMP WITH TIME ZONE,

    assigned_at TIMESTAMP WITH TIME ZONE
        DEFAULT CURRENT_TIMESTAMP,

    CHECK (
        valid_until IS NULL
        OR valid_from IS NULL
        OR valid_until >= valid_from
    )
);

-- =========================================================
-- 8. OUTPASS SYSTEM
-- =========================================================

CREATE TABLE outpasses (
    id SERIAL PRIMARY KEY,

    student_id INTEGER NOT NULL
        REFERENCES students(id)
        ON DELETE CASCADE,

    outpass_type VARCHAR(50)
        NOT NULL
        CHECK (
            outpass_type IN ('Local', 'Outstation')
        ),

    place_of_visit VARCHAR(255),

    purpose TEXT,

    application_date DATE
        DEFAULT CURRENT_DATE,

    departure_datetime TIMESTAMP NOT NULL,

    arrival_datetime TIMESTAMP,

    parent_contact VARCHAR(20) NOT NULL,

    is_active BOOLEAN DEFAULT TRUE,

    outp_status VARCHAR(50)
        DEFAULT 'Pending'
        CHECK (
            outp_status IN (
                'Pending',
                'Approved',
                'Rejected'
            )
        ),

    std_status VARCHAR(50)
        DEFAULT 'In'
        CHECK (
            std_status IN ('In','Out')
        ),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE visit_logs (
    id SERIAL PRIMARY KEY,

    outpass_id INTEGER NOT NULL
        REFERENCES outpasses(id)
        ON DELETE CASCADE,

    student_id INTEGER NOT NULL
        REFERENCES students(id)
        ON DELETE CASCADE,

    actual_departure TIMESTAMP
        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    actual_arrival TIMESTAMP,

    remarks TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================================================
-- 9. COMPLAINTS
-- =========================================================

CREATE TABLE complaints (
    id SERIAL PRIMARY KEY,

    student_id INTEGER NOT NULL
        REFERENCES students(id)
        ON DELETE CASCADE,

    description TEXT NOT NULL,

    image_url VARCHAR(500),

    category VARCHAR(100),

    status VARCHAR(50)
        DEFAULT 'Pending'
        CHECK (
            status IN (
                'Pending',
                'In Progress',
                'Resolved'
            )
        ),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================================================
-- 10. VIEWS
-- =========================================================

CREATE VIEW v_housing_groups_with_size AS
SELECT
    hg.*,
    (
        SELECT COUNT(*)
        FROM student s
        WHERE s.group_id = hg.id
    ) AS group_size
FROM housing_group hg;

-- =========================================================
-- 11. INDEXES
-- =========================================================

CREATE INDEX idx_students_individual_rank
ON students(individual_rank);

CREATE INDEX idx_groups_batch_id
ON housing_group(batch_id);

CREATE INDEX idx_groups_group_rank
ON housing_group(group_rank);

CREATE INDEX idx_rooms_occupancy
ON rooms(max_capacity, current_occupancy);

CREATE INDEX idx_visit_logs_student_id
ON visit_logs(student_id);

CREATE INDEX idx_visit_logs_outpass_id
ON visit_logs(outpass_id);

CREATE UNIQUE INDEX idx_unique_active_assignment
ON room_assignment(student_id)
WHERE assignment_status = 'ACTIVE';

CREATE UNIQUE INDEX idx_unique_upcoming_assignment
ON room_assignment(student_id)
WHERE assignment_status = 'UPCOMING';

CREATE UNIQUE INDEX idx_unique_active_request
ON group_request(group_id, student_id)
WHERE status IN ('PENDING', 'ACCEPTED');

-- =========================================================
-- 12. TRIGGERS
-- =========================================================

-- -------------------------------------------------
-- Group Capacity Validation
-- -------------------------------------------------

CREATE OR REPLACE FUNCTION check_group_capacity()
RETURNS TRIGGER AS $$
DECLARE
    v_count INTEGER;
BEGIN

    IF NEW.group_id IS NOT NULL THEN

        PERFORM 1
        FROM housing_group
        WHERE id = NEW.group_id
        FOR UPDATE;

        SELECT COUNT(*)
        INTO v_count
        FROM student
        WHERE group_id = NEW.group_id
          AND id <> NEW.id;

        IF v_count >= 4 THEN
            RAISE EXCEPTION
            'Group % is already at maximum capacity (4)',
            NEW.group_id;
        END IF;

    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_check_group_capacity
BEFORE INSERT OR UPDATE OF group_id
ON students
FOR EACH ROW
EXECUTE FUNCTION check_group_capacity();

-- -------------------------------------------------
-- Prevent Group Modification After Lock
-- -------------------------------------------------

CREATE OR REPLACE FUNCTION prevent_illegal_group_modification()
RETURNS TRIGGER AS $$
DECLARE
    v_status group_status_enum;
BEGIN

    IF OLD.group_id IS NOT NULL THEN

        SELECT status
        INTO v_status
        FROM housing_group
        WHERE id = OLD.group_id;

        IF v_status IN (
            'SOFT_LOCKED',
            'HARD_LOCKED',
            'ALLOCATED'
        ) THEN
            RAISE EXCEPTION
            'Group modifications are forbidden after lock';
        END IF;

    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_prevent_illegal_group_modification
BEFORE UPDATE OF group_id
ON students
FOR EACH ROW
WHEN (OLD.group_id IS DISTINCT FROM NEW.group_id)
EXECUTE FUNCTION prevent_illegal_group_modification();

-- -------------------------------------------------
-- Validate Primary Applicant
-- -------------------------------------------------

CREATE OR REPLACE FUNCTION validate_primary_applicant()
RETURNS TRIGGER AS $$
BEGIN

    IF NOT EXISTS (
        SELECT 1
        FROM student
        WHERE id = NEW.primary_applicant_id
          AND group_id = NEW.id
    ) THEN
        RAISE EXCEPTION
        'Primary applicant must belong to same group';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trigger_validate_primary_applicant
AFTER INSERT OR UPDATE OF primary_applicant_id
ON housing_group
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_primary_applicant();

-- -------------------------------------------------
-- Handle Leader Leaving
-- -------------------------------------------------

CREATE OR REPLACE FUNCTION handle_primary_applicant_leave()
RETURNS TRIGGER AS $$
DECLARE
    v_new_primary INTEGER;
BEGIN

    IF TG_OP = 'DELETE'
       OR (
            TG_OP = 'UPDATE'
            AND OLD.group_id IS DISTINCT FROM NEW.group_id
       ) THEN

        IF OLD.group_id IS NOT NULL THEN

            IF EXISTS (
                SELECT 1
                FROM housing_group
                WHERE id = OLD.group_id
                  AND primary_applicant_id = OLD.id
            ) THEN

                SELECT id
                INTO v_new_primary
                FROM student
                WHERE group_id = OLD.group_id
                  AND id <> OLD.id
                ORDER BY individual_rank ASC
                LIMIT 1;

                IF v_new_primary IS NOT NULL THEN

                    UPDATE housing_group
                    SET primary_applicant_id = v_new_primary
                    WHERE id = OLD.group_id;

                ELSE

                    DELETE FROM housing_group
                    WHERE id = OLD.group_id;

                END IF;

            END IF;

        END IF;

    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_handle_primary_applicant
AFTER UPDATE OF group_id OR DELETE
ON students
FOR EACH ROW
EXECUTE FUNCTION handle_primary_applicant_leave();

-- -------------------------------------------------
-- Dynamic Snapshot Synchronization
-- -------------------------------------------------

CREATE OR REPLACE FUNCTION sync_student_room_snapshot()
RETURNS TRIGGER AS $$
DECLARE
    v_active_room UUID;
    v_upcoming_room UUID;
    v_student_id INTEGER;
BEGIN

    v_student_id := COALESCE(NEW.student_id, OLD.student_id);

    SELECT room_id
    INTO v_active_room
    FROM room_assignment
    WHERE student_id = v_student_id
      AND assignment_status = 'ACTIVE'
    LIMIT 1;

    SELECT room_id
    INTO v_upcoming_room
    FROM room_assignment
    WHERE student_id = v_student_id
      AND assignment_status = 'UPCOMING'
    LIMIT 1;

    UPDATE student
    SET
        physical_room_id = v_active_room,
        allocated_room_id = v_upcoming_room,
        is_allotted = (
            v_active_room IS NOT NULL
            OR v_upcoming_room IS NOT NULL
        )
    WHERE id = v_student_id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_sync_student_room
AFTER INSERT
OR UPDATE OF assignment_status
OR DELETE
ON room_assignment
FOR EACH ROW
EXECUTE FUNCTION sync_student_room_snapshot();

-- -------------------------------------------------
-- Room Occupancy Recalculation
-- -------------------------------------------------

CREATE OR REPLACE FUNCTION recalculate_room_occupancy()
RETURNS TRIGGER AS $$
BEGIN

    IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN

        IF OLD.room_id IS NOT NULL THEN

            UPDATE room
            SET current_occupancy = (
                SELECT COUNT(*)
                FROM room_assignment
                WHERE room_id = OLD.room_id
                  AND assignment_status IN (
                      'ACTIVE',
                      'UPCOMING'
                  )
            )
            WHERE id = OLD.room_id;

        END IF;

    END IF;

    IF TG_OP = 'UPDATE' OR TG_OP = 'INSERT' THEN

        IF NEW.room_id IS NOT NULL THEN

            UPDATE room
            SET current_occupancy = (
                SELECT COUNT(*)
                FROM room_assignment
                WHERE room_id = NEW.room_id
                  AND assignment_status IN (
                      'ACTIVE',
                      'UPCOMING'
                  )
            )
            WHERE id = NEW.room_id;

        END IF;

    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_room_occupancy
AFTER INSERT
OR UPDATE OF room_id
OR UPDATE OF assignment_status
OR DELETE
ON room_assignment
FOR EACH ROW
EXECUTE FUNCTION recalculate_room_occupancy();



-- -------------------------------------------------
-- Validate Submission Timing
-- -------------------------------------------------

CREATE OR REPLACE FUNCTION validate_submission_window()
RETURNS TRIGGER AS $$
DECLARE
    v_start TIMESTAMP WITH TIME ZONE;
    v_end TIMESTAMP WITH TIME ZONE;
BEGIN

    SELECT start_time, end_time
    INTO v_start, v_end
    FROM batch
    WHERE id = NEW.batch_id;

    IF CURRENT_TIMESTAMP < v_start
       OR CURRENT_TIMESTAMP > v_end THEN
        RAISE EXCEPTION
        'Submission outside allowed batch window';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_validate_submission_window
BEFORE INSERT
ON allocation_submission
FOR EACH ROW
EXECUTE FUNCTION validate_submission_window();

-- =========================================================
-- 13. ROOM ASSIGNMENT PROCEDURE
-- =========================================================

CREATE OR REPLACE FUNCTION assign_student_to_room(
    p_student_id INTEGER,
    p_room_id UUID,
    p_assigned_by assigned_by_enum
)
RETURNS BOOLEAN AS $$
DECLARE
    v_current_occupancy INT;
    v_max_capacity INT;
BEGIN

    IF NOT EXISTS (
        SELECT 1
        FROM student
        WHERE id = p_student_id
    ) THEN
        RAISE EXCEPTION
        'Student % does not exist',
        p_student_id;
    END IF;

    SELECT current_occupancy, max_capacity
    INTO v_current_occupancy, v_max_capacity
    FROM room
    WHERE id = p_room_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
        'Room % does not exist',
        p_room_id;
    END IF;

    IF v_current_occupancy >= v_max_capacity THEN
        RAISE EXCEPTION
        'Room % is already at maximum capacity',
        p_room_id;
    END IF;

    -- Remove previous future reservation
    UPDATE room_assignment
    SET
        assignment_status = 'PAST',
        ended_at = CURRENT_TIMESTAMP
    WHERE student_id = p_student_id
      AND assignment_status = 'UPCOMING';

    -- Create future reservation
    INSERT INTO room_assignment (
        room_id,
        student_id,
        assigned_by,
        assignment_status
    )
    VALUES (
        p_room_id,
        p_student_id,
        p_assigned_by,
        'UPCOMING'
    );

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

