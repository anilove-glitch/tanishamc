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
        const studentRes = await client.query(`SELECT group_id FROM student WHERE id = $1`, [primaryApplicantId]);
        if (studentRes.rows.length === 0) throw new ApiError(404, 'Student not found');
        if (studentRes.rows[0].group_id) throw new ApiError(400, 'Student is already in a group');

        // Create group
        const groupRes = await client.query(
            `INSERT INTO housing_group (primary_applicant_id, status) VALUES ($1, 'FORMING') RETURNING *`,
            [primaryApplicantId]
        );
        const group = groupRes.rows[0];

        // Update student
        await client.query(
            `UPDATE student SET group_id = $1 WHERE id = $2`,
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
             FROM student WHERE group_id = $1`,
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
        const studentRes = await pool.query(`SELECT group_id FROM student WHERE id = $1`, [studentId]);
        if (studentRes.rows.length === 0) throw new ApiError(404, 'Student not found');
        if (studentRes.rows[0].group_id) throw new ApiError(400, 'Student is already in a group');

        // Check if group exists and is FORMING
        const groupRes = await pool.query(`SELECT status FROM housing_group WHERE id = $1`, [groupId]);
        if (groupRes.rows.length === 0) throw new ApiError(404, 'Group not found');
        if (groupRes.rows[0].status !== 'FORMING') throw new ApiError(400, 'Group is not accepting members');

        // Check for existing pending request
        const existingReq = await pool.query(
            `SELECT id FROM group_request WHERE group_id = $1 AND student_id = $2 AND status = 'PENDING'`,
            [groupId, studentId]
        );
        if (existingReq.rows.length > 0) throw new ApiError(400, 'A pending request already exists between this group and student');

        const result = await pool.query(
            `INSERT INTO group_request (group_id, student_id, request_type, status) 
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
        const reqRes = await client.query(`SELECT * FROM group_request WHERE id = $1 FOR UPDATE`, [requestId]);
        if (reqRes.rows.length === 0) throw new ApiError(404, 'Request not found');
        const request = reqRes.rows[0];

        if (request.status !== 'PENDING') throw new ApiError(400, 'Request is no longer pending');

        // Update request status
        const updateRes = await client.query(
            `UPDATE group_request SET status = $1 WHERE id = $2 RETURNING *`,
            [status, requestId]
        );

        // If accepted, add student to group
        if (status === 'ACCEPTED') {
            // Verify group status — Phase 2 top-up gate
            const groupRes = await client.query(
                `SELECT hg.status,
                        (SELECT COUNT(*) FROM student s WHERE s.group_id = hg.id) AS member_count
                 FROM housing_group hg
                 WHERE hg.id = $1`,
                [request.group_id]
            );
            const group = groupRes.rows[0];

            if (!group) throw new ApiError(404, 'Group not found');

            if (group.status === 'HARD_LOCKED' || group.status === 'ALLOCATED') {
                throw new ApiError(400,
                    `Cannot accept new members: group is ${group.status}. ` +
                    'The batch has started — no more members allowed.'
                );
            }

            // During SOFT_LOCK: accept is fine as long as group has space (< 4)
            if (group.status === 'SOFT_LOCKED' && parseInt(group.member_count, 10) >= 4) {
                throw new ApiError(400, 'Group is already full (4 members max)');
            }

            // Re-verify student isn't in a group (race condition check)
            const studentCheck = await client.query(`SELECT group_id FROM student WHERE id = $1`, [request.student_id]);
            if (studentCheck.rows[0].group_id) {
                await client.query(`UPDATE group_request SET status = 'CANCELED' WHERE id = $1`, [requestId]);
                throw new ApiError(400, 'Student joined another group. Request auto-canceled.');
            }

            // Note: The check_group_capacity trigger in DB will throw if group is full (>=4)
            await client.query(
                `UPDATE student SET group_id = $1 WHERE id = $2`,
                [request.group_id, request.student_id]
            );

            // Auto-cancel other PENDING requests for this student
            await client.query(
                `UPDATE group_request
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
            `SELECT id, group_id FROM student WHERE id = $1 FOR UPDATE`,
            [studentId]
        );
        if (studentRes.rows.length === 0) throw new ApiError(404, 'Student not found');
        const student = studentRes.rows[0];
        if (!student.group_id) throw new ApiError(400, 'Student is not in any group');

        // 2. Verify group exists and is in a mutable state
        const groupRes = await client.query(
            `SELECT id, status FROM housing_group WHERE id = $1`,
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
            `UPDATE student SET group_id = NULL WHERE id = $1`,
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
            `UPDATE housing_group SET status = $1 WHERE id = $2 RETURNING *`,
            [status, groupId]
        );
        if (result.rows.length === 0) throw new ApiError(404, 'Group not found');
        return result.rows[0];
    } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, 'Error updating group status: ' + error.message);
    }
};

/**
 * Get all group requests (admin / debug view)
 */
export const getAllRequests = async () => {
    try {
        const result = await pool.query(
            `SELECT * FROM group_request ORDER BY created_at DESC`
        );
        return result.rows;
    } catch (error) {
        throw new ApiError(500, 'Error fetching group requests: ' + error.message);
    }
};

/**
 * Get all housing groups (admin / debug view)
 */
export const getAllGroups = async () => {
    try {
        const result = await pool.query(
            `SELECT * FROM v_housing_groups_with_size ORDER BY id`
        );
        return result.rows;
    } catch (error) {
        throw new ApiError(500, 'Error fetching groups: ' + error.message);
    }
};

/**
 * Get group details with its members list
 */
export const getGroupMembers = async (groupId) => {
    try {
        const groupRes = await pool.query(
            `SELECT * FROM v_housing_groups_with_size WHERE id = $1`,
            [groupId]
        );
        if (groupRes.rows.length === 0) throw new ApiError(404, 'Group not found');

        const membersRes = await pool.query(
            `SELECT id, name, roll_no, email, individual_rank
             FROM student
             WHERE group_id = $1
             ORDER BY individual_rank ASC`,
            [groupId]
        );

        return {
            group: groupRes.rows[0],
            members: membersRes.rows,
        };
    } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, 'Error fetching group members: ' + error.message);
    }
};

/**
 * Transfer leadership to another group member
 */
export const transferLeadership = async (groupId, newLeaderId) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Verify group exists and is in a mutable state
        const groupRes = await client.query(
            `SELECT id, status FROM housing_group WHERE id = $1`,
            [groupId]
        );
        if (groupRes.rows.length === 0) throw new ApiError(404, 'Group not found');

        const FROZEN_STATES = ['SOFT_LOCKED', 'HARD_LOCKED', 'ALLOCATED'];
        if (FROZEN_STATES.includes(groupRes.rows[0].status)) {
            throw new ApiError(400,
                `Cannot transfer leadership — group is ${groupRes.rows[0].status}. ` +
                'Leader titles are frozen after the Soft Lock.'
            );
        }

        // Verify new leader is a member of this group
        const memberRes = await client.query(
            `SELECT id FROM student WHERE id = $1 AND group_id = $2`,
            [newLeaderId, groupId]
        );
        if (memberRes.rows.length === 0) {
            throw new ApiError(400, 'New leader must be a member of the group');
        }

        const updated = await client.query(
            `UPDATE housing_group SET primary_applicant_id = $1 WHERE id = $2 RETURNING *`,
            [newLeaderId, groupId]
        );

        await client.query('COMMIT');
        return updated.rows[0];
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, 'Error transferring leadership: ' + error.message);
    } finally {
        client.release();
    }
};
