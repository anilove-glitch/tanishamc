/**
 * shatterProtocol.js — Impossible Group Size Detection
 * ============================================================
 * After each round or inventory change, some groups may become
 * impossible to allocate because their size exceeds the largest
 * remaining available room.
 *
 * Example: 4-member group + only 3-bed rooms remain → shatter.
 *
 * Result: group is dissolved (SHATTERED), members are freed
 * so they can re-form smaller groups for subsequent phases.
 *
 * INVARIANTS:
 *   1. Never shatter an already ALLOCATED group.
 *   2. Re-check availability dynamically (inventory changes).
 *   3. All-or-nothing dissolution (transaction).
 * ============================================================
 */

import { withTransaction, lockGroup, lockStudents } from './locking.js';
import { findLargestAvailableRoom } from './roomSelector.js';
import { logShatter } from './allocationLogger.js';
import pool from '../../db/pool.js';

// ─────────────────────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────

/**
 * Evaluate whether a specific group should be shattered.
 * Called by evaluationScheduler after each batch, or triggered
 * when room inventory changes significantly.
 *
 * @param {string} groupId  UUID
 * @param {string} [hostelId]  If provided, limits room scan to this hostel
 * @returns {Promise<{ shattered: boolean, reason?: string }>}
 */
export async function evaluate(groupId, hostelId) {
    // 1. Get current group size (count actual members)
    const sizeRes = await pool.query(
        `SELECT COUNT(*) as size FROM students WHERE group_id = $1`,
        [groupId]
    );
    const groupSize = parseInt(sizeRes.rows[0].size, 10);

    if (groupSize === 0) {
        return { shattered: false, reason: 'Group is empty — no action needed' };
    }

    // 2. Determine which hostel's rooms to scan
    let effectiveHostelId = hostelId;
    if (!effectiveHostelId) {
        const batchRes = await pool.query(
            `SELECT b.hostel_id FROM housing_groups hg
             JOIN batches b ON hg.batch_id = b.id
             WHERE hg.id = $1`,
            [groupId]
        );
        effectiveHostelId = batchRes.rows[0]?.hostel_id;
    }

    if (!effectiveHostelId) {
        return { shattered: false, reason: 'Could not determine hostel — skipped' };
    }

    // 3. Find largest available room capacity DYNAMICALLY
    const roomsRes = await pool.query(
        `SELECT id, max_capacity, current_occupancy
         FROM rooms
         WHERE hostel_id = $1 AND current_occupancy < max_capacity`,
        [effectiveHostelId]
    );

    const largestRoom = findLargestAvailableRoom(roomsRes.rows);
    const largestAvailableBeds = largestRoom
        ? largestRoom.max_capacity - largestRoom.current_occupancy
        : 0;

    // 4. Feasibility check — if group cannot fit anywhere, shatter
    if (groupSize <= largestAvailableBeds) {
        return { shattered: false, reason: `Group of ${groupSize} can still fit (largest available: ${largestAvailableBeds} beds)` };
    }

    // 5. Dissolve the group
    await _shatterGroup(groupId, groupSize, largestAvailableBeds);

    return {
        shattered: true,
        groupSize,
        largestAvailableBeds,
        reason: `Group size (${groupSize}) exceeds largest available room (${largestAvailableBeds} beds)`,
    };
}

// ─────────────────────────────────────────────────────────
// DISSOLUTION
// ─────────────────────────────────────────────────────────

async function _shatterGroup(groupId, groupSize, largestAvailableBeds) {
    await withTransaction(async (client) => {
        const group = await lockGroup(client, groupId);
        if (!group) return;

        // Safety re-check inside lock
        if (group.status === 'ALLOCATED' || group.status === 'SHATTERED') return;

        // Fetch and lock all members
        const membersRes = await client.query(
            `SELECT id FROM students WHERE group_id = $1 ORDER BY id ASC`,
            [groupId]
        );
        const memberIds = membersRes.rows.map(r => r.id);

        if (memberIds.length > 0) {
            await lockStudents(client, memberIds);
            // Unlink all members — they can re-form
            await client.query(
                `UPDATE students SET group_id = NULL WHERE id = ANY($1::int[])`,
                [memberIds]
            );
        }

        await client.query(
            `UPDATE housing_groups SET status = 'SHATTERED' WHERE id = $1`,
            [groupId]
        );

        await logShatter({ groupId, groupSize, largestAvailableBeds, client });
    });
}
