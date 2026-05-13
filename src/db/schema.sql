-- =========================================================
-- HOSTEL MANAGEMENT SYSTEM DATABASE SCHEMA
-- =========================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =========================================================
-- ENUM TYPES
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
-- ADMINS
-- =========================================================

CREATE TABLE admins (
    id SERIAL PRIMARY KEY,

    name VARCHAR(255) NOT NULL,

    email VARCHAR(255) UNIQUE NOT NULL,

    password_hash VARCHAR(255) NOT NULL,

    authority_level INTEGER NOT NULL
        CHECK (authority_level IN (1,2,3)),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================================================
-- HOSTELS
-- =========================================================

CREATE TABLE hostels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    name VARCHAR(100) UNIQUE NOT NULL,

    type VARCHAR(50),

    total_capacity INT
        CHECK (total_capacity >= 0),

    current_phase system_phase_enum
        DEFAULT 'ADMIN_MODE',

    is_paused BOOLEAN DEFAULT FALSE
);

-- =========================================================
-- BATCHES
-- =========================================================

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

-- =========================================================
-- ROOMS
-- =========================================================

CREATE TABLE rooms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    hostel_id UUID NOT NULL
        REFERENCES hostels(id)
        ON DELETE RESTRICT,

    room_number VARCHAR(50) NOT NULL,

    room_type VARCHAR(50),

    max_capacity INT NOT NULL
        CHECK (max_capacity IN (3,4)),

    current_occupancy INT DEFAULT 0
        CHECK (
            current_occupancy >= 0
            AND current_occupancy <= max_capacity
        ),

    UNIQUE(hostel_id, room_number)
);

-- =========================================================
-- STUDENTS
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

    physical_room_id UUID
        REFERENCES rooms(id)
        ON DELETE SET NULL,

    allocated_room_id UUID
        REFERENCES rooms(id)
        ON DELETE SET NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================================================
-- HOUSING GROUPS
-- =========================================================

CREATE TABLE housing_groups (
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
REFERENCES housing_groups(id)
ON DELETE SET NULL;

-- =========================================================
-- GROUP REQUESTS
-- =========================================================

CREATE TABLE group_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    group_id UUID NOT NULL
        REFERENCES housing_groups(id)
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
-- ALLOCATION SUBMISSIONS
-- =========================================================

CREATE TABLE allocation_submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    group_id UUID NOT NULL
        REFERENCES housing_groups(id)
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

    effective_group_rank INT NOT NULL,

    effective_leader_rank INT NOT NULL,

    effective_group_size INT NOT NULL,

    UNIQUE(group_id, batch_id, round_number)
);

-- =========================================================
-- SUBMISSION PREFERENCES
-- =========================================================

CREATE TABLE submission_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    submission_id UUID NOT NULL
        REFERENCES allocation_submissions(id)
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
-- ROOM ASSIGNMENTS
-- =========================================================

CREATE TABLE room_assignments (
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
-- OUTPASSES
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

-- =========================================================
-- VISIT LOGS
-- =========================================================

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
-- COMPLAINTS
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
-- VIEW
-- =========================================================

CREATE VIEW v_housing_groups_with_size AS
SELECT
    hg.*,
    (
        SELECT COUNT(*)
        FROM students s
        WHERE s.group_id = hg.id
    ) AS group_size
FROM housing_groups hg;

-- =========================================================
-- INDEXES
-- =========================================================

CREATE INDEX idx_students_individual_rank
ON students(individual_rank);

CREATE INDEX idx_groups_batch_id
ON housing_groups(batch_id);

CREATE INDEX idx_groups_group_rank
ON housing_groups(group_rank);

CREATE INDEX idx_rooms_occupancy
ON rooms(max_capacity, current_occupancy);

CREATE INDEX idx_visit_logs_student_id
ON visit_logs(student_id);

CREATE INDEX idx_visit_logs_outpass_id
ON visit_logs(outpass_id);

CREATE UNIQUE INDEX idx_unique_active_assignment
ON room_assignments(student_id)
WHERE assignment_status = 'ACTIVE';

CREATE UNIQUE INDEX idx_unique_upcoming_assignment
ON room_assignments(student_id)
WHERE assignment_status = 'UPCOMING';

CREATE UNIQUE INDEX idx_unique_active_request
ON group_requests(group_id, student_id)
WHERE status IN ('PENDING', 'ACCEPTED');