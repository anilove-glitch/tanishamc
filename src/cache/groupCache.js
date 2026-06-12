/**
 * groupCache.js
 *
 * Key conventions:
 *   group:{groupId}          — core group record (from v_housing_group_with_size)
 *   groupmembers:{groupId}   — array of student member rows
 */

import { getCache, setCache, deleteCache } from './cache.service.js';

const TTL = 86400; // 24 h

const keys = {
    group:   (groupId) => `group:${groupId}`,
    members: (groupId) => `groupmembers:${groupId}`,
};

// ── Group record ──────────────────────────────────────────

export async function getGroup(groupId) {
    return getCache(keys.group(groupId));
}

export async function setGroup(groupId, data) {
    return setCache(keys.group(groupId), data, TTL);
}

export async function invalidateGroup(groupId) {
    return deleteCache(keys.group(groupId));
}

// ── Member list ───────────────────────────────────────────

export async function getMembers(groupId) {
    return getCache(keys.members(groupId));
}

export async function setMembers(groupId, members) {
    return setCache(keys.members(groupId), members, TTL);
}

export async function invalidateMembers(groupId) {
    return deleteCache(keys.members(groupId));
}
