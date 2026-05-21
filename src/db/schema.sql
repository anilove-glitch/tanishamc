CREATE EXTENSION IF NOT EXISTS "uuid-ossp";



-- =========================================================
-- HOSTELS
-- =========================================================

CREATE TABLE hostel (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    name VARCHAR(255) UNIQUE NOT NULL,

    type VARCHAR(100),

    total_capacity INT DEFAULT 0,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);



-- =========================================================
-- STUDENT
-- =========================================================

CREATE TABLE student (
    id SERIAL PRIMARY KEY,

    name VARCHAR(255) NOT NULL,

    email VARCHAR(255) UNIQUE NOT NULL,

    password VARCHAR(255) NOT NULL,

    hostel VARCHAR(255) NOT NULL,

    hostel_id UUID NOT NULL
    REFERENCES hostel(id)
    ON DELETE CASCADE,

    room VARCHAR(255) NOT NULL,

    roll_no VARCHAR(100) UNIQUE,

    phone VARCHAR(255),

    department VARCHAR(255) NOT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);



-- =========================================================
-- ATTENDENT
-- =========================================================

CREATE TABLE attendent (
    id SERIAL PRIMARY KEY,

    email VARCHAR(255) UNIQUE NOT NULL,

    password VARCHAR(255) NOT NULL,

    name VARCHAR(255) NOT NULL,

    phone VARCHAR(255) NOT NULL,

    hostel VARCHAR(255) NOT NULL,

    hostel_id UUID NOT NULL
    REFERENCES hostel(id)
    ON DELETE CASCADE,

    approved_by BOOLEAN DEFAULT false,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);



-- =========================================================
-- GUARD
-- =========================================================

CREATE TABLE guard (
    id SERIAL PRIMARY KEY,

    email VARCHAR(255) UNIQUE NOT NULL,

    password VARCHAR(255) NOT NULL,

    name VARCHAR(255) NOT NULL,

    phone VARCHAR(255) NOT NULL,

    approved_by BOOLEAN DEFAULT false,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);



-- =========================================================
-- COMPLAINT
-- =========================================================

CREATE TABLE complaint (
    id SERIAL PRIMARY KEY,

    student_id INTEGER NOT NULL
    REFERENCES student(id)
    ON DELETE CASCADE,

    title VARCHAR(255)
    NOT NULL
    DEFAULT 'Untitled',

    description TEXT NOT NULL,

    hostel VARCHAR(255) NOT NULL,

    status VARCHAR(255)
    NOT NULL
    DEFAULT 'pending'
    CHECK (
        status IN (
            'pending',
            'in_progress',
            'resolved'
        )
    ),

    date_created TIMESTAMP
    DEFAULT CURRENT_TIMESTAMP,

    resolved_by INTEGER NULL
    REFERENCES attendent(id)
    ON DELETE SET NULL,

    resolved_at TIMESTAMP NULL,

    resolved_description TEXT NULL,

    upvotes INTEGER DEFAULT 0
);



-- =========================================================
-- OUTPASS
-- =========================================================

CREATE TABLE outpass (
    id SERIAL PRIMARY KEY,

    student_id INTEGER NOT NULL
    REFERENCES student(id)
    ON DELETE CASCADE,

    outpass_type VARCHAR(50)
    NOT NULL
    CHECK (
        outpass_type IN (
            'Local',
            'Outstation'
        )
    ),

    place_of_visit VARCHAR(255),

    purpose TEXT,

    departure_datetime TIMESTAMP,

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
        std_status IN (
            'In',
            'Out'
        )
    ),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    approved_at TIMESTAMP,

    approved_by INTEGER
    REFERENCES attendent(id)
    ON DELETE SET NULL
);



-- =========================================================
-- VISIT LOG
-- =========================================================

CREATE TABLE visit_log (
    id SERIAL PRIMARY KEY,

    outpass_id INTEGER NOT NULL
    REFERENCES outpass(id)
    ON DELETE CASCADE,

    student_id INTEGER NOT NULL
    REFERENCES student(id)
    ON DELETE CASCADE,

    actual_departure TIMESTAMP
    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    actual_arrival TIMESTAMP,

    remarks TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    gate VARCHAR(100),

    exit_guard_id INTEGER
    REFERENCES guard(id)
    ON DELETE SET NULL
);



-- =========================================================
-- INDEXES
-- =========================================================

CREATE INDEX idx_student_hostel
ON student(hostel_id);

CREATE INDEX idx_outpass_student
ON outpass(student_id);

CREATE INDEX idx_outpass_status
ON outpass(outp_status);

CREATE INDEX idx_visit_log_student
ON visit_log(student_id);

CREATE INDEX idx_visit_log_outpass
ON visit_log(outpass_id);

CREATE INDEX idx_complaint_student
ON complaint(student_id);

CREATE INDEX idx_complaint_status
ON complaint(status);