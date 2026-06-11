/**
 * phase.service.js
 * Single source of truth for all hostel phase orchestration.
 * Move updateHostelPhase() from room.service.js lives here.
 *
 * Phases (system_phase_enum):
 *   LOBBY        → students form groups, no submissions
/**
 * phase.service.js
 * Single source of truth for all hostel phase orchestration.
 * Move updateHostelPhase() from room.service.js lives here.
 *
 * Phases (system_phase_enum):
 *   LOBBY        → students form groups, no submissions
 *   SOFT_LOCK    → groups lock, no new members
 *   LIVE_BATCHES → active batch allocation rounds
 *   FINAL_SWEEP  → leftover assignment pass
 *   ADMIN_MODE   → locked for admin use only
 */

import pool from '../../db/pool.js';
import { SYSTEM_PHASES } from '../constants/phases.js';
import { assignGroupsToBatches } from './softLock.service.js';
import ApiError from '../../utils/apiError.js';
import { getPhase, setPhase, invalidatePhase } from '../../cache/phaseCache.js';

// Valid phase transitions
const VALID_TRANSITIONS = {
    [SYSTEM_PHASES.ADMIN_MODE]:   [SYSTEM_PHASES.LOBBY],
    [SYSTEM_PHASES.LOBBY]:        [SYSTEM_PHASES.SOFT_LOCK, SYSTEM_PHASES.ADMIN_MODE],
    [SYSTEM_PHASES.SOFT_LOCK]:    [SYSTEM_PHASES.LIVE_BATCHES, SYSTEM_PHASES.LOBBY, SYSTEM_PHASES.ADMIN_MODE],
    [SYSTEM_PHASES.LIVE_BATCHES]: [SYSTEM_PHASES.FINAL_SWEEP, SYSTEM_PHASES.ADMIN_MODE],
    [SYSTEM_PHASES.FINAL_SWEEP]:  [SYSTEM_PHASES.ADMIN_MODE],
};

// ─────────────────────────────────────────────────────────
// READ
// ─────────────────────────────────────────────────────────

/**
 * Get current phase + pause state for a hostel.
 *
 * Cache pattern:
 *   1. Check Redis  →  hit: return immediately
 *   2. Miss / error →  query Postgres, populate cache (5 min TTL), return row
 */
export const getCurrentPhase = async (hostelId) => {
    // 1. Redis read
    const cached = await getPhase(hostelId);
    if (cached !== null) {
        console.log(`[cache] HIT  phase:${hostelId}`);
        return cached;
    }

    // 2. Postgres fallback
    console.log(`[cache] MISS phase:${hostelId} — querying Postgres`);
    const result = await pool.query(
        `SELECT id, name, current_phase, is_paused FROM hostel WHERE id = $1`,
        [hostelId]
    );
    if (result.rows.length === 0) throw new ApiError(404, 'Hostel not found');

    // 3. Populate cache
    await setPhase(hostelId, result.rows[0]);
    return result.rows[0];
};

// ─────────────────────────────────────────────────────────
// WRITE
// ─────────────────────────────────────────────────────────

/**
 * Transition hostel to a new phase.
 * Validates the transition is legal before applying.
 */
export const setCurrentPhase = async (hostelId, newPhase) => {
    const hostel = await getCurrentPhase(hostelId);

    if (!Object.values(SYSTEM_PHASES).includes(newPhase)) {
        throw new ApiError(400, `Invalid phase: ${newPhase}`);
    }

    const allowed = VALID_TRANSITIONS[hostel.current_phase] || [];
    if (!allowed.includes(newPhase)) {
        throw new ApiError(400,
            `Cannot transition from ${hostel.current_phase} → ${newPhase}. ` +
            `Allowed: ${allowed.join(', ') || 'none'}`
        );
    }

    const result = await pool.query(
        `UPDATE hostel SET current_phase = $1 WHERE id = $2 RETURNING *`,
        [newPhase, hostelId]
    );

    // Side-effects: run batch assignment when entering SOFT_LOCK
    if (hostel.current_phase === SYSTEM_PHASES.LOBBY && newPhase === SYSTEM_PHASES.SOFT_LOCK) {
        try {
            await assignGroupsToBatches(hostelId);
            // Newly created pending batches must be armed immediately,
            // otherwise they stay PENDING forever until next server restart.
            const pendingRes = await pool.query(
                `SELECT id FROM batch WHERE hostel_id = $1 AND status = 'PENDING' ORDER BY start_time ASC`,
                [hostelId]
            );
            const { scheduleBatch } = await import('../schedulers/batchScheduler.js');
            for (const row of pendingRes.rows) {
                await scheduleBatch(row.id);
            }
        } catch (err) {
            // Log but don't roll back the phase change — admin can retry batch assignment
            console.error('[phase.service] softLock batch assignment error:', err.message);
        }
    }

    // Invalidate phase cache so next read reflects the new phase
    await invalidatePhase(hostelId);

    return result.rows[0];
};

