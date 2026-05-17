import pool from '../../db/pool.js';
import ApiError from '../../utils/apiError.js';

/**
 * Create a new housing group
 */
export const createGroup = async (primaryApplicantId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check if student already in a group
        const studentRes = await client.query(`SELECT group_id FROM students WHERE id = $1`, [primaryApplicantId]);
        if (studentRes.rows.length === 0) throw new ApiError(404, 'Student not found');
        if (studentRes.rows[0].group_id) throw new ApiError(400, 'Student is already in a group');

        // Create group
        const groupRes = await client.query(
            `INSERT INTO housing_groups (primary_applicant_id, status) VALUES ($1, 'FORMING') RETURNING *`,
            [primaryApplicantId]
        );
        const group = groupRes.rows[0];

        // Update student
        await client.query(
            `UPDATE students SET group_id = $1 WHERE id = $2`,
            [group.id, primaryApplicantId]
        );

        await client.query('COMMIT');
        return group;
    } catch (error) {
        await client.query('ROLLBACK');
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, 'Error creating group: ' + error.message);
    } finally {
        client.release();
    }
};

/**
 * Get group details including members
 */
export const getGroupDetails = async (groupId) => {
    try {
        const groupRes = await pool.query(`SELECT * FROM v_housing_groups_with_size WHERE id = $1`, [groupId]);
        if (groupRes.rows.length === 0) throw new ApiError(404, 'Group not found');

        const membersRes = await pool.query(
            `SELECT id, name, roll_no, department, individual_rank 
             FROM students WHERE group_id = $1`,
            [groupId]
        );

        return {
            ...groupRes.rows[0],
            members: membersRes.rows
        };
    } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, 'Error fetching group details: ' + error.message);
    }
};

/**
 * Send a group request (invite or apply)
 * requestType: 'INVITE_FROM_PRIMARY' | 'APPLICATION_FROM_STUDENT'
 */
export const sendGroupRequest = async (groupId, studentId, requestType) => {
    try {
        // Check if student is already in a group
        const studentRes = await pool.query(`SELECT group_id FROM students WHERE id = $1`, [studentId]);
        if (studentRes.rows.length === 0) throw new ApiError(404, 'Student not found');
        if (studentRes.rows[0].group_id) throw new ApiError(400, 'Student is already in a group');

        // Check if group exists and is FORMING
        const groupRes = await pool.query(`SELECT status FROM housing_groups WHERE id = $1`, [groupId]);
        if (groupRes.rows.length === 0) throw new ApiError(404, 'Group not found');
        if (groupRes.rows[0].status !== 'FORMING') throw new ApiError(400, 'Group is not accepting members');

        // Check for existing pending request
        const existingReq = await pool.query(
            `SELECT id FROM group_requests WHERE group_id = $1 AND student_id = $2 AND status = 'PENDING'`,
            [groupId, studentId]
        );
        if (existingReq.rows.length > 0) throw new ApiError(400, 'A pending request already exists between this group and student');

        const result = await pool.query(
            `INSERT INTO group_requests (group_id, student_id, request_type, status) 
             VALUES ($1, $2, $3, 'PENDING') RETURNING *`,
            [groupId, studentId, requestType]
        );
        return result.rows[0];
    } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, 'Error sending group request: ' + error.message);
    }
};

/**
 * Respond to a group request
 * status: 'ACCEPTED' | 'REJECTED'
 */
export const respondToGroupRequest = async (requestId, status) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Get request details
        const reqRes = await client.query(`SELECT * FROM group_requests WHERE id = $1 FOR UPDATE`, [requestId]);
        if (reqRes.rows.length === 0) throw new ApiError(404, 'Request not found');
        const request = reqRes.rows[0];

        if (request.status !== 'PENDING') throw new ApiError(400, 'Request is no longer pending');

        // Update request status
        const updateRes = await client.query(
            `UPDATE group_requests SET status = $1 WHERE id = $2 RETURNING *`,
            [status, requestId]
        );

        // If accepted, add student to group
        if (status === 'ACCEPTED') {
            // Re-verify student isn't in a group (race condition check)
            const studentCheck = await client.query(`SELECT group_id FROM students WHERE id = $1`, [request.student_id]);
            if (studentCheck.rows[0].group_id) {
                // Auto-cancel request if student found a group elsewhere
                await client.query(`UPDATE group_requests SET status = 'CANCELED' WHERE id = $1`, [requestId]);
                throw new ApiError(400, 'Student joined another group. Request auto-canceled.');
            }

            // Note: The check_group_capacity trigger in DB will throw if group is full (>=4)
            await client.query(
                `UPDATE students SET group_id = $1 WHERE id = $2`,
                [request.group_id, request.student_id]
            );

            // Auto-cancel other PENDING requests for this student.
            // Explicitly exclude the just-accepted request and any already-accepted ones
            // to avoid cancelling a legitimately accepted request.
            await client.query(
                `UPDATE group_requests
                 SET status = 'CANCELED'
                 WHERE student_id = $1
                   AND status = 'PENDING'
                   AND id != $2`,
                [request.student_id, requestId]
            );
        }

        await client.query('COMMIT');
        return updateRes.rows[0];
    } catch (error) {
        await client.query('ROLLBACK');
        // Handle trigger exception for capacity
        if (error.message && error.message.includes('maximum capacity')) {
            throw new ApiError(400, error.message);
        }
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, 'Error responding to request: ' + error.message);
    } finally {
        client.release();
    }
};

/**
 * Leave a group
 * Explicit pre-mutation validation before relying on triggers.
 */
export const leaveGroup = async (studentId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Verify student exists and is in a group
        const studentRes = await client.query(
            `SELECT id, group_id FROM students WHERE id = $1 FOR UPDATE`,
            [studentId]
        );
        if (studentRes.rows.length === 0) throw new ApiError(404, 'Student not found');
        const student = studentRes.rows[0];
        if (!student.group_id) throw new ApiError(400, 'Student is not in any group');

        // 2. Verify group exists and is in a mutable state
        const groupRes = await client.query(
            `SELECT id, status FROM housing_groups WHERE id = $1`,
            [student.group_id]
        );
        if (groupRes.rows.length === 0) throw new ApiError(404, 'Group not found');
        const group = groupRes.rows[0];

        const LOCKED_STATES = ['SOFT_LOCKED', 'HARD_LOCKED', 'ALLOCATED'];
        if (LOCKED_STATES.includes(group.status)) {
            throw new ApiError(400, `Cannot leave group — it is currently ${group.status}`);
        }

        // 3. Perform the leave — triggers handle leader reassignment/group deletion
        await client.query(
            `UPDATE students SET group_id = NULL WHERE id = $1`,
            [studentId]
        );

        await client.query('COMMIT');
        return { success: true, message: 'Successfully left group' };
    } catch (error) {
        await client.query('ROLLBACK');
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, 'Error leaving group: ' + error.message);
    } finally {
        client.release();
    }
};

/**
 * Update group status (e.g., FORMING -> SOFT_LOCKED)
 */
export const updateGroupStatus = async (groupId, status) => {
    try {
        const result = await pool.query(
            `UPDATE housing_groups SET status = $1 WHERE id = $2 RETURNING *`,
            [status, groupId]
        );
        if (result.rows.length === 0) throw new ApiError(404, 'Group not found');
        return result.rows[0];
    } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, 'Error updating group status: ' + error.message);
    }
};
