/**
 * preferenceCache.js
 *
 * Key conventions:
 *   preferences:{groupId}   — a group's submitted room preference list
 */

import { getCache, setCache, deleteCache } from './cache.service.js';

const TTL = 86400; // 24 h

const key = (groupId) => `preferences:${groupId}`;

export async function getPreferences(groupId) {
    return getCache(key(groupId));
}

export async function setPreferences(groupId, preferences) {
    return setCache(key(groupId), preferences, TTL);
}

export async function invalidatePreferences(groupId) {
    return deleteCache(key(groupId));
}
