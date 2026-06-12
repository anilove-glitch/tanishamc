/**
 * emitter.js - Realtime event emitter (Pusher Channels)
 * ============================================================
 * Thin wrapper so schedulers can broadcast events without
 * knowing the underlying transport implementation.
 *
 * Call initEmitter() once at server startup, then import
 * emit() anywhere in the scheduler layer.
 * ============================================================
 */
import Pusher from 'pusher';

const GLOBAL_CHANNEL = 'allocation-global';

let _pusher = null;

function _toHostelChannel(room) {
    return `hostel-${room}`;
}

/**
 * Call this once when environment configuration is ready.
 */
export function initEmitter() {
    const appId = process.env.PUSHER_APP_ID;
    const key = process.env.PUSHER_KEY;
    const secret = process.env.PUSHER_SECRET;
    const cluster = process.env.PUSHER_CLUSTER;

    if (!appId || !key || !secret || !cluster) {
        console.warn('[WS] Missing PUSHER_* env vars. Realtime events will be dropped.');
        _pusher = null;
        return;
    }

    _pusher = new Pusher({
        appId,
        key,
        secret,
        cluster,
        useTLS: true
    });
}

/**
 * Broadcast an event to the global channel or one hostel channel.
 *
 * @param {string} event   - Event name, e.g. 'BATCH_STARTED'
 * @param {object} payload - Data to send
 * @param {string} [room]  - Optional hostel room id (e.g. hostelId)
 */
export function emit(event, payload, room) {
    if (!_pusher) {
        console.warn(`[WS] Emitter not initialized - dropped event: ${event}`);
        return;
    }

    const channel = room ? _toHostelChannel(room) : GLOBAL_CHANNEL;
    const message = { event, ...payload, ts: new Date().toISOString() };

    // Fire-and-forget: scheduler flow must continue even if realtime fails.
    _pusher.trigger(channel, event, message).catch((error) => {
        console.error(`[WS] Failed to publish "${event}" on "${channel}": ${error.message}`);
    });
}

// Named event helpers
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
