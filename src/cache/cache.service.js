/**
 * cache.service.js
 *
 * The ONLY file in the codebase that talks directly to the Redis client.
 * All other cache helpers import from here.
 *
 * Design rules:
 *  - Fail-open: every Redis op is try/caught so a Redis failure
 *    just returns null / no-ops and the caller falls through to Postgres.
 *  - JSON serialisation is handled here; callers work with plain JS values.
 *  - Default TTL = 86400 s (24 h) — a safety net, not the primary freshness
 *    mechanism.  Active invalidation on writes is what keeps data fresh.
 */

import redisClient from '../config/redis.js';

const DEFAULT_TTL = 86400; // 24 hours in seconds

// ─── Primitive ops ────────────────────────────────────────────────────────────

/**
 * Fetch a cached value.  Returns null on miss or any Redis error.
 * @param {string} key
 * @returns {Promise<any|null>}
 */
export async function getCache(key) {
    try {
        const raw = await redisClient.get(key);
        if (raw === null || raw === undefined) return null;
        return JSON.parse(raw);
    } catch (err) {
        console.warn(`[cache] GET "${key}" failed — falling back to Postgres:`, err.message);
        return null;
    }
}

/**
 * Store a value in Redis with an optional TTL.
 * @param {string} key
 * @param {any}    value   — will be JSON-stringified
 * @param {number} [ttl]   — seconds; defaults to DEFAULT_TTL
 */
export async function setCache(key, value, ttl = DEFAULT_TTL) {
    try {
        const serialized = JSON.stringify(value);
        await redisClient.set(key, serialized, { EX: ttl });
    } catch (err) {
        console.warn(`[cache] SET "${key}" failed — cache not updated:`, err.message);
    }
}

/**
 * Delete a specific key.  No-ops silently on error.
 * @param {string} key
 */
export async function deleteCache(key) {
    try {
        await redisClient.del(key);
    } catch (err) {
        console.warn(`[cache] DEL "${key}" failed:`, err.message);
    }
}

/**
 * Bulk-delete all keys matching a glob pattern (e.g. "rooms:*").
 * Uses SCAN so it does not block the Redis event loop.
 * @param {string} pattern
 */
export async function deletePattern(pattern) {
    try {
        let cursor = 0;
        do {
            const reply = await redisClient.scan(cursor, { MATCH: pattern, COUNT: 100 });
            cursor = reply.cursor;
            if (reply.keys.length > 0) {
                await redisClient.del(reply.keys);
            }
        } while (cursor !== 0);
    } catch (err) {
        console.warn(`[cache] deletePattern "${pattern}" failed:`, err.message);
    }
}

/**
 * Check whether a key exists in Redis.
 * Returns false on any Redis error (fail-open).
 * @param {string} key
 * @returns {Promise<boolean>}
 */
export async function exists(key) {
    try {
        const count = await redisClient.exists(key);
        return count > 0;
    } catch (err) {
        console.warn(`[cache] EXISTS "${key}" failed:`, err.message);
        return false;
    }
}
