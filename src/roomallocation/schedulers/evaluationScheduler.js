/**
 * evaluationScheduler.js
 * ============================================================
 * Timing domain: POST-ALLOCATION EVALUATION
 *
 * Owns:
 *   - Rollover evaluation  (after each batch)
 *   - Ghost penalties      (groups that never submitted)
 *   - Shatter checks       (impossible group sizes) — also called
 *     by roundScheduler at the START of each new round
 *   - Rank recalculation   (end of each round, for re-formed groups)
 *   - Final sweep          (after last batch — EVENT-DRIVEN, no timer)
 *   - ADMIN_MODE transition (after final sweep)
 *
 * Does NOT:
 *   - Contain business logic — delegates to engine / services
 *   - Manage batch/round timing → batchScheduler/roundScheduler
 *
 * Correct layering:
 *   evaluationScheduler → service → engine → DB
 * ============================================================
 */

import pool from '../../db/pool.js';
import { allocationService } from '../services/allocation.service.js';
import { setCurrentPhase } from '../services/phase.service.js';
import { SYSTEM_PHASES } from '../constants/phases.js';
import { emit, WS_EVENTS } from '../websocket/emitter.js';

// ─────────────────────────────────────────────────────────
// A. ROLLOVER EVALUATION
// ─────────────────────────────────────────────────────────

/**
 * Called by batchScheduler after each batch ends.
 * Evaluates which groups failed allocation and marks
 * eligible ones for rollover into the next batch.
 */
export async function evaluateRollovers(batchId) {
    console.log(`[evaluationScheduler] Evaluating rollovers for batch ${batchId}`);
    try {
        const result = await allocationService.triggerRolloverEvaluation(batchId);
        console.log(`[evaluationScheduler] Rollover result:`, result);
        return result;
    } catch (err) {
        console.error(`[evaluationScheduler] evaluateRollovers error:`, err.message);
    }
}

// ─────────────────────────────────────────────────────────
// B. GHOST PENALTIES
// ─────────────────────────────────────────────────────────

/**
 * Detects groups that were eligible but never submitted
 * any preferences during the batch. Dissolves and penalizes.
 */
export async function applyGhostPenalties(batchId) {
    console.log(`[evaluationScheduler] Applying ghost penalties for batch ${batchId}`);
    try {
        const result = await allocationService.triggerGhostPenalty(batchId);
        console.log(`[evaluationScheduler] Ghost penalty result:`, result);
        return result;
    } catch (err) {
        console.error(`[evaluationScheduler] applyGhostPenalties error:`, err.message);
    }
}

// ─────────────────────────────────────────────────────────
// C. SHATTER CHECKS
// ─────────────────────────────────────────────────────────

/**
 * After inventory changes (rooms fill up), some group sizes
 * may become impossible to allocate. Detect and dissolve them.
 *
 * Called:
 *   - By roundScheduler at the START of each new round
 *   - By runPostBatchEvaluation after batch ends
 */
export async function checkShatteredGroups(batchId) {
    console.log(`[evaluationScheduler] Checking shattered groups for batch ${batchId}`);
    try {
        const groupsRes = await pool.query(
            `SELECT hg.id FROM housing_groups hg
             WHERE hg.batch_id = $1
               AND hg.status NOT IN ('ALLOCATED', 'SHATTERED', 'PENALIZED')`,
            [batchId]
        );

        const results = [];
        for (const group of groupsRes.rows) {
            const result = await allocationService.triggerShatterProtocol(group.id);
            results.push({ groupId: group.id, result });

            if (result?.shattered) {
                console.log(`[evaluationScheduler] Group ${group.id} shattered: ${result.reason}`);
                emit(WS_EVENTS.EVALUATION_DONE, {
                    type: 'SHATTERED',
                    groupId: group.id,
                    reason: result.reason,
                });
            }
        }

        console.log(`[evaluationScheduler] Shatter check complete: ${results.length} groups evaluated`);
        return results;
    } catch (err) {
        console.error(`[evaluationScheduler] checkShatteredGroups error:`, err.message);
    }
}

// ─────────────────────────────────────────────────────────
// D. RANK RECALCULATION (for re-formed groups after shatter)
// ─────────────────────────────────────────────────────────

/**
 * After a shatter, members can re-form into smaller groups.
 * These new groups have no group_rank yet.
 *
 * This function:
 *   1. Finds all groups in HARD_LOCKED or SOFT_LOCKED status with
 *      NULL group_rank (i.e., re-formed groups that haven't been ranked)
 *   2. Assigns rank based on their leader's individual_rank
 *   3. Stops when no such groups remain
 *
 * Called at the end of each round by executeRound().
 * Only runs if there are unranked groups — self-terminating.
 *
 * @param {string} hostelId
 * @returns {Promise<{ recalculated: number }>}
 */
