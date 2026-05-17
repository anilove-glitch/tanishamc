/**
 * roundScheduler.js
 * ============================================================
 * Timing domain: 10-MINUTE ROUND EXECUTION CYCLES
 *
 * Owns:
 *   - Freezing submission windows at minute 10/20/30...
 *   - Calling allocationService.executeBatchRound()
 *   - Advancing the round counter (1 → 2 → ... → 6)
 *   - Broadcasting updated room maps after allocation
 *   - Detecting end of round cycle (after Round 6)
 *   - Crash recovery: re-derives current round from DB
 *
 * Does NOT:
 *   - Activate/deactivate batches → batchScheduler
 *   - Run rollover/penalty logic  → evaluationScheduler
 *   - Contain allocation math     → engine/roundallocator.js
 *
 * Round timing (per batch window):
 *   Round 1: 0–10 min
 *   Round 2: 10–20 min
 *   ...
 *   Round 6: 50–60 min
 *
 * ROUND_DURATION_MS can be overridden via env for testing.
 * ============================================================
 */

import pool from '../../db/pool.js';
import { allocationService } from '../services/allocation.service.js';
import { emit, WS_EVENTS } from '../websocket/emitter.js';

const ROUND_DURATION_MS = parseInt(process.env.ROUND_DURATION_MS || '600000', 10); // 10 min default
const MAX_ROUNDS = 6;

// Per-batch state: batchId → { currentRound, frozen, timerId }
const _state = new Map();

// ─────────────────────────────────────────────────────────
// STARTUP RECOVERY
// ─────────────────────────────────────────────────────────

/**
 * Called by batchScheduler during boot when an ACTIVE batch
 * is found. Re-derives which round we're in from timestamps
 * and re-arms the correct timer.
 */
export async function recoverOnBoot(batchId) {
    const batchRes = await pool.query(
        `SELECT * FROM batches WHERE id = $1 AND status = 'ACTIVE'`,
        [batchId]
    );

    if (batchRes.rowCount === 0) return;

    const batch = batchRes.rows[0];
    const now = new Date();
    const startTime = new Date(batch.start_time);

    const elapsedMs = now.getTime() - startTime.getTime();
    const completedRounds = Math.min(
        Math.floor(elapsedMs / ROUND_DURATION_MS),
        MAX_ROUNDS
    );
    const currentRound = completedRounds + 1;

    if (currentRound > MAX_ROUNDS) {
        console.log(`[roundScheduler] Batch ${batchId} already past round 6, no recovery needed`);
        return;
    }

    const msIntoCurrentRound = elapsedMs - (completedRounds * ROUND_DURATION_MS);
    const msUntilFreeze = ROUND_DURATION_MS - msIntoCurrentRound;

    console.log(
        `[roundScheduler] Recovering batch ${batchId} — ` +
        `round ${currentRound}, freeze in ${Math.round(msUntilFreeze / 1000)}s`
    );

    // Check if submissions already happened for rounds we missed
    for (let r = 1; r < currentRound; r++) {
        const processed = await pool.query(
            `SELECT 1 FROM allocation_submissions WHERE batch_id = $1 AND round_number = $2 AND is_processed = true`,
            [batchId, r]
        );
        if (processed.rowCount === 0) {
            // Missed a round execution — run it now
            console.warn(`[roundScheduler] Round ${r} was not processed — executing now`);
            await executeRound(batchId, r);
        }
    }

    // Resume from where we are
    _state.set(batchId, { currentRound, frozen: false, timerId: null });
    _armFreezeTimer(batchId, currentRound, msUntilFreeze);
}

// ─────────────────────────────────────────────────────────
// ROUND CYCLE CONTROL
// ─────────────────────────────────────────────────────────

/**
 * Begin the round cycle for a newly activated batch.
 * Called by batchScheduler immediately after startBatch().
 */
export async function startRoundCycle(batchId) {
    console.log(`[roundScheduler] Starting round cycle for batch ${batchId}`);

    _state.set(batchId, { currentRound: 1, frozen: false, timerId: null });
    emit(WS_EVENTS.ROUND_OPENED, { batchId, round: 1 });

    _armFreezeTimer(batchId, 1, ROUND_DURATION_MS);
}

/**
 * Stop all timers for a batch (called when batch ends).
 */
export function stopRoundCycle(batchId) {
    const state = _state.get(batchId);
    if (state?.timerId) {
        clearTimeout(state.timerId);
    }
    _state.delete(batchId);
    console.log(`[roundScheduler] Round cycle stopped for batch ${batchId}`);
}

// ─────────────────────────────────────────────────────────
// INTERNAL TIMER HELPERS
// ─────────────────────────────────────────────────────────

