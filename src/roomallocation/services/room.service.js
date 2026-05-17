import pool from '../../db/pool.js';
import ApiError from '../../utils/apiError.js';

/**
 * Fetch all hostels
 */
export const getAllHostels = async () => {
    try {
        const result = await pool.query(`SELECT * FROM hostels ORDER BY name ASC`);
        return result.rows;
    } catch (error) {
        throw new ApiError(500, 'Error fetching hostels: ' + error.message);
    }
};

/**
 * Fetch hostel by ID
 */
export const getHostelById = async (hostelId) => {
    try {
        const result = await pool.query(`SELECT * FROM hostels WHERE id = $1`, [hostelId]);
        if (result.rows.length === 0) {
            throw new ApiError(404, 'Hostel not found');
        }
        return result.rows[0];
    } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, 'Error fetching hostel: ' + error.message);
    }
};

// NOTE: updateHostelPhase() was removed from this file.
// Phase management belongs in: phase/phase.service.js
// Use setCurrentPhase(hostelId, phase) from there.

/**
 * Fetch all rooms for a hostel
 */
export const getRoomsByHostel = async (hostelId) => {
    try {
        const result = await pool.query(
            `SELECT * FROM rooms WHERE hostel_id = $1 ORDER BY room_number ASC`,
            [hostelId]
        );
        return result.rows;
    } catch (error) {
        throw new ApiError(500, 'Error fetching rooms: ' + error.message);
    }
};

/**
 * Fetch room by ID
 */
export const getRoomById = async (roomId) => {
    try {
        const result = await pool.query(`SELECT * FROM rooms WHERE id = $1`, [roomId]);
        if (result.rows.length === 0) {
            throw new ApiError(404, 'Room not found');
        }
        return result.rows[0];
    } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, 'Error fetching room: ' + error.message);
    }
};
