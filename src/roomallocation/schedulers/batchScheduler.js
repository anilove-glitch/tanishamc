/**
 * batchScheduler.js
 * ============================================================
 * Timing domain: BATCH LIFECYCLE
 *
 * Owns:
 *   - Activating batches (PENDING → ACTIVE)
 *   - Closing batches   (ACTIVE  → COMPLETED)
 *   - Queuing the next batch
 *   - Hostel phase transitions (SOFT_LOCK → LIVE_BATCHES,
 *                               LIVE_BATCHES → FINAL_SWEEP)
 *   - WebSocket BATCH_* events
 *
 * Does NOT:
 *   - Execute allocation rounds  → roundScheduler
 *   - Run evaluations            → evaluationScheduler
 *   - Contain business logic     → services / engine
 *
 * Reliability guarantee:
 *   All state is derived from the DB (batches, hostels tables).
 *   Timers are re-derived on startup — safe across restarts.
 * ============================================================
 */

import pool from '../../db/pool.js';
import { setCurrentPhase } from '../services/phase.service.js';
import { SYSTEM_PHASES } from '../constants/phases.js';
import { emit, WS_EVENTS } from '../websocket/emitter.js';

// Will be injected after import to avoid circular deps
let _roundScheduler = null;
let _evaluationScheduler = null;

export function injectDependencies({ roundScheduler, evaluationScheduler }) {
    _roundScheduler = roundScheduler;
    _evaluationScheduler = evaluationScheduler;
}

// Active timers: batchId → { startTimer, endTimer }
const _timers = new Map();

// ─────────────────────────────────────────────────────────
// STARTUP RECOVERY
// ─────────────────────────────────────────────────────────

/**
 * Called once on server boot.
 * Re-derives any in-flight batch state from the DB and
 * re-arms timers so a restart never loses work.
 */
export async function recoverOnBoot() {
    console.log('[batchScheduler] Recovering state from DB...');

    // 1. Resume any currently ACTIVE batch
    const activeRes = await pool.query(
        `SELECT b.*, h.current_phase, h.is_paused
         FROM batches b
         JOIN hostels h ON b.hostel_id = h.id
         WHERE b.status = 'ACTIVE'`
    );

    for (const batch of activeRes.rows) {
        const now = new Date();
        const end = new Date(batch.end_time);

        if (now >= end) {
            // Batch window already passed — close it immediately
            console.log(`[batchScheduler] Batch ${batch.batch_number} overdue, closing now`);
            await endBatch(batch.id);
        } else {
            // Re-arm end timer
            console.log(`[batchScheduler] Resuming active batch ${batch.batch_number}`);
            _armEndTimer(batch);

            // Let the round scheduler recover its own state
            if (_roundScheduler) {
                await _roundScheduler.recoverOnBoot(batch.id);
            }
        }
    }

    // 2. Arm start timers for all pending batches
    const pendingRes = await pool.query(
        `SELECT * FROM batches WHERE status = 'PENDING' ORDER BY start_time ASC`
    );

    for (const batch of pendingRes.rows) {
        _armStartTimer(batch);
    }

    console.log(
        `[batchScheduler] Recovery complete. ` +
        `Active: ${activeRes.rowCount}, Pending: ${pendingRes.rowCount}`
    );
}

// ─────────────────────────────────────────────────────────
// INTERNAL TIMER HELPERS
// ─────────────────────────────────────────────────────────

function _armStartTimer(batch) {
    const now = new Date();
    const start = new Date(batch.start_time);
    const delayMs = Math.max(0, start.getTime() - now.getTime());

    const existing = _timers.get(batch.id) || {};
    clearTimeout(existing.startTimer);

    existing.startTimer = setTimeout(async () => {
        try {
            await startBatch(batch.id);
        } catch (err) {
            console.error(`[batchScheduler] startBatch failed for ${batch.id}:`, err.message);
        }
    }, delayMs);

    _timers.set(batch.id, existing);
    console.log(
        `[batchScheduler] Start timer armed for batch ${batch.batch_number} in ${Math.round(delayMs / 1000)}s`
    );
}

function _armEndTimer(batch) {
    const now = new Date();
    const end = new Date(batch.end_time);
    const delayMs = Math.max(0, end.getTime() - now.getTime());

    const existing = _timers.get(batch.id) || {};
    clearTimeout(existing.endTimer);

    existing.endTimer = setTimeout(async () => {
        try {
            await endBatch(batch.id);
        } catch (err) {
            console.error(`[batchScheduler] endBatch failed for ${batch.id}:`, err.message);
        }
    }, delayMs);

    _timers.set(batch.id, existing);
    console.log(
        `[batchScheduler] End timer armed for batch ${batch.batch_number} in ${Math.round(delayMs / 1000)}s`
    );
}

// ─────────────────────────────────────────────────────────
// A. ACTIVATE BATCH
// ─────────────────────────────────────────────────────────

/**
 * Transition PENDING → ACTIVE.
 * Emits BATCH_STARTED, transitions hostel phase if this is
 * the first batch, then hands off to roundScheduler.
 */
