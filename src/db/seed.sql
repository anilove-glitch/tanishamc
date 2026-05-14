-- =========================================================
-- LARGE TEST DATA SEED
-- =========================================================

-- =========================================================
-- HOSTELS
-- =========================================================

INSERT INTO hostels (name, type, total_capacity)
VALUES
('Boys Hostel A', 'Boys', 500),
('Boys Hostel B', 'Boys', 450),
('Girls Hostel A', 'Girls', 400);

-- =========================================================
-- ROOMS
-- =========================================================

INSERT INTO rooms (
    hostel_id,
    room_number,
    room_type,
    max_capacity
)
SELECT
    h.id,
    room.room_number,
    room.room_type,
    room.max_capacity
FROM hostels h
CROSS JOIN (
    VALUES
    ('A-101', '4 Sharing', 4),
    ('A-102', '4 Sharing', 4),
    ('A-103', '3 Sharing', 3),
    ('B-201', '4 Sharing', 4),
    ('B-202', '3 Sharing', 3)
) AS room(room_number, room_type, max_capacity);

-- =========================================================
-- ADMINS
-- =========================================================

INSERT INTO admins (
    name,
    email,
    password_hash,
    authority_level
)
VALUES
('MMCA Admin', 'mmca@hostel.com', 'hashedpassword', 1),
('Chief Admin', 'chief@hostel.com', 'hashedpassword', 2),
('Super Admin', 'super@hostel.com', 'hashedpassword', 3);

-- =========================================================
-- STUDENTS
-- =========================================================

INSERT INTO students (
    name,
    father_name,
    roll_no,
    department,
    semester,
    email,
    password_hash,
    student_number,
    parent_number,
    category,
    blood_group,
    state,
    address,
    pincode,
    cgpa,
    individual_rank
)
VALUES
('Rahul Sharma', 'Ramesh Sharma', '24BCS001', 'CSE', 4, 'rahul@example.com', 'hashedpassword', '9876543201', '9999999901', 'GEN', 'B+', 'HP', 'Hamirpur', '177001', 8.45, 1),

('Aman Verma', 'Suresh Verma', '24BCS002', 'CSE', 4, 'aman@example.com', 'hashedpassword', '9876543202', '9999999902', 'OBC', 'A+', 'Punjab', 'Ludhiana', '141001', 8.10, 2),

('Priya Thakur', 'Mahesh Thakur', '24BEC003', 'ECE', 2, 'priya@example.com', 'hashedpassword', '9876543203', '9999999903', 'GEN', 'O+', 'HP', 'Shimla', '171001', 9.12, 3),

('Neha Kapoor', 'Raj Kapoor', '24BME004', 'Mechanical', 6, 'neha@example.com', 'hashedpassword', '9876543204', '9999999904', 'SC', 'AB+', 'Delhi', 'Delhi', '110001', 7.80, 4),

('Arjun Singh', 'Kuldeep Singh', '24BCS005', 'CSE', 8, 'arjun@example.com', 'hashedpassword', '9876543205', '9999999905', 'GEN', 'B-', 'UP', 'Lucknow', '226001', 8.91, 5),

('Simran Kaur', 'Harjit Kaur', '24BCE006', 'Civil', 4, 'simran@example.com', 'hashedpassword', '9876543206', '9999999906', 'OBC', 'A-', 'Punjab', 'Amritsar', '143001', 8.00, 6),

('Vikas Rana', 'Om Rana', '24BEE007', 'Electrical', 2, 'vikas@example.com', 'hashedpassword', '9876543207', '9999999907', 'GEN', 'O-', 'HP', 'Mandi', '175001', 7.65, 7),

('Sneha Joshi', 'Ajay Joshi', '24BCS008', 'CSE', 4, 'sneha@example.com', 'hashedpassword', '9876543208', '9999999908', 'GEN', 'B+', 'Uttarakhand', 'Dehradun', '248001', 9.01, 8),