/**
 * Pause allocation without changing phase.
 * All submission guards check is_paused first.
 */
export const pauseAllocation = async (hostelId) => {
    const result = await pool.query(
        `UPDATE hostel SET is_paused = TRUE WHERE id = $1 RETURNING id, name, current_phase, is_paused`,
        [hostelId]
    );
    if (result.rows.length === 0) throw new ApiError(404, 'Hostel not found');
    await invalidatePhase(hostelId);
    return result.rows[0];
};

/**
 * Resume allocation
 */
export const resumeAllocation = async (hostelId) => {
    const result = await pool.query(
        `UPDATE hostel SET is_paused = FALSE WHERE id = $1 RETURNING id, name, current_phase, is_paused`,
        [hostelId]
    );
    if (result.rows.length === 0) throw new ApiError(404, 'Hostel not found');
    await invalidatePhase(hostelId);
    return result.rows[0];
};

// ─────────────────────────────────────────────────────────
// VALIDATORS  (used as middleware or inside services)
// ─────────────────────────────────────────────────────────

/**
 * Assert hostel is in a specific phase (or one of many phases).
 * Throws ApiError if not. Use inside service methods.
 */
export const validatePhase = async (hostelId, requiredPhase) => {
    const hostel = await getCurrentPhase(hostelId);

    if (hostel.is_paused) {
        throw new ApiError(503, 'Allocation system is currently paused');
    }

    const required = Array.isArray(requiredPhase) ? requiredPhase : [requiredPhase];
    if (!required.includes(hostel.current_phase)) {
        throw new ApiError(400,
            `Operation not allowed in phase ${hostel.current_phase}. ` +
            `Required: ${required.join(' or ')}`
        );
    }

    return hostel;
};

// ─────────────────────────────────────────────────────────
// PHASE-SPECIFIC GUARDS  (use in route middleware)
// ─────────────────────────────────────────────────────────

/** Groups can be created/joined only in LOBBY */
export const canModifyGroups = async (hostelId) =>
    validatePhase(hostelId, SYSTEM_PHASES.LOBBY);

/** Preferences can be submitted only during LIVE_BATCHES */
export const canSubmitPreferences = async (hostelId) =>
    validatePhase(hostelId, SYSTEM_PHASES.LIVE_BATCHES);

/** Groups can be locked during SOFT_LOCK or LIVE_BATCHES */
export const canLockGroups = async (hostelId) =>
    validatePhase(hostelId, [SYSTEM_PHASES.SOFT_LOCK, SYSTEM_PHASES.LIVE_BATCHES]);

/** Convenience: returns true/false without throwing */
export const isPhase = async (hostelId, phase) => {
    try {
        await validatePhase(hostelId, phase);
        return true;
    } catch {
        return false;
    }
};

/**
 * Admin override is allowed any time EXCEPT during LIVE_BATCHES.
 * Throws ApiError(403) if allocation is currently running.
 */
export const canAdminOverride = async (hostelId) => {
    const hostel = await getCurrentPhase(hostelId);
    if (hostel.current_phase === SYSTEM_PHASES.LIVE_BATCHES) {
        throw new ApiError(403,
            'Admin override is disabled during LIVE_BATCHES. ' +
            'Wait until allocation completes or pause the system first.'
        );
    }
    return hostel;
};
