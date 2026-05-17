/**
 * emitter.js — WebSocket event emitter
 * ============================================================
 * Thin wrapper so schedulers can broadcast events without
 * knowing the underlying Socket.IO / ws implementation.
 *
 * Call initEmitter(io) once at server startup, then import
 * emit() anywhere in the scheduler layer.
 * ============================================================
 */

let _io = null;

/**
 * Call this once when the HTTP/WS server is ready.
 * @param {import('socket.io').Server} io
 */
export function initEmitter(io) {
    _io = io;
}

/**
 * Broadcast an event to all connected clients (or a room).
 *
 * @param {string} event   - Event name, e.g. 'BATCH_STARTED'
 * @param {object} payload - Data to send
 * @param {string} [room]  - Optional Socket.IO room (e.g. hostelId)
 */
export function emit(event, payload, room) {
    if (!_io) {
        console.warn(`[WS] Emitter not initialized — dropped event: ${event}`);
        return;
    }
    const target = room ? _io.to(room) : _io;
    target.emit(event, { event, ...payload, ts: new Date().toISOString() });
}

// ─── Named event helpers ──────────────────────────────────

export const WS_EVENTS = {
    BATCH_STARTED:     'BATCH_STARTED',
    BATCH_ENDED:       'BATCH_ENDED',
    NEXT_BATCH_READY:  'NEXT_BATCH_READY',
    ROUND_FROZEN:      'ROUND_FROZEN',
    ROUND_EXECUTED:    'ROUND_EXECUTED',
    ROUND_OPENED:      'ROUND_OPENED',
    ROUND_CYCLE_DONE:  'ROUND_CYCLE_DONE',
    ROOM_MAP_UPDATED:  'ROOM_MAP_UPDATED',
    EVALUATION_DONE:   'EVALUATION_DONE',
    PHASE_CHANGED:     'PHASE_CHANGED',
    SYSTEM_PAUSED:     'SYSTEM_PAUSED',
    SYSTEM_RESUMED:    'SYSTEM_RESUMED',
};
