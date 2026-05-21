/**
 * roomSelector.js — Room Selection Strategy (PURE)
 * ============================================================
 * Encapsulates allocation policy and room-matching logic.
 *
 * RULES:
 *  - This file contains ZERO DB mutations.
 *  - ZERO transactions.
 *  - ZERO inserts / updates.
 *  - Only: pure selection functions.
 *
 * Callers (roundAllocator.js) are responsible for locking
 * and verifying room freshness before using these results.
 * ============================================================
 */

// ─────────────────────────────────────────────────────────
// CORE AVAILABILITY CHECKS
// ─────────────────────────────────────────────────────────

/**
 * Calculate how many beds are currently free in a room.
 * Uses only the values provided — never reads DB.
 *
 * @param {{ max_capacity: number, current_occupancy: number }} room
 * @returns {number}
 */
export function getRemainingBeds(room) {
    return room.max_capacity - room.current_occupancy;
}

/**
 * Check whether a group of `groupSize` members can all fit
 * in the room given its current occupancy.
 *
 * Supports partial fill: a 3-person group CAN go into a
 * 4-bed room — the remaining 1 bed stays open.
 *
 * @param {{ max_capacity: number, current_occupancy: number }} room
 * @param {number} groupSize  Number of members to place
 * @returns {boolean}
 */
export function canFitGroup(room, groupSize) {
    if (!room || groupSize < 1) return false;
    return getRemainingBeds(room) >= groupSize;
}

/**
 * Stronger check: ensures placing the group will NOT exceed
 * max_capacity under any circumstances.
 *
 * @param {{ max_capacity: number, current_occupancy: number }} room
 * @param {number} groupSize
 * @returns {boolean}
 */
export function canFitGroupStrict(room, groupSize) {
    if (!room || groupSize < 1) return false;
    const newOccupancy = room.current_occupancy + groupSize;
    return newOccupancy <= room.max_capacity;
}

/**
 * Returns true if the room is entirely empty.
 */
export function isRoomEmpty(room) {
    return room.current_occupancy === 0;
}

/**
 * Returns true if the room is fully occupied.
 */
export function isRoomFull(room) {
    return room.current_occupancy >= room.max_capacity;
}

// ─────────────────────────────────────────────────────────
// PREFERENCE EVALUATION
// ─────────────────────────────────────────────────────────

/**
 * Given a list of room preferences (already ordered by preference_order)
 * and a map of freshly-locked room records, return the first room
 * that can accommodate `groupSize` members.
 *
 * Returns null if no preference is satisfiable.
 *
 * @param {{ room_id: string, preference_order: number }[]} preferences
 *     Sorted by preference_order ASC (as stored in submission_preference)
 * @param {Map<string, object>} lockedRooms
 *     Map of roomId → fresh DB room record (already locked FOR UPDATE by caller)
 * @param {number} groupSize
 * @returns {{ room: object, preferenceOrder: number } | null}
 */
export function selectPreferredRoom(preferences, lockedRooms, groupSize) {
    // Sort defensively — caller should already have them sorted
    const sorted = [...preferences].sort((a, b) => a.preference_order - b.preference_order);

    for (const pref of sorted) {
        const room = lockedRooms.get(pref.room_id);

        if (!room) continue;                         // room not found (shouldn't happen after validation)
        if (isRoomFull(room)) continue;              // already full
        if (!canFitGroupStrict(room, groupSize)) continue; // not enough beds

        return { room, preferenceOrder: pref.preference_order };
    }

    return null; // no suitable room found
}

// ─────────────────────────────────────────────────────────
// FINAL SWEEP HELPERS
// ─────────────────────────────────────────────────────────

/**
 * Given a list of available rooms, return them sorted by
 * remaining beds (ascending) so we fill tighter rooms first,
 * reducing fragmentation.
 *
 * @param {object[]} rooms  Array of room records
 * @returns {object[]}  Sorted copy
 */
export function sortRoomsByFill(rooms) {
    return [...rooms].sort((a, b) => {
        const remA = getRemainingBeds(a);
        const remB = getRemainingBeds(b);
        return remA - remB; // smallest gap first → minimises waste
    });
}

/**
 * From a list of rooms, find the one with the most available beds.
 * Used by shatterProtocol to detect maximum possible group size.
 *
 * @param {object[]} rooms
 * @returns {object|null}
 */
export function findLargestAvailableRoom(rooms) {
    let best = null;
    for (const room of rooms) {
        if (isRoomFull(room)) continue;
        if (!best || getRemainingBeds(room) > getRemainingBeds(best)) {
            best = room;
        }
    }
    return best;
}

/**
 * Filter rooms to only those that can fit exactly one student.
 * Used by finalSweep for single-student orphan assignment.
 *
 * @param {object[]} rooms
 * @returns {object[]}
 */
export function roomsWithAnyCapacity(rooms) {
    return rooms.filter(r => !isRoomFull(r));
}
