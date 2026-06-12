import pool from '../../db/pool.js';

// Constant to determine what qualifies as Home State
const HOME_STATE_NAME = 'Himachal Pradesh';

/**
 * Gets the current 1st-year enrollment prefix based on the current year
 * or an environment variable override for testing (e.g. TEST_YEAR_PREFIX='22').
 */
export const getFirstYearPrefix = () => {
    if (process.env.TEST_YEAR_PREFIX) {
        return process.env.TEST_YEAR_PREFIX;
    }
    return new Date().getFullYear().toString().slice(-2);
};

/**
 * Fetches the count of unassigned 1st-year students grouped by State (Home vs Other) and Department.
 * 
 * @param {string} hostelId 
 * @returns {Promise<Array>} Array of groups with their counts
 */
export const getUnassignedStudentPoolStats = async (hostelId) => {
    const yearPrefix = getFirstYearPrefix();
    
    // Using a Postgres CASE statement to classify states as HOME_STATE or OTHER_STATE
    const query = `
        SELECT 
            CASE 
                WHEN state = $1 OR state = 'HOME_STATE' THEN 'HOME_STATE'
                ELSE 'OTHER_STATE'
            END as state_category,
            department as branch,
            COUNT(*) as count
        FROM student
        WHERE 
            hostel_id = $2 
            AND is_allotted = FALSE 
        GROUP BY state_category, department
        ORDER BY state_category, branch
    `;

    const result = await pool.query(query, [HOME_STATE_NAME, hostelId]);
    return result.rows.map(row => ({
        state: row.state_category,
        branch: row.branch,
        count: parseInt(row.count, 10)
    }));
};

/**
 * Fetches available empty rooms in the given hostel.
 * 
 * @param {string} hostelId 
 * @returns {Promise<Array>} Array of available rooms grouped by capacity
 */
export const getAvailableRoomsStats = async (hostelId) => {
    const query = `
        SELECT 
            max_capacity as capacity,
            COUNT(*) as count
        FROM room
        WHERE hostel_id = $1 AND current_occupancy = 0
        GROUP BY max_capacity
        ORDER BY max_capacity
    `;

    const result = await pool.query(query, [hostelId]);
    return result.rows.map(row => ({
        capacity: parseInt(row.capacity, 10),
        count: parseInt(row.count, 10)
    }));
};

/**
 * Fetch exactly all unassigned 1st-year students.
 * Used internally by the constraint matcher.
 */
export const getUnassignedFirstYearStudents = async (hostelId) => {
    const yearPrefix = getFirstYearPrefix();
    
    const query = `
        SELECT 
            id,
            roll_no,
            department as branch,
            CASE 
                WHEN state = $1 OR state = 'HOME_STATE' THEN 'HOME_STATE'
                ELSE 'OTHER_STATE'
            END as state_category
        FROM student
        WHERE 
            hostel_id = $2 
            AND is_allotted = FALSE 
        ORDER BY individual_rank ASC
    `;

    const result = await pool.query(query, [HOME_STATE_NAME, hostelId]);
    return result.rows;
};
