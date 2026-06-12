/**
 * roomCache.js
 *
 * Key conventions:
 *   rooms:{hostelId}   — full list of rooms for a hostel
 *   room:{roomId}      — a single room record
 *
 * CRITICAL: invalidateRoom() always cascades to invalidateRooms() so the
 * parent list never serves stale data after an individual room is updated.
 */

import { getCache, setCache, deleteCache } from './cache.service.js';

const TTL = 86400; // 24 h

const keys = {
    list:   (hostelId) => `rooms:${hostelId}`,
    single: (roomId)   => `room:${roomId}`,
};

// ── List (all rooms in a hostel) ──────────────────────────

export async function getRooms(hostelId) {
    return getCache(keys.list(hostelId));
}

export async function setRooms(hostelId, rooms) {
    return setCache(keys.list(hostelId), rooms, TTL);
}

export async function invalidateRooms(hostelId) {
    return deleteCache(keys.list(hostelId));
}

// ── Single room ───────────────────────────────────────────

export async function getRoom(roomId) {
    return getCache(keys.single(roomId));
}

export async function setRoom(roomId, room) {
    return setCache(keys.single(roomId), room, TTL);
}

/**
 * Invalidate a single room AND cascade-invalidate the parent hostel list.
 * Always call this instead of a bare deleteCache() so the list stays fresh.
 * @param {string} roomId
 * @param {string} hostelId   — required for the cascade invalidation
 */
export async function invalidateRoom(roomId, hostelId) {
    await deleteCache(keys.single(roomId));
    await invalidateRooms(hostelId);
}
