-- =========================================================
-- EXTENSIONS TO BASE SCHEMA
-- Run AFTER db.sql from roomallocation/db/db.sql
-- Do NOT modify db.sql directly.
-- =========================================================

-- ---------------------------------------------------------
-- 1. Extend admins authority_level to include 4 (guard)
--    Lower number = higher authority:
--    1 = Warden/Super Admin
--    2 = MMCA / Office Admin
--    3 = Attendant
--    4 = Guard
-- ---------------------------------------------------------

ALTER TABLE admins
    DROP CONSTRAINT IF EXISTS admins_authority_level_check;

ALTER TABLE admins
    ADD CONSTRAINT admins_authority_level_check
    CHECK (authority_level IN (1, 2, 3, 4));

-- ---------------------------------------------------------
-- 2. Extra columns for complaints table
--    Base schema has: id, student_id, description, image_url,
--                     category, status, created_at, updated_at
--    We add the legacy + important fields:
-- ---------------------------------------------------------

ALTER TABLE complaints
    ADD COLUMN IF NOT EXISTS title VARCHAR(255) NOT NULL DEFAULT 'Untitled',
    ADD COLUMN IF NOT EXISTS hostel_id UUID
        REFERENCES hostels(id)
        ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS resolved_by INTEGER
        REFERENCES admins(id)
        ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP NULL,
    ADD COLUMN IF NOT EXISTS resolved_description TEXT NULL,
    ADD COLUMN IF NOT EXISTS upvotes INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------
-- 3. Extra columns for outpasses table
--    Base schema has: id, student_id, outpass_type,
--                     place_of_visit, purpose, application_date,
--                     departure_datetime, arrival_datetime,
--                     parent_contact, is_active, outp_status,
--                     std_status, created_at, updated_at
--    We add hostel and room references:
-- ---------------------------------------------------------

ALTER TABLE outpasses
    ADD COLUMN IF NOT EXISTS hostel_id UUID
        REFERENCES hostels(id)
        ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS room_id UUID
        REFERENCES rooms(id)
        ON DELETE SET NULL;
