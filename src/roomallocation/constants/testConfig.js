/**
 * testConfig.js — Central timing constants
 * ============================================================
 * Set TEST_MODE=true in your .env (or shell) to collapse all
 * timing to fast values suitable for test scripts.
 *
 * Production:   round = 10 min, batch = 60 min, 6 rounds
 * TEST_MODE:    round = 30 sec, batch = 3 min,  6 rounds
 * ============================================================
 */

export const TEST_MODE = process.env.TEST_MODE === 'true';

/** Duration of one round window (submissions open period). */
export const ROUND_DURATION_MS = TEST_MODE
    ? 30_000      // 30 seconds (test)
    : 600_000;    // 10 minutes (production)

/** Total batch duration = MAX_ROUNDS × ROUND_DURATION_MS */
export const BATCH_DURATION_MS = TEST_MODE
    ? 180_000     // 3 minutes  (test:  6 × 30s)
    : 3_600_000;  // 60 minutes (prod:  6 × 10min)

/** Number of rounds per batch — never changes. */
export const MAX_ROUNDS = 6;

/** Number of groups (leaders) per batch. */
export const BATCH_SIZE = 50;

if (TEST_MODE) {
    console.log('[testConfig] ⚠️  TEST_MODE active — round=30s, batch=3min, 6 rounds');
}
