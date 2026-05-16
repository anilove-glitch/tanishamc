import pool from '../../db/pool.js';
import { roundAllocator } from '../engine/roundallocator.js';

import { SYSTEM_PHASES } from '../constants/phases.js';
import { GROUP_STATUS } from '../constants/statuses.js';

// Engine stubs (to be implemented later)
const rolloverEvaluator = {
    evaluate: async (batchId) => {
        console.warn('rolloverEvaluator.evaluate not implemented');
        return { success: true, message: 'Stubbed' };
    }
};

const ghostPenalty = {
    execute: async (batchId) => {
        console.warn('ghostPenalty.execute not implemented');
        return { success: true, message: 'Stubbed' };
    }
};

const shatterProtocol = {
    evaluate: async (groupId) => {
        console.warn('shatterProtocol.evaluate not implemented');
        return { success: true, message: 'Stubbed' };
    }
};

const finalSweep = {
    execute: async (hostelId) => {
        console.warn('finalSweep.execute not implemented');
        return { success: true, message: 'Stubbed' };
    }
};

class AllocationService {

    // =====================================================
    // 1. SUBMIT PREFERENCES
    // =====================================================

    async submitPreferences({
        groupId,
        submittedBy,
        hostelId,
        batchNumber,
        roundNumber,
        preferences,
    }) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // ---------------------------------------------
            // Validate group — any member can submit
            // ---------------------------------------------
            const groupRes = await client.query(`
                SELECT hg.*,
                       (SELECT COUNT(*) FROM students s WHERE s.group_id = hg.id) as group_size
                FROM housing_groups hg
                WHERE hg.id = $1
            `, [groupId]);

            if (groupRes.rowCount === 0) {
                throw new Error('Group not found');
            }

            const group = groupRes.rows[0];

            // Verify submitter belongs to this group
            const memberRes = await client.query(
                'SELECT 1 FROM students WHERE id = $1 AND group_id = $2',
                [submittedBy, groupId]
            );
            if (memberRes.rowCount === 0) {
                throw new Error('Submitter is not a member of this group');
            }

            // ---------------------------------------------
            // Validate status
            // ---------------------------------------------
            if (
                group.status !== GROUP_STATUS.SOFT_LOCKED &&
                group.status !== GROUP_STATUS.HARD_LOCKED
            ) {
                throw new Error('Group is not eligible for allocation');
            }

            // ---------------------------------------------
            // Validate batch — look up by hostel_id + batch_number (unique)
            // ---------------------------------------------
            const batchRes = await client.query(
                'SELECT id, hostel_id, start_time, end_time FROM batches WHERE hostel_id = $1 AND batch_number = $2',
                [hostelId, batchNumber]
            );
            if (batchRes.rowCount === 0) {
                throw new Error('Batch not found');
            }

            const batch = batchRes.rows[0];
            const resolvedBatchId = batch.id;
            const now = new Date();

            if (now < new Date(batch.start_time) || now > new Date(batch.end_time)) {
                throw new Error('Batch inactive');
            }

            // ---------------------------------------------
            // Validate preference count against available rooms
            // ---------------------------------------------
            const availableRoomsRes = await client.query(
                'SELECT COUNT(*) as cnt FROM rooms WHERE hostel_id = $1 AND current_occupancy < max_capacity',
                [batch.hostel_id]
            );
            const availableCount = parseInt(availableRoomsRes.rows[0].cnt, 10);
            const maxPreferences = Math.min(availableCount, 10);

            if (!Array.isArray(preferences) || preferences.length === 0) {
                throw new Error('At least one preference is required');
            }
            if (availableCount >= 10 && preferences.length !== 10) {
                throw new Error('Exactly 10 preferences required when 10 or more rooms are available');
            }
            if (preferences.length > maxPreferences) {
                throw new Error(`Cannot submit more preferences than available rooms (${availableCount})`);
            }



            // ---------------------------------------------
            // Get effective leader rank (always from the group's primary applicant)
            // ---------------------------------------------
            const leaderRes = await client.query(
                'SELECT individual_rank FROM students WHERE id = $1',
                [group.primary_applicant_id]
            );
            const effectiveLeaderRank = leaderRes.rows[0]?.individual_rank;