('Rohit Mehta', 'Sunil Mehta', '24BME009', 'Mechanical', 6, 'rohit@example.com', 'hashedpassword', '9876543209', '9999999909', 'SC', 'A+', 'Delhi', 'Delhi', '110002', 7.40, 9),

('Karan Malhotra', 'Vinod Malhotra', '24BCS010', 'CSE', 8, 'karan@example.com', 'hashedpassword', '9876543210', '9999999910', 'GEN', 'AB+', 'Punjab', 'Chandigarh', '160001', 8.73, 10);

-- =========================================================
-- OUTPASSES
-- =========================================================

INSERT INTO outpasses (
    student_id,
    outpass_type,
    place_of_visit,
    purpose,
    departure_datetime,
    arrival_datetime,
    parent_contact,
    outp_status,
    std_status
)
VALUES
(1, 'Local', 'Hamirpur Market', 'Shopping', NOW(), NOW() + INTERVAL '5 hours', '9999999901', 'Approved', 'In'),

(2, 'Outstation', 'Chandigarh', 'Family Visit', NOW(), NOW() + INTERVAL '2 days', '9999999902', 'Pending', 'In'),

(3, 'Local', 'Library', 'Study Material', NOW(), NOW() + INTERVAL '3 hours', '9999999903', 'Approved', 'Out'),

(4, 'Outstation', 'Delhi', 'Medical', NOW(), NOW() + INTERVAL '1 day', '9999999904', 'Rejected', 'In'),

(5, 'Local', 'Bus Stand', 'Travel', NOW(), NOW() + INTERVAL '2 hours', '9999999905', 'Approved', 'Out'),

(6, 'Local', 'Market', 'Groceries', NOW(), NOW() + INTERVAL '4 hours', '9999999906', 'Pending', 'In'),

(7, 'Outstation', 'Shimla', 'Festival', NOW(), NOW() + INTERVAL '3 days', '9999999907', 'Approved', 'In'),

(8, 'Local', 'Cafe', 'Meet Friend', NOW(), NOW() + INTERVAL '2 hours', '9999999908', 'Approved', 'Out'),

(9, 'Outstation', 'Jaipur', 'Competition', NOW(), NOW() + INTERVAL '4 days', '9999999909', 'Pending', 'In'),

(10, 'Local', 'Sports Complex', 'Practice', NOW(), NOW() + INTERVAL '3 hours', '9999999910', 'Approved', 'In');

-- =========================================================
-- VISIT LOGS
-- =========================================================

INSERT INTO visit_logs (
    outpass_id,
    student_id,
    actual_departure,
    actual_arrival,
    remarks
)
VALUES
(1, 1, NOW() - INTERVAL '2 hours', NULL, 'Exited hostel'),

(3, 3, NOW() - INTERVAL '1 hour', NULL, 'Went to library'),

(5, 5, NOW() - INTERVAL '30 minutes', NULL, 'Travel purpose'),

(8, 8, NOW() - INTERVAL '45 minutes', NULL, 'Cafe visit');

-- =========================================================
-- COMPLAINTS
-- =========================================================

INSERT INTO complaints (
    student_id,
    description,
    image_url,
    category,
    status
)
VALUES
(1, 'Fan not working', NULL, 'Electrical', 'Pending'),

(2, 'WiFi issue in room', NULL, 'Internet', 'In Progress'),

(3, 'Water leakage in bathroom', NULL, 'Plumbing', 'Resolved'),

(4, 'Tube light fused', NULL, 'Electrical', 'Pending'),

(5, 'Bed damaged', NULL, 'Furniture', 'In Progress'),

(6, 'Mess food quality poor', NULL, 'Mess', 'Pending'),

(7, 'Window broken', NULL, 'Maintenance', 'Resolved'),

(8, 'LAN port not working', NULL, 'Internet', 'Pending'),

(9, 'Room cleaning issue', NULL, 'Cleaning', 'Pending'),

(10, 'Power socket issue', NULL, 'Electrical', 'Resolved');