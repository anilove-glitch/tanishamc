/**
 * ghostPenalty.js — Ghost / No-Show Detection Engine
 * ============================================================
 * Detects groups that were eligible (SOFT_LOCKED/HARD_LOCKED)
 * during the batch but submitted ZERO preference rounds.
 *
 * Punishment: dissolve the group and set status = 'PENALIZED'.
 * Members are unlinked (group_id = NULL), freeing them to
 * re-form new groups in later phases.
 *
 * INVARIANTS:
 *   1. Never penalize a group that submitted at least once.
 *   2. Never penalize an already ALLOCATED group.
 *   3. Dissolution is all-or-nothing (transaction-safe).
 * ============================================================
 */

import { withTransaction, lockGroup, lockStudents } from './locking.js';
import { logGhostPenalty } from './allocationLogger.js';
import pool from '../../db/pool.js';

// ─────────────────────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────

/**
 * Detect and penalize ghost groups for a completed batch.
 *
 * @param {string} batchId  UUID of the completed batch
 * @returns {Promise<{ penalized: number, skipped: number }>}
 */
export async function execute(batchId) {
    // Find groups assigned to this batch that are in a lockable state
    // but submitted ZERO rounds during the batch
    const ghostRes = await pool.query(
        `SELECT hg.id, hg.status
         FROM housing_groups hg
         WHERE hg.batch_id = $1
           AND hg.status IN ('SOFT_LOCKED', 'HARD_LOCKED', 'FORMING')
           AND NOT EXISTS (
               SELECT 1 FROM allocation_submissions asb
               WHERE asb.group_id = hg.id
                 AND asb.batch_id = $1
           )`,
        [batchId]
    );

    let penalized = 0;
    let skipped = 0;

    for (const group of ghostRes.rows) {
        try {
            await _penalizeGroup(group.id, batchId);
            penalized++;
        } catch (err) {
            console.error(`[ghostPenalty] Failed to penalize group ${group.id}:`, err.message);
            skipped++;
        }
    }

    return { penalized, skipped };
}

// ─────────────────────────────────────────────────────────
// PENALTY APPLICATION
// ─────────────────────────────────────────────────────────

async function _penalizeGroup(groupId, batchId) {
    await withTransaction(async (client) => {
        // Lock group row
        const group = await lockGroup(client, groupId);
        if (!group) return; // Already dissolved

        // Safety re-check inside transaction
        if (group.status === 'ALLOCATED' || group.status === 'PENALIZED') {
            return; // Never penalize allocated/already-penalized
        }

        // Double-check: any submissions exist?
        const subCheck = await client.query(
            `SELECT 1 FROM allocation_submissions WHERE group_id = $1 AND batch_id = $2 LIMIT 1`,
            [groupId, batchId]
        );
        if (subCheck.rowCount > 0) return; // Not a ghost — submitted at least once

        // Fetch and lock members
        const membersRes = await client.query(
            `SELECT id FROM students WHERE group_id = $1 ORDER BY id ASC`,
            [groupId]
        );
        const memberIds = membersRes.rows.map(r => r.id);

        if (memberIds.length > 0) {
            await lockStudents(client, memberIds);

            // Unlink members from group (all-or-nothing)
            await client.query(
                `UPDATE students SET group_id = NULL WHERE id = ANY($1::int[])`,
                [memberIds]
            );
        }

        // Mark group as PENALIZED
        await client.query(
            `UPDATE housing_groups SET status = 'PENALIZED' WHERE id = $1`,
            [groupId]
        );

        await logGhostPenalty({ batchId, groupId, memberIds, client });
    });
}