            // ---------------------------------------------
            // Create submission
            // ---------------------------------------------
            const insertSubRes = await client.query(`
                INSERT INTO allocation_submissions (
                    group_id, submitted_by, batch_id, round_number,
                    effective_group_rank, effective_leader_rank, effective_group_size
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (group_id, batch_id, round_number) DO NOTHING
                RETURNING id
            `, [
                groupId,
                submittedBy,
                resolvedBatchId,
                roundNumber,
                group.group_rank,
                effectiveLeaderRank,
                group.group_size
            ]);

            // If another member already submitted this round, silently accept
            if (insertSubRes.rowCount === 0) {
                await client.query('ROLLBACK');
                return { success: true, alreadySubmitted: true };
            }

            const submissionId = insertSubRes.rows[0].id;

            // ---------------------------------------------
            // Insert preferences
            // ---------------------------------------------
            const prefValues = [];
            let valueIndex = 1;
            const queryParams = [];

            for (let i = 0; i < preferences.length; i++) {
                const roomId = preferences[i];
                prefValues.push(`($${valueIndex}, $${valueIndex + 1}, $${valueIndex + 2})`);
                queryParams.push(submissionId, roomId, i + 1);
                valueIndex += 3;
            }

            const insertPrefQuery = `
                INSERT INTO submission_preferences (submission_id, room_id, preference_order)
                VALUES ${prefValues.join(', ')}
            `;

            await client.query(insertPrefQuery, queryParams);

