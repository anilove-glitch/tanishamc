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
 *   TEST_MODE=true         — 30s rounds, 3-min batches (see constants/testConfig.js)
 *   FINAL_SWEEP_AT_ISO     — (removed) final sweep is now event-driven
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

    // roundScheduler needs evaluationScheduler for:
    //   - shatter check at the start of each new round
    //   - rank recalculation at the end of each round
    roundScheduler.injectEvaluationScheduler(evaluationScheduler);

    // Run DB-driven recovery for any in-flight state
    await batchScheduler.recoverOnBoot();

    console.log('[schedulers] All schedulers initialized');
}

// Re-export individual schedulers for direct use in routes/admin
export { batchScheduler, roundScheduler, evaluationScheduler };
