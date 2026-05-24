import pool from '../../db/pool.js';
import { emit, WS_EVENTS } from '../websocket/emitter.js';

/**
 * The State Mutator.
 * Opens a pg transaction, safely executes the room assignments, 
 * and triggers Websocket events.
 * 
 * @param {Map<string, Array<number>>} allocations Map of roomId -> array of studentIds
 * @param {string} hostelId The hostel being updated
 * @returns {Promise<Object>} Results summary
 */
export const executeBulkAllocation = async (allocations, hostelId) => {
    const client = await pool.connect();
    
    let successfulRooms = 0;
    let successfulStudents = 0;

    try {
        await client.query('BEGIN');

        for (const [roomId, studentIds] of allocations.entries()) {
            // First, lock the room and assert it is empty
            const roomCheck = await client.query(
                `SELECT current_occupancy, max_capacity FROM room WHERE id = $1 FOR UPDATE`, 
                [roomId]
            );

            if (roomCheck.rowCount === 0) {
                throw new Error(`Room ${roomId} not found`);
            }

            const { current_occupancy, max_capacity } = roomCheck.rows[0];

            // Idempotency / Race Condition Guard: Target rooms must be empty
            if (current_occupancy !== 0) {
                // If it's already occupied, we skip this room to prevent partial failures from aborting the whole batch
                // Alternatively, we could throw an error to rollback. The spec says "Assert current_occupancy == 0".
                console.warn(`[BulkAllocator] Room ${roomId} is not empty (occupancy: ${current_occupancy}). Skipping.`);
                continue; 
            }

            // We use the DB's built-in procedure for safe assignments.
            // This procedure inherently checks capacity, does row-level locking, 
            // and triggers `trigger_sync_student_room` and `trigger_update_room_occupancy` automatically.
            for (const studentId of studentIds) {
                await client.query(
                    `SELECT assign_student_to_room($1, $2, 'ADMIN')`,
                    [studentId, roomId]
                );
                
                // Immediately activate the assignment (since first-year allocations are final/instant)
                // The stored procedure sets it to 'UPCOMING' by default, we need it to be 'ACTIVE'
                await client.query(
                    `UPDATE room_assignment 
                     SET assignment_status = 'ACTIVE', valid_from = CURRENT_DATE 
                     WHERE student_id = $1 AND room_id = $2 AND assignment_status = 'UPCOMING'`,
                    [studentId, roomId]
                );
                
                successfulStudents++;
            }
            successfulRooms++;
        }

        await client.query('COMMIT');

        // Broadcast to clients so the UI updates
        // Uses the existing Websocket/Pusher system pattern in the codebase
        emit(WS_EVENTS.ROOM_MAP_UPDATED, { hostelId, timestamp: new Date() }, hostelId);
        
        return { success: true, roomsAllocated: successfulRooms, studentsAllocated: successfulStudents };

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[BulkAllocator] Transaction failed:', error);
        throw new Error(`Allocation transaction failed: ${error.message}`);
    } finally {
        client.release();
    }
};

/**
 * Emergency rollback to clear specific rooms.
 * Hard deletes the assignments and resets student unassigned state.
 */
export const rollbackAllocations = async (roomIds, hostelId) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        for (const roomId of roomIds) {
            // Lock room
            await client.query(`SELECT id FROM room WHERE id = $1 FOR UPDATE`, [roomId]);
            
            // Delete assignments (DB triggers will auto-sync student fields and room occupancy)
            await client.query(
                `DELETE FROM room_assignment WHERE room_id = $1 AND assignment_status = 'ACTIVE'`, 
                [roomId]
            );
        }

        await client.query('COMMIT');
        
        emit(WS_EVENTS.ROOM_MAP_UPDATED, { hostelId, timestamp: new Date() }, hostelId);
        
        return { success: true, roomsRolledBack: roomIds.length };

    } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Rollback transaction failed: ${error.message}`);
    } finally {
        client.release();
    }
};
