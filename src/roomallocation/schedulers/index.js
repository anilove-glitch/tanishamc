/**
 * index.js — Scheduler bootstrap
 * ============================================================
 * Wires all three schedulers together and runs boot recovery.
 *
 * Usage in server entry point:
 *
 *   import { initSchedulers } from './src/roomallocation/schedulers/index.js';
 *   import { initEmitter }    from './src/roomallocation/websocket/emitter.js';
 *
 *   const io = new Server(httpServer);
 *   initEmitter(io);
 *   await initSchedulers();
 *
 * Env vars:
 *   ROUND_DURATION_MS     — override 10-min round (default: 600000)
 *   FINAL_SWEEP_AT_ISO    — ISO timestamp for final sweep
 *   FINAL_SWEEP_DELAY_MS  — fallback delay after last batch (default: 1800000)
 * ============================================================
 */

import * as batchScheduler      from './batchScheduler.js';
import * as roundScheduler      from './roundScheduler.js';
import * as evaluationScheduler from './evaluationScheduler.js';

/**
 * Call once after DB connection and WebSocket emitter are ready.
 */
export async function initSchedulers() {
    // Inject cross-scheduler dependencies (avoids circular imports)
    batchScheduler.injectDependencies({
        roundScheduler,
        evaluationScheduler,
    });

    // Run DB-driven recovery for any in-flight state
    await batchScheduler.recoverOnBoot();

    console.log('[schedulers] All schedulers initialized');
}

// Re-export individual schedulers for direct use in routes/admin
export { batchScheduler, roundScheduler, evaluationScheduler };
