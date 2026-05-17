/**
 * evaluationScheduler.js
 * ============================================================
 * Timing domain: POST-ALLOCATION EVALUATION
 *
 * Owns:
 *   - Rollover evaluation  (after each batch)
 *   - Ghost penalties      (groups that never submitted)
 *   - Shatter checks       (impossible group sizes)
 *   - Final sweep          (Sunday 5 PM or after last batch)
 *   - ADMIN_MODE transition (after final sweep)
 *
 * Does NOT:
 *   - Contain business logic — delegates to engine stubs
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

// Final sweep scheduled timer: hostelId → timerId
const _finalSweepTimers = new Map();

// ─────────────────────────────────────────────────────────
// A. ROLLOVER EVALUATION
// ─────────────────────────────────────────────────────────

/**
 * Called by batchScheduler after each batch ends.
 * Evaluates which groups failed allocation and marks
 * eligible ones for rollover into the next batch.
 * Business logic lives in the engine (stub → implement later).
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
 * Business logic → engine stub.
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
 * Business logic → engine stub.
 */
export async function checkShatteredGroups(batchId) {
    console.log(`[evaluationScheduler] Checking shattered groups for batch ${batchId}`);
    try {
        // Fetch all non-allocated groups still tied to this batch
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
        }

        console.log(`[evaluationScheduler] Shatter check complete: ${results.length} groups evaluated`);
        return results;
    } catch (err) {
        console.error(`[evaluationScheduler] checkShatteredGroups error:`, err.message);
    }
}

// ─────────────────────────────────────────────────────────
// D. FINAL SWEEP
// ─────────────────────────────────────────────────────────

/**
 * Schedule the final sweep for a hostel.
 * Called by batchScheduler after the last batch completes.
 *
 * Default timing: 30 minutes after last batch ends, unless
 * FINAL_SWEEP_DELAY_MS env var is set.
 *
 * For production: override with a specific calendar time
 * (e.g. Sunday 5 PM) by setting FINAL_SWEEP_AT_ISO.
 */
export async function scheduleFinalsweep(hostelId) {
    // Calculate delay
    let delayMs;

    if (process.env.FINAL_SWEEP_AT_ISO) {
        const target = new Date(process.env.FINAL_SWEEP_AT_ISO);
        delayMs = Math.max(0, target.getTime() - Date.now());
        console.log(`[evaluationScheduler] Final sweep scheduled at ${target.toISOString()} for hostel ${hostelId}`);
    } else {
        delayMs = parseInt(process.env.FINAL_SWEEP_DELAY_MS || String(30 * 60 * 1000), 10); // 30 min default
        console.log(`[evaluationScheduler] Final sweep in ${Math.round(delayMs / 60000)} min for hostel ${hostelId}`);
    }

    // Clear any previous timer
    if (_finalSweepTimers.has(hostelId)) {
        clearTimeout(_finalSweepTimers.get(hostelId));
    }

    const timerId = setTimeout(async () => {
        try {
            await runFinalSweep(hostelId);
        } catch (err) {
            console.error(`[evaluationScheduler] runFinalSweep error:`, err.message);
        }
    }, delayMs);

    _finalSweepTimers.set(hostelId, timerId);
}

/**
 * Execute the final sweep pass.
 * Assigns leftover/orphan students to remaining rooms.
 * Business logic → engine stub.
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
// E. ADMIN MODE TRANSITION
// ─────────────────────────────────────────────────────────

async function _transitionToAdminMode(hostelId) {
    try {
        await setCurrentPhase(hostelId, SYSTEM_PHASES.ADMIN_MODE);
        console.log(`[evaluationScheduler] Hostel ${hostelId} → ADMIN_MODE`);
        emit(WS_EVENTS.PHASE_CHANGED, { hostelId, phase: SYSTEM_PHASES.ADMIN_MODE }, hostelId);
    } catch (err) {
        // Phase transition may already be correct
        console.warn(`[evaluationScheduler] Admin mode transition warning: ${err.message}`);
    }
}

// ─────────────────────────────────────────────────────────
// ORCHESTRATED ENTRY POINT
// ─────────────────────────────────────────────────────────

/**
 * Single call made by batchScheduler after each batch ends.
 * Runs the full post-batch evaluation pipeline in sequence.
 *
 * Flow:
 *   evaluateRollovers
 *   → applyGhostPenalties
 *   → checkShatteredGroups
 */
export async function runPostBatchEvaluation(batchId, hostelId) {
    console.log(`[evaluationScheduler] Post-batch evaluation starting for batch ${batchId}`);
    try {
        await evaluateRollovers(batchId);
        await applyGhostPenalties(batchId);
        await checkShatteredGroups(batchId);

        emit(WS_EVENTS.EVALUATION_DONE, { hostelId, batchId, sweep: 'POST_BATCH' }, hostelId);
        console.log(`[evaluationScheduler] Post-batch evaluation complete for batch ${batchId}`);
    } catch (err) {
        console.error(`[evaluationScheduler] runPostBatchEvaluation error:`, err.message);
    }
}