export async function startBatch(batchId) {
    const batchRes = await pool.query(
        `UPDATE batches SET status = 'ACTIVE' WHERE id = $1 AND status = 'PENDING' RETURNING *`,
        [batchId]
    );

    if (batchRes.rowCount === 0) {
        console.warn(`[batchScheduler] startBatch: batch ${batchId} not found or not PENDING`);
        return;
    }

    const batch = batchRes.rows[0];
    console.log(`[batchScheduler] Batch ${batch.batch_number} activated`);

    // Transition hostel to LIVE_BATCHES if not already
    await transitionSystemPhase(batch.hostel_id, SYSTEM_PHASES.LIVE_BATCHES);

    // Arm the end timer
    _armEndTimer(batch);

    // Emit to all clients in this hostel's room
    emit(WS_EVENTS.BATCH_STARTED, {
        batchId: batch.id,
        batchNumber: batch.batch_number,
        hostelId: batch.hostel_id,
        startTime: batch.start_time,
        endTime: batch.end_time,
    }, batch.hostel_id);

    // Hand off to round scheduler to begin Round 1
    if (_roundScheduler) {
        await _roundScheduler.startRoundCycle(batchId);
    }
}

// ─────────────────────────────────────────────────────────
// B. CLOSE BATCH
// ─────────────────────────────────────────────────────────

/**
 * Transition ACTIVE → COMPLETED.
 * Stops submissions, emits BATCH_ENDED, triggers evaluations.
 */
export async function endBatch(batchId) {
    const batchRes = await pool.query(
        `UPDATE batches SET status = 'COMPLETED' WHERE id = $1 AND status = 'ACTIVE' RETURNING *`,
        [batchId]
    );

    if (batchRes.rowCount === 0) {
        console.warn(`[batchScheduler] endBatch: batch ${batchId} not found or not ACTIVE`);
        return;
    }

    const batch = batchRes.rows[0];
    console.log(`[batchScheduler] Batch ${batch.batch_number} completed`);

    // Clear timers
    const timers = _timers.get(batchId);
    if (timers) {
        clearTimeout(timers.startTimer);
        clearTimeout(timers.endTimer);
        _timers.delete(batchId);
    }

    // Stop round scheduler for this batch
    if (_roundScheduler) {
        _roundScheduler.stopRoundCycle(batchId);
    }

    emit(WS_EVENTS.BATCH_ENDED, {
        batchId: batch.id,
        batchNumber: batch.batch_number,
        hostelId: batch.hostel_id,
    }, batch.hostel_id);

    // Trigger post-batch evaluations (rollover, penalties, shatter)
    if (_evaluationScheduler) {
        await _evaluationScheduler.runPostBatchEvaluation(batchId, batch.hostel_id);
    }

    // Try to activate the next queued batch
    await activateNextBatch(batch.hostel_id, batch.batch_number);
}

// ─────────────────────────────────────────────────────────
// C. QUEUE NEXT BATCH
// ─────────────────────────────────────────────────────────

/**
 * Find the next PENDING batch for the hostel and arm its timer.
 * If none exists, transition to FINAL_SWEEP.
 */
export async function activateNextBatch(hostelId, completedBatchNumber) {
    const nextRes = await pool.query(
        `SELECT * FROM batches
         WHERE hostel_id = $1
           AND status = 'PENDING'
           AND batch_number > $2
         ORDER BY batch_number ASC
         LIMIT 1`,
        [hostelId, completedBatchNumber]
    );

    if (nextRes.rowCount === 0) {
        console.log(`[batchScheduler] No more pending batches for hostel ${hostelId}. Transitioning to FINAL_SWEEP.`);
        await transitionSystemPhase(hostelId, SYSTEM_PHASES.FINAL_SWEEP);

        // evaluationScheduler handles final sweep after this
        if (_evaluationScheduler) {
            await _evaluationScheduler.scheduleFinalsweep(hostelId);
        }
        return;
    }

    const nextBatch = nextRes.rows[0];
    console.log(`[batchScheduler] Next batch ${nextBatch.batch_number} queued`);

    emit(WS_EVENTS.NEXT_BATCH_READY, {
        batchId: nextBatch.id,
        batchNumber: nextBatch.batch_number,
        hostelId: nextBatch.hostel_id,
        startTime: nextBatch.start_time,
    }, hostelId);

    _armStartTimer(nextBatch);
}

// ─────────────────────────────────────────────────────────
// D. HOSTEL PHASE TRANSITIONS
// ─────────────────────────────────────────────────────────

/**
 * Safely transition hostel phase.
 * No-ops if already in target phase (idempotent for recovery).
 */
export async function transitionSystemPhase(hostelId, targetPhase) {
    try {
        const hostelRes = await pool.query(
            `SELECT current_phase FROM hostels WHERE id = $1`,
            [hostelId]
        );

        if (hostelRes.rows[0]?.current_phase === targetPhase) {
            return; // Already correct — no-op
        }

        await setCurrentPhase(hostelId, targetPhase);
        console.log(`[batchScheduler] Hostel ${hostelId} → ${targetPhase}`);

        emit(WS_EVENTS.PHASE_CHANGED, { hostelId, phase: targetPhase }, hostelId);
    } catch (err) {
        // Log but don't crash — phase may already be correct after restart
        console.warn(`[batchScheduler] transitionSystemPhase warning: ${err.message}`);
    }
}

/**
 * Manually enqueue a batch (for admin use or testing).
 * Creates start/end timers immediately.
 */
export async function scheduleBatch(batchId) {
    const res = await pool.query(`SELECT * FROM batches WHERE id = $1`, [batchId]);
    if (res.rowCount === 0) throw new Error(`Batch ${batchId} not found`);
    _armStartTimer(res.rows[0]);
}
