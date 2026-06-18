/**
 * room.service.js
 *
 * Frontend-facing read services use Redis (via roomCache) as a read-through
 * cache.  Write services invalidate the relevant keys after a successful
 * Postgres commit (PG commit → Redis invalidate → Pusher emit).
 *
 * The allocation engine (allocation.service.js, locking.js, etc.) MUST NOT
 * import from this file for availability checks — those must always read
 * directly from Postgres for ACID correctness.
 */

import pool from '../../db/pool.js';
import ApiError from '../../utils/apiError.js';
import {
    getRooms, setRooms, invalidateRooms,
    getRoom,  setRoom,  invalidateRoom,
} from '../../cache/roomCache.js';

// ─── Hostels ──────────────────────────────────────────────────────────────────

/**
 * Fetch all hostels (no cache — low frequency, admin-facing).
 */
export const getAllHostels = async () => {
    try {
        const result = await pool.query(`SELECT * FROM hostel ORDER BY name ASC`);
        return result.rows;
    } catch (error) {
        throw new ApiError(500, 'Error fetching hostels: ' + error.message);
    }
};

/**
 * Fetch hostel by ID (no cache — low frequency, admin-facing).
 */
export const getHostelById = async (hostelId) => {
    try {
        const result = await pool.query(`SELECT * FROM hostel WHERE id = $1`, [hostelId]);
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
// Phase management belongs in: services/phase.service.js
// Use setCurrentPhase(hostelId, phase) from there.

// ─── Rooms — READ ─────────────────────────────────────────────────────────────

/**
 * Fetch all rooms for a hostel.
 *
 * Cache pattern:
 *   1. Check Redis  →  hit: return immediately
 *   2. Miss / error →  query Postgres, populate cache, return rows
 */
export const getRoomsByHostel = async (hostelId) => {
    try {
        // 1. Redis read
        const cached = await getRooms(hostelId);
        if (cached !== null) {
            console.log(`[cache] HIT  rooms:${hostelId}`);
            return cached;
        }

        // 2. Postgres fallback
        console.log(`[cache] MISS rooms:${hostelId} — querying Postgres`);
        const result = await pool.query(
            `SELECT * FROM room WHERE hostel_id = $1 ORDER BY room_number ASC`,
            [hostelId]
        );

        // 3. Populate cache
        await setRooms(hostelId, result.rows);
        return result.rows;
    } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, 'Error fetching rooms: ' + error.message);
    }
};

/**
 * Fetch a single room by ID.
 *
 * Cache pattern: same read-through as above.
 */
export const getRoomById = async (roomId) => {
    try {
        // 1. Redis read
        const cached = await getRoom(roomId);
        if (cached !== null) {
            console.log(`[cache] HIT  room:${roomId}`);
            return cached;
        }

        // 2. Postgres fallback
        console.log(`[cache] MISS room:${roomId} — querying Postgres`);
        const result = await pool.query(`SELECT * FROM room WHERE id = $1`, [roomId]);
        if (result.rows.length === 0) {
            throw new ApiError(404, 'Room not found');
        }

        // 3. Populate cache
        await setRoom(roomId, result.rows[0]);
        return result.rows[0];
    } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, 'Error fetching room: ' + error.message);
    }
};

// ─── Rooms — WRITE ────────────────────────────────────────────────────────────

/**
 * Create a new hostel (admin setup).
 * No cache update needed — getAllHostels is not cached.
 */
export const createHostel = async (name, type, totalCapacity) => {
    try {
        if (!name) throw new ApiError(400, 'Hostel name is required');
        const result = await pool.query(
            `INSERT INTO hostel (name, type, total_capacity)
             VALUES ($1, $2, $3)
             RETURNING *`,
            [name, type ?? null, totalCapacity ?? null]
        );
        return result.rows[0];
    } catch (error) {
        if (error instanceof ApiError) throw error;
        if (error.constraint === 'hostels_name_key') {
            throw new ApiError(409, `Hostel with name "${name}" already exists`);
        }
        throw new ApiError(500, 'Error creating hostel: ' + error.message);
    }
};

/**
 * Create a new room in a hostel (admin setup).
 *
 * Write order:
 *   1. Postgres INSERT  (source of truth)
 *   2. Invalidate rooms list cache for this hostel
 *   3. Caller is responsible for any Pusher emit
 */
export const createRoom = async (hostelId, roomNumber, roomType, maxCapacity) => {
    try {
        if (!hostelId || !roomNumber || !maxCapacity) {
            throw new ApiError(400, 'hostelId, roomNumber, and maxCapacity are required');
        }
        const result = await pool.query(
            `INSERT INTO room (hostel_id, room_number, room_type, max_capacity)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [hostelId, roomNumber, roomType ?? null, maxCapacity]
        );

        // Invalidate the hostel room list so the next read is fresh
        await invalidateRooms(hostelId);

        return result.rows[0];
    } catch (error) {
        if (error instanceof ApiError) throw error;
        if (error.constraint === 'rooms_hostel_id_room_number_key') {
            throw new ApiError(409, `Room ${roomNumber} already exists in this hostel`);
        }
        throw new ApiError(500, 'Error creating room: ' + error.message);
    }
};
