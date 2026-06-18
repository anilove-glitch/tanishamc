/**
 * locking.js — Concurrency Control Layer
 * ============================================================
 * Centralised row-locking and transaction management for the
 * allocation engine. Every allocation operation that touches
 * the DB must go through this module.
 *
 * Rules enforced here:
 *  1. Rooms are ALWAYS locked in sorted (ASC) order
 *     → eliminates deadlocks when multiple submissions
 *       compete for overlapping room sets.
 *  2. Transactions are retried automatically on deadlock
 *     (PG error 40P01) and serialisation failure (40001).
 *  3. withTransaction() is the ONLY way to open a client
 *     connection from the engine layer.
 * ============================================================
 */

import pool from '../../db/pool.js';

const IS_TEST     = process.env.NODE_ENV === 'test';
const MAX_RETRIES  = IS_TEST ? 1 : 3;
const RETRY_BASE_MS = IS_TEST ? 20 : 80; // exponential back-off base

// ─────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableError(err) {
    return err.code === '40P01' // deadlock detected
        || err.code === '40001'; // serialisation failure
}

// ─────────────────────────────────────────────────────────
// TRANSACTION WRAPPER
// ─────────────────────────────────────────────────────────

/**
 * Executes `callback(client)` inside a BEGIN/COMMIT block.
 * Automatically retries on deadlock / serialisation failure.
 *
 * @template T
 * @param {(client: import('pg').PoolClient) => Promise<T>} callback
 * @param {{ retries?: number, isolationLevel?: string }} options
 * @returns {Promise<T>}
 *
 * Usage:
 *   const result = await withTransaction(async (client) => {
 *       const room = await lockRoom(client, roomId);
 *       // ... mutations ...
 *       return result;
 *   });
 */
export async function withTransaction(callback, {
    retries = MAX_RETRIES,
    isolationLevel = 'READ COMMITTED',
} = {}) {
    let attempt = 0;

    while (true) {
        const client = await pool.connect();
        try {
            await client.query(`BEGIN ISOLATION LEVEL ${isolationLevel}`);
            const result = await callback(client);
            // Force deferred constraints to fire NOW (inside the transaction)
            // so any trigger exceptions are caught here rather than at COMMIT,
            // where they would cause a silent rollback from the caller's view.
            await client.query('SET CONSTRAINTS ALL IMMEDIATE');
            await client.query('COMMIT');
            return result;

        } catch (err) {
            await client.query('ROLLBACK').catch(() => {}); // safe rollback

            if (isRetryableError(err) && attempt < retries) {
                attempt++;
                const backoff = RETRY_BASE_MS * Math.pow(2, attempt - 1);
                await sleep(backoff + Math.random() * 30); // jitter
                continue;
            }

            throw err; // propagate non-retryable or exhausted errors
        } finally {
            client.release();
        }
    }
}

// ─────────────────────────────────────────────────────────
// SINGLE ROW LOCKS
// ─────────────────────────────────────────────────────────

/**
 * Lock a single room row FOR UPDATE within an open transaction.
 * Returns the fresh room record, or null if not found.
 *
 * NEVER trust occupancy from a previous read — always use this.
 *
 * @param {import('pg').PoolClient} client
 * @param {string} roomId UUID
 * @returns {Promise<object|null>}
 */
export async function lockRoom(client, roomId) {
    const res = await client.query(
        `SELECT id, hostel_id, room_number, room_type, max_capacity, current_occupancy
         FROM room
         WHERE id = $1
         FOR UPDATE`,
        [roomId]
    );
    return res.rowCount > 0 ? res.rows[0] : null;
}

/**
 * Lock a group row FOR UPDATE within an open transaction.
 * Prevents concurrent leader changes, dissolves, or shatters.
 *
 * @param {import('pg').PoolClient} client
 * @param {string} groupId UUID
 * @returns {Promise<object|null>}
 */
export async function lockGroup(client, groupId) {
    const res = await client.query(
        `SELECT id, primary_applicant_id, group_rank, status, rollover_count, is_rollover_priority, batch_id
         FROM housing_group
         WHERE id = $1
         FOR UPDATE`,
        [groupId]
    );
    return res.rowCount > 0 ? res.rows[0] : null;
}

// ─────────────────────────────────────────────────────────
// ORDERED MULTI-ROW LOCKING
// ─────────────────────────────────────────────────────────

/**
 * Lock multiple rooms in deterministic ascending UUID order.
 * This is the ONLY safe way to lock multiple rooms at once.
 *
 * Acquiring locks in the same order across all transactions
 * is the canonical way to prevent deadlocks.
 *
 * @param {import('pg').PoolClient} client
 * @param {string[]} roomIds  Array of UUIDs (duplicates OK, deduped internally)
 * @returns {Promise<Map<string, object>>} roomId → room record
 */
export async function lockRoomsInOrder(client, roomIds) {
    if (!roomIds || roomIds.length === 0) return new Map();

    // Deduplicate and sort — deterministic order is mandatory
    const sorted = [...new Set(roomIds)].sort();

    const res = await client.query(
        `SELECT id, hostel_id, room_number, room_type, max_capacity, current_occupancy
         FROM room
         WHERE id = ANY($1::uuid[])
         ORDER BY id ASC
         FOR UPDATE`,
        [sorted]
    );

    const map = new Map();
    for (const row of res.rows) {
        map.set(row.id, row);
    }
    return map;
}

/**
 * Lock multiple student rows FOR UPDATE.
 * Used when modifying is_allotted, allocated_room_id, group_id.
 *
 * @param {import('pg').PoolClient} client
 * @param {number[]} studentIds
 * @returns {Promise<object[]>}
 */
export async function lockStudents(client, studentIds) {
    if (!studentIds || studentIds.length === 0) return [];

    const sorted = [...new Set(studentIds)].sort((a, b) => a - b);

    const res = await client.query(
        `SELECT id, name, roll_no, group_id, is_allotted, allocated_room_id, individual_rank
         FROM student
         WHERE id = ANY($1::int[])
         ORDER BY id ASC
         FOR UPDATE`,
        [sorted]
    );
    return res.rows;
}
