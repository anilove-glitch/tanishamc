CREATE TABLE student (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    hostel VARCHAR(255) NOT NULL,
    room VARCHAR(255) NOT NULL,
    phone VARCHAR(255) NOT NULL,
    department VARCHAR(255) NOT NULL
);

CREATE TABLE attendent (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(255) NOT NULL,
    hostel VARCHAR(255) NOT NULL
    approved_by boolean default false
);

CREATE TABLE guard (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(255) NOT NULL,
    approved_by boolean default false
);

CREATE TABLE complaint (
    id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES student(id),
    description TEXT NOT NULL,
    hostel VARCHAR(255) NOT NULL,
    status VARCHAR(255) NOT NULL DEFAULT 'pending',
    date_created TIMESTAMP DEFAULT current_timestamp,
    resolved_by INT NULL REFERENCES attendent(id),
    resolved_at TIMESTAMP NULL,
    resolved_description TEXT NULL,
    upvotes INT DEFAULT 0
);

CREATE TABLE outpass (
    id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES student(id),
    reason TEXT NOT NULL,
    outpass_type VARCHAR(255) NOT NULL,
    destination VARCHAR(255) NOT NULL,
    date_from DATE NOT NULL,
    date_to DATE NOT NULL,
    status VARCHAR(255) NOT NULL DEFAULT 'pending',
    date_created TIMESTAMP DEFAULT current_timestamp,
    approved_by INT NULL REFERENCES attendent(id),
    approved_at TIMESTAMP NULL,
    hostel VARCHAR(255) NOT NULL,
    room VARCHAR(255) NOT NULL,
    exit_guard_id INT NULL REFERENCES guard(id),
    gate VARCHAR(255) NULL,
    is_exited BOOLEAN DEFAULT false,
    is_entered BOOLEAN DEFAULT false,
    exit_time TIMESTAMP NULL,
    enter_time TIMESTAMP NULL
);