            await client.query('COMMIT');
            return {
                success: true,
                submissionId: submissionId,
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    // =====================================================
    // 2. EXECUTE ROUND
    // =====================================================

    async executeBatchRound(batchId, roundNumber) {
        // Fetch active submissions
        const submissionsRes = await pool.query(`
            SELECT * FROM allocation_submissions
            WHERE batch_id = $1 AND round_number = $2 AND is_processed = false
            ORDER BY effective_group_rank ASC
        `, [batchId, roundNumber]);

        const submissions = submissionsRes.rows;

        if (submissions.length > 0) {
            // Fetch all preferences for these submissions
            const submissionIds = submissions.map(s => s.id);
            const prefRes = await pool.query(`
                SELECT * FROM submission_preferences
                WHERE submission_id = ANY($1::uuid[])
                ORDER BY preference_order ASC
            `, [submissionIds]);

            // Group preferences by submission_id
            const prefsBySub = {};
            for (const pref of prefRes.rows) {
                if (!prefsBySub[pref.submission_id]) {
                    prefsBySub[pref.submission_id] = [];
                }
                prefsBySub[pref.submission_id].push(pref);
            }

            // Attach to submissions
            for (const sub of submissions) {
                sub.preferences = prefsBySub[sub.id] || [];
            }
        }

        // Execute allocator engine
        if (roundAllocator && typeof roundAllocator.processRound === 'function') {
            const result = await roundAllocator.processRound({
                batchId,
                roundNumber,
                submissions,
            });
            return result;
        } else {
            console.warn('roundAllocator.processRound is not fully implemented yet.');
            return { success: true, processedCount: submissions.length, message: "Engine stubbed" };
        }
    }

    // =====================================================
    // 3. LIVE ROOM MAP
    // =====================================================

    async getLiveRoomMap(hostelId) {
        const roomsRes = await pool.query(`
            SELECT id, 
                   room_number, 
                   max_capacity, 
                   current_occupancy,
                   (max_capacity - current_occupancy) as remaining_beds,
                   (current_occupancy < max_capacity) as available
            FROM rooms
            WHERE hostel_id = $1
            ORDER BY room_number ASC
        `, [hostelId]);

        return roomsRes.rows.map(room => ({
            id: room.id,
            roomNumber: room.room_number,
            capacity: room.max_capacity,
            occupancy: room.current_occupancy,
            remainingBeds: room.remaining_beds,
            available: room.available,
        }));
    }

    // =====================================================
    // 4. GET ALLOCATION STATUS
    // =====================================================

    async getAllocationStatus(studentId) {
        const studentRes = await pool.query(`
            SELECT s.*, hg.status as group_status, hg.batch_id
            FROM students s
            LEFT JOIN housing_groups hg ON s.group_id = hg.id
            WHERE s.id = $1
        `, [studentId]);

        if (studentRes.rowCount === 0) {
            throw new Error('Student not found');
        }

        const student = studentRes.rows[0];

        const assignmentRes = await pool.query(`
            SELECT ra.*, row_to_json(r.*) as room
            FROM room_assignments ra
            JOIN rooms r ON ra.room_id = r.id
            WHERE ra.student_id = $1 AND ra.assignment_status IN ('UPCOMING', 'ACTIVE')
            LIMIT 1
        `, [studentId]);

        const assignment = assignmentRes.rowCount > 0 ? assignmentRes.rows[0] : null;

        return {
            studentId,
            allotted: !!assignment,
            room: assignment ? assignment.room : null,
            groupStatus: student.group_status,
            batchId: student.batch_id,
        };
    }

    // =====================================================
    // 5. TRIGGER ROLLOVER
    // =====================================================

    async triggerRolloverEvaluation(batchId) {
        return await rolloverEvaluator.evaluate(batchId);
    }

    // =====================================================
    // 6. TRIGGER GHOST PENALTY
    // =====================================================

    async triggerGhostPenalty(batchId) {
        return await ghostPenalty.execute(batchId);
    }

    // =====================================================
    // 7. SHATTER CHECK
    // =====================================================

    async triggerShatterProtocol(groupId) {
        return await shatterProtocol.evaluate(groupId);
    }

    // =====================================================
    // 8. FINAL SWEEP
    // =====================================================

    async runFinalSweep(hostelId) {
        return await finalSweep.execute(hostelId);
    }

    // =====================================================
    // 9. FORCE ASSIGNMENT
    // =====================================================

    async forceAssignRoom({
        studentId,
        roomId,
    }) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const roomRes = await client.query('SELECT max_capacity, current_occupancy FROM rooms WHERE id = $1 FOR UPDATE', [roomId]);
            if (roomRes.rowCount === 0) {
                throw new Error('Room not found');
            }

            const room = roomRes.rows[0];
            if (room.current_occupancy >= room.max_capacity) {
                throw new Error('Room already full');
            }

            // Using direct INSERT. Database triggers handle student status and room occupancy.
            await client.query(`
                INSERT INTO room_assignments (room_id, student_id, assigned_by, assignment_status)
                VALUES ($1, $2, 'ADMIN', 'ACTIVE')
            `, [roomId, studentId]);

            await client.query('COMMIT');

            return {
                success: true,
                message: 'Room assigned successfully',
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    // =====================================================
    // 10. GET BATCH RESULTS
    // =====================================================

    async getBatchResults(batchId) {
        const submissionsRes = await pool.query(`
            SELECT asb.*, row_to_json(hg.*) as group
            FROM allocation_submissions asb
            LEFT JOIN housing_groups hg ON asb.group_id = hg.id
            WHERE asb.batch_id = $1
        `, [batchId]);

        return submissionsRes.rows.map(sub => ({
            groupId: sub.group_id,
            round: sub.round_number,
            result: sub.allocation_result,
            processed: sub.is_processed,
            group: sub.group
        }));
    }

    // =====================================================
    // 11. GET CURRENT ROUND
    // =====================================================

    async getCurrentRound(batchId) {
        const batchRes = await pool.query('SELECT start_time FROM batches WHERE id = $1', [batchId]);

        if (batchRes.rowCount === 0) {
            throw new Error('Batch not found');
        }

        const batch = batchRes.rows[0];
        const now = new Date();
        const startTime = new Date(batch.start_time);

        const diffMs = now.getTime() - startTime.getTime();
        const round = Math.floor(diffMs / (10 * 60 * 1000)) + 1;

        return Math.min(Math.max(round, 1), 6);
    }

    // =====================================================
    // 12. GET ACTIVE BATCH
    // =====================================================

    async getActiveBatch(hostelId) {
        const batchRes = await pool.query(`
            SELECT * FROM batches
            WHERE hostel_id = $1 AND status = 'ACTIVE'
            ORDER BY start_time ASC
            LIMIT 1
        `, [hostelId]);

        return batchRes.rowCount > 0 ? batchRes.rows[0] : null;
    }

    // =====================================================
    // 13. VALIDATE PHASE
    // =====================================================

    async validateAllocationPhase(hostelId) {
        const hostelRes = await pool.query('SELECT is_paused, current_phase FROM hostels WHERE id = $1', [hostelId]);

        if (hostelRes.rowCount === 0) {
            throw new Error('Hostel not found');
        }

        const hostel = hostelRes.rows[0];

        if (hostel.is_paused) {
            throw new Error('Allocation system paused');
        }

        if (hostel.current_phase !== SYSTEM_PHASES.LIVE_BATCHES) {
            throw new Error('Allocation phase inactive');
        }

        return true;
    }
}

export const allocationService = new AllocationService();