function _armFreezeTimer(batchId, round, delayMs) {
    const state = _state.get(batchId);
    if (!state) return;

    clearTimeout(state.timerId);
    state.timerId = setTimeout(async () => {
        try {
            await freezeRound(batchId, round);
        } catch (err) {
            console.error(`[roundScheduler] freezeRound failed (batch=${batchId}, round=${round}):`, err.message);
        }
    }, delayMs);

    _state.set(batchId, state);
}

// ─────────────────────────────────────────────────────────
// A. FREEZE CURRENT ROUND
// ─────────────────────────────────────────────────────────

/**
 * Marks the round as frozen — no more submissions accepted.
 * Then immediately executes the allocator.
 */
export async function freezeRound(batchId, round) {
    const state = _state.get(batchId);
    if (!state || state.frozen) return;

    state.frozen = true;
    _state.set(batchId, state);

    console.log(`[roundScheduler] Round ${round} frozen for batch ${batchId}`);
    emit(WS_EVENTS.ROUND_FROZEN, { batchId, round });

    await executeRound(batchId, round);
}

// ─────────────────────────────────────────────────────────
// B. EXECUTE ALLOCATOR
// ─────────────────────────────────────────────────────────

/**
 * Calls the allocation service engine.
 * Results committed to DB inside the engine.
 */
export async function executeRound(batchId, round) {
    console.log(`[roundScheduler] Executing round ${round} for batch ${batchId}`);

    let result;
    try {
        result = await allocationService.executeBatchRound(batchId, round);
    } catch (err) {
        console.error(`[roundScheduler] executeBatchRound error:`, err.message);
        result = { error: err.message };
    }

    console.log(`[roundScheduler] Round ${round} complete:`, result);

    emit(WS_EVENTS.ROUND_EXECUTED, { batchId, round, result });

    // Broadcast updated room map
    await broadcastResults(batchId, round);

    // Advance to next round
    await advanceRound(batchId, round);
}

// ─────────────────────────────────────────────────────────
// C. BROADCAST ROOM MAP
// ─────────────────────────────────────────────────────────

/**
 * Fetches the current live room map and emits to all clients.
 */
export async function broadcastResults(batchId, round) {
    try {
        // Get hostel_id for this batch
        const batchRes = await pool.query(
            `SELECT hostel_id FROM batches WHERE id = $1`,
            [batchId]
        );
        if (batchRes.rowCount === 0) return;

        const { hostel_id } = batchRes.rows[0];
        const roomMap = await allocationService.getLiveRoomMap(hostel_id);

        emit(WS_EVENTS.ROOM_MAP_UPDATED, { hostelId: hostel_id, batchId, round, rooms: roomMap }, hostel_id);
    } catch (err) {
        console.error(`[roundScheduler] broadcastResults error:`, err.message);
    }
}

// ─────────────────────────────────────────────────────────
// D. ADVANCE ROUND COUNTER
// ─────────────────────────────────────────────────────────

/**
 * Increments round counter and either reopens submissions
 * or ends the cycle if we just finished round 6.
 */
export async function advanceRound(batchId, completedRound) {
    const nextRound = completedRound + 1;

    if (nextRound > MAX_ROUNDS) {
        // F. Detect final round — cycle complete
        await _endRoundCycle(batchId);
        return;
    }

    // E. Reopen submission window for next round
    const state = _state.get(batchId);
    if (!state) return;

    state.currentRound = nextRound;
    state.frozen = false;
    _state.set(batchId, state);

    console.log(`[roundScheduler] Submission window open for round ${nextRound}`);
    emit(WS_EVENTS.ROUND_OPENED, { batchId, round: nextRound });

    _armFreezeTimer(batchId, nextRound, ROUND_DURATION_MS);
}

// ─────────────────────────────────────────────────────────
// F. DETECT FINAL ROUND
// ─────────────────────────────────────────────────────────

async function _endRoundCycle(batchId) {
    console.log(`[roundScheduler] All rounds complete for batch ${batchId}`);
    stopRoundCycle(batchId);
    emit(WS_EVENTS.ROUND_CYCLE_DONE, { batchId });
    // batchScheduler's end-timer will close the batch formally
}

// ─────────────────────────────────────────────────────────
// QUERY HELPERS (used by services to check round state)
// ─────────────────────────────────────────────────────────

/**
 * Returns the current active round number for a batch,
 * derived purely from DB timestamps — safe after restart.
 */
export function getCurrentRoundForBatch(batchId) {
    return _state.get(batchId)?.currentRound ?? null;
}

/**
 * Returns whether the current round is frozen (submissions blocked).
 */
export function isRoundFrozen(batchId) {
    return _state.get(batchId)?.frozen ?? false;
}