export async function recalculateGroupRanks(hostelId) {
    // Check if any re-formed groups exist with no rank
    const unrankedRes = await pool.query(
        `SELECT hg.id, s.individual_rank AS leader_rank
         FROM housing_groups hg
         JOIN students s ON s.id = hg.primary_applicant_id
         JOIN batches b ON hg.batch_id = b.id
         WHERE b.hostel_id = $1
           AND hg.group_rank IS NULL
           AND hg.status NOT IN ('ALLOCATED', 'SHATTERED', 'PENALIZED', 'FORMING')`,
        [hostelId]
    );

    if (unrankedRes.rowCount === 0) {
        return { recalculated: 0 }; // Nothing to do — stop
    }

    console.log(`[evaluationScheduler] Recalculating ranks for ${unrankedRes.rowCount} re-formed groups`);

    let recalculated = 0;
    for (const group of unrankedRes.rows) {
        if (group.leader_rank === null) continue; // Can't rank without a leader rank

        await pool.query(
            `UPDATE housing_groups SET group_rank = $1 WHERE id = $2 AND group_rank IS NULL`,
            [group.leader_rank, group.id]
        );
        recalculated++;
    }

    console.log(`[evaluationScheduler] Rank recalculation done: ${recalculated} groups updated`);
    return { recalculated };
}

// ─────────────────────────────────────────────────────────
// E. FINAL SWEEP — EVENT-DRIVEN (no setTimeout)
// ─────────────────────────────────────────────────────────

/**
 * Execute the final sweep pass.
 * Called synchronously by runPostBatchEvaluation when there are
 * no more pending batches — no timer, no delay.
 * Each student assignment is its own transaction in the engine.
 */
export async function runFinalSweep(hostelId) {
    console.log(`[evaluationScheduler] Running final sweep for hostel ${hostelId}`);
    try {
        const result = await allocationService.runFinalSweep(hostelId);
        console.log(`[evaluationScheduler] Final sweep result:`, result);

        emit(WS_EVENTS.EVALUATION_DONE, { hostelId, sweep: 'FINAL', result }, hostelId);

        // After final sweep, transition to ADMIN_MODE
        await _transitionToAdminMode(hostelId);

        return result;
    } catch (err) {
        console.error(`[evaluationScheduler] runFinalSweep error:`, err.message);
    }
}

// ─────────────────────────────────────────────────────────
// F. ADMIN MODE TRANSITION
// ─────────────────────────────────────────────────────────

async function _transitionToAdminMode(hostelId) {
    try {
        await setCurrentPhase(hostelId, SYSTEM_PHASES.ADMIN_MODE);
        console.log(`[evaluationScheduler] Hostel ${hostelId} → ADMIN_MODE`);
        emit(WS_EVENTS.PHASE_CHANGED, { hostelId, phase: SYSTEM_PHASES.ADMIN_MODE }, hostelId);
    } catch (err) {
        console.warn(`[evaluationScheduler] Admin mode transition warning: ${err.message}`);
    }
}

// ─────────────────────────────────────────────────────────
// ORCHESTRATED ENTRY POINT
// ─────────────────────────────────────────────────────────

/**
 * Single call made by batchScheduler after each batch ends.
 * Runs the full post-batch evaluation pipeline in sequence.
 * If no more batches remain, triggers final sweep immediately.
 *
 * Flow:
 *   evaluateRollovers
 *   → applyGhostPenalties
 *   → checkShatteredGroups
 *   → [if last batch] runFinalSweep
 */
export async function runPostBatchEvaluation(batchId, hostelId) {
    console.log(`[evaluationScheduler] Post-batch evaluation starting for batch ${batchId}`);
    try {
        await evaluateRollovers(batchId);
        await applyGhostPenalties(batchId);
        await checkShatteredGroups(batchId);

        emit(WS_EVENTS.EVALUATION_DONE, { hostelId, batchId, sweep: 'POST_BATCH' }, hostelId);
        console.log(`[evaluationScheduler] Post-batch evaluation complete for batch ${batchId}`);

        // Check if ALL batches for this hostel are now COMPLETED.
        // A batch is "over" when its status is neither PENDING nor ACTIVE.
        // Final sweep fires only when zero batches remain in those states.
        const remainingRes = await pool.query(
            `SELECT 1 FROM batches
             WHERE hostel_id = $1
               AND status IN ('PENDING', 'ACTIVE')
             LIMIT 1`,
            [hostelId]
        );

        if (remainingRes.rowCount === 0) {
            console.log(`[evaluationScheduler] All batches complete for hostel ${hostelId} — triggering final sweep`);
            await runFinalSweep(hostelId);
        }

    } catch (err) {
        console.error(`[evaluationScheduler] runPostBatchEvaluation error:`, err.message);
    }
}
