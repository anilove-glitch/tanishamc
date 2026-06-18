/**
 * phaseCache.js
 *
 * Key conventions:
 *   phase:{hostelId}   — hostel phase + pause state record
 *
 * NOTE: Phase changes are low-frequency but critical for routing logic.
 * Use a shorter TTL (300 s = 5 min) as a safety net since a wrong cached
 * phase could block/allow student actions incorrectly.
 * Active invalidation on every phase write keeps this fresh regardless.
 */

import { getCache, setCache, deleteCache } from './cache.service.js';

const TTL = 300; // 5 minutes — tighter safety net for phase data

const key = (hostelId) => `phase:${hostelId}`;

export async function getPhase(hostelId) {
    return getCache(key(hostelId));
}

export async function setPhase(hostelId, phase) {
    return setCache(key(hostelId), phase, TTL);
}

export async function invalidatePhase(hostelId) {
    return deleteCache(key(hostelId));
}
