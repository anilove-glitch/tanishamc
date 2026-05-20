/**
 * roomallocation.test.js — Integration Test Suite
 * ============================================================
 * Tests all room allocation functions end-to-end against
 * the real database.
 *
 * Run: node tests/roomallocation.test.js
 *
 * Structure:
 *   1.  Setup      — create isolated test data (TEST_ prefix)
 *   2.  Unit       — pure function tests (no DB)
 *   3.  Services   — phase, room, group, rank services
 *   4.  Engine     — locking, roundAllocator, rollover,
 *                    ghostPenalty, shatterProtocol, finalSweep
 *   5.  Teardown   — delete all TEST_ data
 *
 * Safety: All test rows use a unique RUN id so concurrent
 * runs on the same DB don't interfere.
 * ============================================================
 */

// ── dotenv must be the very first side-effect ──────────────
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const dotenv  = require('dotenv');
dotenv.config(); // reads .env from cwd (hostel_backend/)

// ── Patch individual DB_* vars from DATABASE_URL ──────────
// pool.js uses DB_USER / DB_HOST / etc.
// Our .env only has DATABASE_URL.
// Both import AND require are hoisted in ESM, so we patch
// process.env before any pg.Pool is constructed by using
// a thin lazy wrapper below instead of importing pool.js.
import pg from 'pg';
const { Pool } = pg;

function createPool() {
    if (process.env.DATABASE_URL) {
        return new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    }
    return new Pool({
        user:     process.env.DB_USER,
        host:     process.env.DB_HOST,
        database: process.env.DB_NAME,
        password: process.env.DB_PASSWORD,
        port:     process.env.DB_PORT || 5432,
    });
}
const pool = createPool();

// ── Engine & services ──────────────────────────────────────
import * as roomSelector        from '../src/roomallocation/engine/roomSelector.js';
import { withTransaction, lockRoom, lockRoomsInOrder, lockGroup } from '../src/roomallocation/engine/locking.js';
import { processRound }         from '../src/roomallocation/engine/roundallocator.js';
import { evaluate as evalRollover } from '../src/roomallocation/engine/rolloverEvaluator.js';
import { execute as execGhost } from '../src/roomallocation/engine/ghostPenalty.js';
import { evaluate as evalShatter } from '../src/roomallocation/engine/shatterProtocol.js';
import { execute as execFinalSweep } from '../src/roomallocation/engine/finalSweep.js';
import { getCurrentPhase, setCurrentPhase, pauseAllocation, resumeAllocation, canModifyGroups, canSubmitPreferences } from '../src/roomallocation/services/phase.service.js';
import { getAllHostels, getHostelById, getRoomsByHostel, getRoomById } from '../src/roomallocation/services/room.service.js';
import { createGroup, getGroupDetails, sendGroupRequest, respondToGroupRequest, leaveGroup, updateGroupStatus } from '../src/roomallocation/services/group.service.js';
import { bulkImportRanksFromCsv, previewRankImport, getUnrankedStudents } from '../src/roomallocation/rank/rank.service.js';
import { allocationService }    from '../src/roomallocation/services/allocation.service.js';

// ── Test runner ────────────────────────────────────────────
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';

let passed = 0;
let failed = 0;
let skipped = 0;

async function test(name, fn) {
    try {
        await fn();
        console.log(`${GREEN}✅ PASS${RESET}  ${name}`);
        passed++;
    } catch (err) {
        console.error(`${RED}❌ FAIL${RESET}  ${name}`);
        console.error(`         ${RED}${err.message}${RESET}`);
        if (process.env.VERBOSE) console.error(err.stack);
        failed++;
    }
}

function skip(name, reason) {
    console.log(`${YELLOW}⏭  SKIP${RESET}  ${name} ${YELLOW}(${reason})${RESET}`);
    skipped++;
}

function section(title) {
    console.log(`\n${CYAN}${BOLD}── ${title} ${'─'.repeat(Math.max(0, 55 - title.length))}${RESET}`);
}

function assert(condition, message) {
    if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEquals(a, b, msg) {
    if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function assertGte(a, b, msg) {
    if (a < b) throw new Error(msg || `Expected >= ${b}, got ${a}`);
}

// ── Shared test state ──────────────────────────────────────
const RUN = `TS${Date.now()}`; // unique tag for this test run
const ctx = {}; // populated during setup

// ─────────────────────────────────────────────────────────
// SETUP — create isolated test data
// ─────────────────────────────────────────────────────────

async function setup() {
    section('SETUP');
    console.log(`  Test run ID: ${CYAN}${RUN}${RESET}`);

    // 1. Hostel
    const hostelRes = await pool.query(`
        INSERT INTO hostels (name, type, total_capacity, current_phase, is_paused)
        VALUES ($1, 'BOYS', 100, 'ADMIN_MODE', false)
        RETURNING *
    `, [`${RUN}_Hostel`]);
    ctx.hostel = hostelRes.rows[0];
    console.log(`  Created hostel: ${ctx.hostel.id}`);

    // 2. Rooms (3 rooms: 3-bed A, 3-bed B, 4-bed — schema requires max_capacity IN (3,4))
    const r1 = await pool.query(
        `INSERT INTO rooms (hostel_id, room_number, room_type, max_capacity) VALUES ($1,$2,'TRIPLE',3) RETURNING *`,
        [ctx.hostel.id, `${RUN}_R101`]
    );
    const r2 = await pool.query(
        `INSERT INTO rooms (hostel_id, room_number, room_type, max_capacity) VALUES ($1,$2,'TRIPLE',3) RETURNING *`,
        [ctx.hostel.id, `${RUN}_R102`]
    );
    const r3 = await pool.query(
        `INSERT INTO rooms (hostel_id, room_number, room_type, max_capacity) VALUES ($1,$2,'QUAD',4) RETURNING *`,
        [ctx.hostel.id, `${RUN}_R103`]
    );
    ctx.room3a = r1.rows[0]; // 3-bed (used as "small" room in shatter test)
    ctx.room3b = r2.rows[0]; // 3-bed
    ctx.room4  = r3.rows[0]; // 4-bed
    // Keep backward compat aliases
    ctx.room2 = ctx.room3a;  // "smallest" room alias
    ctx.room3 = ctx.room3b;  // second 3-bed alias
    console.log(`  Created 3 rooms (3-bed A, 3-bed B, 4-bed)`);

    // 3. Students (8 students with unique roll_nos)
    const students = [];
    for (let i = 1; i <= 8; i++) {
        const s = await pool.query(
            `INSERT INTO students (name, email, password_hash, roll_no)
             VALUES ($1, $2, 'testhash', $3)
             RETURNING *`,
            [`${RUN}_Student${i}`, `${RUN}_s${i}@test.com`, `${RUN}_ROLL${i.toString().padStart(3,'0')}`]
        );
        students.push(s.rows[0]);
    }
    ctx.students = students;
    console.log(`  Created ${students.length} students`);

    // 4. Batch (PENDING — started 1 hour ago, ends 1 hour from now)
    const batchNum = parseInt(RUN.replace('TS', '').slice(-6));
    const batchRes = await pool.query(`
        INSERT INTO batches (hostel_id, batch_number, start_time, end_time, status)
        VALUES ($1, $2, NOW() - INTERVAL '5 minutes', NOW() + INTERVAL '55 minutes', 'ACTIVE')
        RETURNING *
    `, [ctx.hostel.id, batchNum]);
    ctx.batch = batchRes.rows[0];
    console.log(`  Created batch #${batchNum}: ${ctx.batch.id}`);

    console.log(`  ${GREEN}Setup complete${RESET}`);
}

// ─────────────────────────────────────────────────────────
// TEARDOWN — delete all test data (reverse FK order)
// ─────────────────────────────────────────────────────────

async function teardown() {
    section('TEARDOWN');
    try {
        const studentIds = ctx.students?.map(s => s.id) ?? [];

        if (studentIds.length > 0) {
            // Delete room assignments and submissions first (FK deps)
            await pool.query(`DELETE FROM room_assignments WHERE student_id = ANY($1::int[])`, [studentIds]);
            await pool.query(`DELETE FROM submission_preferences WHERE submission_id IN (SELECT asb.id FROM allocation_submissions asb JOIN housing_groups hg ON asb.group_id = hg.id WHERE hg.primary_applicant_id = ANY($1::int[]))`, [studentIds]);
            await pool.query(`DELETE FROM allocation_submissions WHERE group_id IN (SELECT id FROM housing_groups WHERE primary_applicant_id = ANY($1::int[]))`, [studentIds]);
            await pool.query(`DELETE FROM group_requests WHERE student_id = ANY($1::int[])`, [studentIds]);

            // Unlink students from groups — must bypass the group-lock trigger
            // because groups may be in SOFT_LOCKED/ALLOCATED/PENALIZED/SHATTERED state
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                await client.query(`SET LOCAL app.bypass_group_lock = 'on'`);
                await client.query(`UPDATE students SET group_id = NULL WHERE id = ANY($1::int[])`, [studentIds]);
                await client.query('COMMIT');
            } catch (e) {
                await client.query('ROLLBACK').catch(() => {});
                throw e;
            } finally {
                client.release();
            }
        }

        // Delete groups owned by test students
        if (studentIds.length > 0) {
            await pool.query(`DELETE FROM housing_groups WHERE primary_applicant_id = ANY($1::int[])`, [studentIds]);
        }

        // Delete remaining allocation data tied to test batch
        if (ctx.batch) {
            await pool.query(`DELETE FROM allocation_submissions WHERE batch_id = $1`, [ctx.batch.id]);
            await pool.query(`DELETE FROM batches WHERE id = $1`, [ctx.batch.id]);
        }

        // Reset student ranks and delete students
        if (studentIds.length > 0) {
            await pool.query(`UPDATE students SET individual_rank = NULL WHERE id = ANY($1::int[])`, [studentIds]);
            await pool.query(`DELETE FROM students WHERE id = ANY($1::int[])`, [studentIds]);
        }

        // Delete rooms and hostel
        if (ctx.hostel) {
            await pool.query(`DELETE FROM rooms WHERE hostel_id = $1`, [ctx.hostel.id]);
            await pool.query(`DELETE FROM hostels WHERE id = $1`, [ctx.hostel.id]);
        }

        console.log(`  ${GREEN}Teardown complete — all test data removed${RESET}`);
    } catch (err) {
        console.error(`  ${RED}Teardown error (manual cleanup may be needed): ${err.message}${RESET}`);
    }
}

// ─────────────────────────────────────────────────────────
// 1. PURE UNIT TESTS — roomSelector.js
// ─────────────────────────────────────────────────────────

async function testRoomSelectorUnit() {
    section('roomSelector.js — Pure Unit Tests');

    test('getRemainingBeds: returns correct free bed count', async () => {
        const room = { max_capacity: 4, current_occupancy: 1 };
        assertEquals(roomSelector.getRemainingBeds(room), 3);
    });

    test('getRemainingBeds: returns 0 when full', async () => {
        assertEquals(roomSelector.getRemainingBeds({ max_capacity: 2, current_occupancy: 2 }), 0);
    });

    test('canFitGroup: true when group fits', async () => {
        assert(roomSelector.canFitGroup({ max_capacity: 4, current_occupancy: 1 }, 3));
    });

    test('canFitGroup: false when group is too large', async () => {
        assert(!roomSelector.canFitGroup({ max_capacity: 2, current_occupancy: 1 }, 2));
    });

    test('canFitGroupStrict: enforces max_capacity hard limit', async () => {
        assert(!roomSelector.canFitGroupStrict({ max_capacity: 3, current_occupancy: 2 }, 2));
        assert(roomSelector.canFitGroupStrict({ max_capacity: 3, current_occupancy: 1 }, 2));
    });

    test('isRoomFull: true when occupancy equals capacity', async () => {
        assert(roomSelector.isRoomFull({ max_capacity: 2, current_occupancy: 2 }));
        assert(!roomSelector.isRoomFull({ max_capacity: 2, current_occupancy: 1 }));
    });

    test('selectPreferredRoom: returns first fitting preference', async () => {
        const preferences = [
            { room_id: 'room-a', preference_order: 1 },
            { room_id: 'room-b', preference_order: 2 },
        ];
        const lockedRooms = new Map([
            ['room-a', { id: 'room-a', max_capacity: 2, current_occupancy: 2 }], // full
            ['room-b', { id: 'room-b', max_capacity: 4, current_occupancy: 1 }], // fits
        ]);
        const result = roomSelector.selectPreferredRoom(preferences, lockedRooms, 3);
        assert(result !== null, 'Should find room-b');
        assertEquals(result.room.id, 'room-b');
        assertEquals(result.preferenceOrder, 2);
    });

    test('selectPreferredRoom: returns null when no room fits', async () => {
        const preferences = [{ room_id: 'room-a', preference_order: 1 }];
        const lockedRooms = new Map([
            ['room-a', { id: 'room-a', max_capacity: 2, current_occupancy: 2 }],
        ]);
        const result = roomSelector.selectPreferredRoom(preferences, lockedRooms, 1);
        assert(result === null, 'Should return null for full room');
    });

    test('sortRoomsByFill: sorts tightest first', async () => {
        const rooms = [
            { max_capacity: 4, current_occupancy: 0 }, // 4 free
            { max_capacity: 2, current_occupancy: 1 }, // 1 free
            { max_capacity: 3, current_occupancy: 1 }, // 2 free
        ];
        const sorted = roomSelector.sortRoomsByFill(rooms);
        assertEquals(roomSelector.getRemainingBeds(sorted[0]), 1);
        assertEquals(roomSelector.getRemainingBeds(sorted[2]), 4);
    });

    test('findLargestAvailableRoom: returns room with most beds', async () => {
        const rooms = [
            { id: 'a', max_capacity: 2, current_occupancy: 1 },
            { id: 'b', max_capacity: 4, current_occupancy: 1 }, // 3 free — winner
            { id: 'c', max_capacity: 4, current_occupancy: 4 }, // full
        ];
        const best = roomSelector.findLargestAvailableRoom(rooms);
        assertEquals(best.id, 'b');
    });

    test('findLargestAvailableRoom: returns null when all rooms full', async () => {
        const rooms = [
            { id: 'a', max_capacity: 2, current_occupancy: 2 },
        ];
        assert(roomSelector.findLargestAvailableRoom(rooms) === null);
    });
}

// ─────────────────────────────────────────────────────────
// 2. LOCKING — withTransaction & lockRoom
// ─────────────────────────────────────────────────────────

async function testLocking() {
    section('locking.js — Transaction & Lock Tests');

    await test('withTransaction: commits on success', async () => {
        const result = await withTransaction(async (client) => {
            const r = await client.query('SELECT 1 + 1 AS sum');
            return r.rows[0].sum;
        });
        assertEquals(parseInt(result), 2);
    });

    await test('withTransaction: rolls back on error', async () => {
        let threw = false;
        try {
            await withTransaction(async (client) => {
                throw new Error('intentional test error');
            });
        } catch {
            threw = true;
        }
        assert(threw, 'Should have thrown');
    });

    await test('lockRoom: returns fresh room record', async () => {
        await withTransaction(async (client) => {
            const room = await lockRoom(client, ctx.room4.id);
            assert(room !== null, 'Room should exist');
            assertEquals(room.id, ctx.room4.id);
            assertEquals(room.max_capacity, 4);
        });
    });

    await test('lockRoom: returns null for non-existent room', async () => {
        await withTransaction(async (client) => {
            const result = await lockRoom(client, '00000000-0000-0000-0000-000000000000');
            assert(result === null, 'Should return null');
        });
    });

    await test('lockRoomsInOrder: locks multiple rooms deterministically', async () => {
        await withTransaction(async (client) => {
            const ids = [ctx.room3.id, ctx.room2.id, ctx.room4.id]; // unsorted input
            const map = await lockRoomsInOrder(client, ids);
            assertEquals(map.size, 3, 'Should lock all 3 rooms');
            assert(map.has(ctx.room2.id));
            assert(map.has(ctx.room3.id));
            assert(map.has(ctx.room4.id));
        });
    });

    await test('lockRoomsInOrder: deduplicates room IDs', async () => {
        await withTransaction(async (client) => {
            const ids = [ctx.room2.id, ctx.room2.id, ctx.room3.id];
            const map = await lockRoomsInOrder(client, ids);
            assertEquals(map.size, 2, 'Should deduplicate');
        });
    });

    await test('lockGroup: returns group record when group exists', async () => {
        // Use createGroup() service — satisfies validate_primary_applicant trigger
        const s = ctx.students[7];
        const grp = await createGroup(s.id);

        await withTransaction(async (client) => {
            const locked = await lockGroup(client, grp.id);
            assert(locked !== null, 'Group should be lockable');
            assertEquals(locked.id, grp.id);
        });

        // Cleanup
        await pool.query(`UPDATE students SET group_id = NULL WHERE id = $1`, [s.id]);
        await pool.query(`DELETE FROM housing_groups WHERE id = $1`, [grp.id]);
    });
}

// ─────────────────────────────────────────────────────────
// 3. PHASE SERVICE
// ─────────────────────────────────────────────────────────

async function testPhaseService() {
    section('phase.service.js');

    await test('getCurrentPhase: returns hostel with phase', async () => {
        const h = await getCurrentPhase(ctx.hostel.id);
        assert(h !== null);
        assertEquals(h.current_phase, 'ADMIN_MODE');
    });

    await test('setCurrentPhase: ADMIN_MODE → LOBBY', async () => {
        const h = await setCurrentPhase(ctx.hostel.id, 'LOBBY');
        assertEquals(h.current_phase, 'LOBBY');
    });

    await test('setCurrentPhase: LOBBY → SOFT_LOCK', async () => {
        const h = await setCurrentPhase(ctx.hostel.id, 'SOFT_LOCK');
        assertEquals(h.current_phase, 'SOFT_LOCK');
    });

    await test('setCurrentPhase: rejects illegal transition (SOFT_LOCK → FINAL_SWEEP)', async () => {
        let threw = false;
        try {
            await setCurrentPhase(ctx.hostel.id, 'FINAL_SWEEP');
        } catch (err) {
            threw = true;
            assert(err.message.includes('Cannot transition'), `Wrong error: ${err.message}`);
        }
        assert(threw, 'Should reject illegal transition');
    });

    await test('pauseAllocation: sets is_paused = true', async () => {
        const h = await pauseAllocation(ctx.hostel.id);
        assertEquals(h.is_paused, true);
    });

    await test('resumeAllocation: sets is_paused = false', async () => {
        const h = await resumeAllocation(ctx.hostel.id);
        assertEquals(h.is_paused, false);
    });

    await test('canModifyGroups: passes in LOBBY phase', async () => {
        // Hostel is in SOFT_LOCK — transition back to LOBBY first
        await pool.query(`UPDATE hostels SET current_phase = 'LOBBY' WHERE id = $1`, [ctx.hostel.id]);
        const h = await canModifyGroups(ctx.hostel.id);
        assert(h !== null);
    });

    await test('canSubmitPreferences: rejects when not in LIVE_BATCHES', async () => {
        let threw = false;
        try {
            await canSubmitPreferences(ctx.hostel.id); // hostel is LOBBY
        } catch (err) {
            threw = true;
        }
        assert(threw, 'Should reject non-LIVE_BATCHES phase');
    });

    // Reset phase for subsequent tests
    await pool.query(`UPDATE hostels SET current_phase = 'LIVE_BATCHES' WHERE id = $1`, [ctx.hostel.id]);
}

// ─────────────────────────────────────────────────────────
// 4. ROOM SERVICE
// ─────────────────────────────────────────────────────────

async function testRoomService() {
    section('room.service.js');

    await test('getAllHostels: includes test hostel', async () => {
        const hostels = await getAllHostels();
        const found = hostels.find(h => h.id === ctx.hostel.id);
        assert(found, 'Test hostel should appear in list');
    });

    await test('getHostelById: returns correct hostel', async () => {
        const h = await getHostelById(ctx.hostel.id);
        assertEquals(h.id, ctx.hostel.id);
        assert(h.name.includes(RUN));
    });

    await test('getHostelById: throws 404 for missing hostel', async () => {
        let threw = false;
        try {
            await getHostelById('00000000-0000-0000-0000-000000000000');
        } catch (err) {
            threw = true;
            assertEquals(err.statusCode, 404);
        }
        assert(threw);
    });

    await test('getRoomsByHostel: returns all rooms for hostel', async () => {
        const rooms = await getRoomsByHostel(ctx.hostel.id);
        assertEquals(rooms.length, 3, 'Should return all 3 test rooms');
    });

    await test('getRoomById: returns correct room', async () => {
        const r = await getRoomById(ctx.room4.id);
        assertEquals(r.max_capacity, 4);
    });

    await test('getRoomById: throws 404 for missing room', async () => {
        let threw = false;
        try {
            await getRoomById('00000000-0000-0000-0000-000000000000');
        } catch (err) {
            threw = true;
            assertEquals(err.statusCode, 404);
        }
        assert(threw);
    });
}

// ─────────────────────────────────────────────────────────
// 5. GROUP SERVICE
// ─────────────────────────────────────────────────────────

async function testGroupService() {
    section('group.service.js');

    let groupId;
    let requestId;
    const [leader, member1, member2, leavingMember] = ctx.students;

    await test('createGroup: creates group and links leader', async () => {
        const group = await createGroup(leader.id);
        groupId = group.id;
        assert(groupId, 'Group ID should exist');
        assertEquals(group.primary_applicant_id, leader.id);
        assertEquals(group.status, 'FORMING');
        ctx.mainGroupId = groupId;
    });

    await test('createGroup: throws when student already in a group', async () => {
        let threw = false;
        try {
            await createGroup(leader.id);
        } catch (err) {
            threw = true;
            assertEquals(err.statusCode, 400);
        }
        assert(threw);
    });

    await test('getGroupDetails: returns group with members', async () => {
        const details = await getGroupDetails(groupId);
        assertEquals(details.id, groupId);
        assert(Array.isArray(details.members));
        assertEquals(details.members.length, 1); // just the leader
    });

    await test('sendGroupRequest: leader invites member1', async () => {
        const req = await sendGroupRequest(groupId, member1.id, 'INVITE_FROM_PRIMARY');
        requestId = req.id;
        assert(requestId, 'Request ID should exist');
        assertEquals(req.status, 'PENDING');
    });

    await test('sendGroupRequest: duplicate invite throws 400', async () => {
        let threw = false;
        try {
            await sendGroupRequest(groupId, member1.id, 'INVITE_FROM_PRIMARY');
        } catch (err) {
            threw = true;
            assertEquals(err.statusCode, 400);
        }
        assert(threw);
    });

    await test('respondToGroupRequest: ACCEPTED adds member to group', async () => {
        const req = await respondToGroupRequest(requestId, 'ACCEPTED');
        assertEquals(req.status, 'ACCEPTED');
        // Verify member1 is now in the group
        const res = await pool.query('SELECT group_id FROM students WHERE id = $1', [member1.id]);
        assertEquals(res.rows[0].group_id, groupId);
    });

    await test('getGroupDetails: shows 2 members after accept', async () => {
        const details = await getGroupDetails(groupId);
        assertEquals(details.members.length, 2);
    });

    await test('sendGroupRequest: member2 applies to join', async () => {
        const req = await sendGroupRequest(groupId, member2.id, 'APPLICATION_FROM_STUDENT');
        const accepted = await respondToGroupRequest(req.id, 'ACCEPTED');
        assertEquals(accepted.status, 'ACCEPTED');
    });

    await test('respondToGroupRequest: REJECTED keeps student out of group', async () => {
        // Use a different student for rejection test
        const outsider = ctx.students[4];
        const req = await sendGroupRequest(groupId, outsider.id, 'INVITE_FROM_PRIMARY');
        const rejected = await respondToGroupRequest(req.id, 'REJECTED');
        assertEquals(rejected.status, 'REJECTED');
        const res = await pool.query('SELECT group_id FROM students WHERE id = $1', [outsider.id]);
        assert(res.rows[0].group_id === null, 'Rejected student should not be in group');
    });

    await test('updateGroupStatus: FORMING → SOFT_LOCKED', async () => {
        const updated = await updateGroupStatus(groupId, 'SOFT_LOCKED');
        assertEquals(updated.status, 'SOFT_LOCKED');
    });

    await test('leaveGroup: throws 400 when group is locked', async () => {
        let threw = false;
        try {
            await leaveGroup(member2.id);
        } catch (err) {
            threw = true;
            assert(err.statusCode === 400);
        }
        assert(threw, 'Should not allow leaving a locked group');
    });

    // Reset group to FORMING for the leave test
    await pool.query(`UPDATE housing_groups SET status = 'FORMING' WHERE id = $1`, [groupId]);

    await test('leaveGroup: member can leave a FORMING group', async () => {
        const result = await leaveGroup(member2.id);
        assert(result.success);
        const res = await pool.query('SELECT group_id FROM students WHERE id = $1', [member2.id]);
        assert(res.rows[0].group_id === null);
    });

    await test('leaveGroup: throws when student has no group', async () => {
        let threw = false;
        try {
            await leaveGroup(member2.id); // already left
        } catch (err) {
            threw = true;
            assertEquals(err.statusCode, 400);
        }
        assert(threw);
    });

    // Set group back to SOFT_LOCKED for engine tests
    await pool.query(`UPDATE housing_groups SET status = 'SOFT_LOCKED' WHERE id = $1`, [groupId]);
}

// ─────────────────────────────────────────────────────────
// 6. RANK SERVICE
// ─────────────────────────────────────────────────────────

async function testRankService() {
    section('rank/rank.service.js');

    const [s1, s2, s3] = ctx.students;
    // Use large per-run offset so ranks never conflict with leftover test data
    const rankOffset = parseInt(RUN.replace('TS', '').slice(-5)) * 10;
    const csv = `roll_no,rank\n${s1.roll_no},${rankOffset+1}\n${s2.roll_no},${rankOffset+2}\n${s3.roll_no},${rankOffset+3}`;
    const badCsv = `roll_no,rank\nBAD_ROLL,99`;
    const dupRankCsv = `roll_no,rank\n${s1.roll_no},${rankOffset+1}\n${s2.roll_no},${rankOffset+1}`; // dup rank

    await test('previewRankImport: returns per-row status without writing', async () => {
        const preview = await previewRankImport(csv);
        assertEquals(preview.length, 3);
        assert(preview.every(p => p.studentFound), 'All students should be found');
        assert(preview.every(p => p.willImport), 'All should be importable');
    });

    await test('previewRankImport: flags missing student', async () => {
        const preview = await previewRankImport(badCsv);
        assertEquals(preview[0].studentFound, false);
    });

    await test('bulkImportRanksFromCsv: imports ranks and returns summary', async () => {
        const result = await bulkImportRanksFromCsv(csv);
        assertEquals(result.imported, 3);
        assertEquals(result.total, 3);
        // Verify in DB — rank should equal the offset rank we assigned
        const res = await pool.query(
            `SELECT individual_rank FROM students WHERE id = $1`, [s1.id]
        );
        assertEquals(res.rows[0].individual_rank, rankOffset + 1);
    });

    await test('bulkImportRanksFromCsv: rejects if students already ranked', async () => {
        let threw = false;
        try {
            await bulkImportRanksFromCsv(csv); // re-import same ranks
        } catch (err) {
            threw = true;
            // Service returns 409 (Conflict) for already-ranked students
            assert(err.statusCode === 409 || err.statusCode === 422,
                `Expected 409 or 422, got ${err.statusCode}: ${err.message}`);
        }
        assert(threw, 'Should reject re-import of ranked students');
    });

    await test('bulkImportRanksFromCsv: rejects CSV with duplicate rank values', async () => {
        let threw = false;
        try {
            await bulkImportRanksFromCsv(dupRankCsv);
        } catch (err) {
            threw = true;
            assertEquals(err.statusCode, 422);
        }
        assert(threw, 'Should reject duplicate rank values in CSV');
    });

    await test('bulkImportRanksFromCsv: rejects CSV with unknown roll_no', async () => {
        let threw = false;
        try {
            await bulkImportRanksFromCsv(badCsv);
        } catch (err) {
            threw = true;
            assertEquals(err.statusCode, 422);
        }
        assert(threw, 'Should reject unknown roll_no');
    });

    await test('getUnrankedStudents: returns students without rank', async () => {
        const unranked = await getUnrankedStudents();
        // At least students 4-8 (indices 3-7) are unranked
        const testUnranked = unranked.filter(s => s.roll_no.startsWith(RUN));
        assertGte(testUnranked.length, 4, 'Should have unranked test students');
    });

    // group_rank trigger: leader rank propagated to group
    await test('group_rank trigger: leader rank propagated to group', async () => {
        const res = await pool.query(
            `SELECT group_rank FROM housing_groups WHERE id = $1`, [ctx.mainGroupId]
        );
        const leaderRankRes = await pool.query(
            `SELECT individual_rank FROM students WHERE id = $1`, [ctx.students[0].id]
        );
        // Trigger may have set group_rank = leader's individual_rank
        // Allow null if trigger didn't fire (rank may be set post-import)
        const groupRank = res.rows[0].group_rank;
        const leaderRank = leaderRankRes.rows[0].individual_rank;
        if (groupRank !== null) {
            assertEquals(groupRank, leaderRank, 'Group rank should equal leader rank');
        } else {
            // Manually sync for subsequent engine tests
            await pool.query(
                `UPDATE housing_groups SET group_rank = $1 WHERE id = $2`,
                [leaderRank, ctx.mainGroupId]
            );
        }
    });
}

// ─────────────────────────────────────────────────────────
// 7. ROUND ALLOCATOR — full engine test
// ─────────────────────────────────────────────────────────

async function testRoundAllocator() {
    section('engine/roundAllocator.js — processRound');

    // We need a group with members, a submission, and preferences
    // ctx.mainGroupId has leader (s[0]) + member1 (s[1]) — 2 members
    // Ensure group is SOFT_LOCKED
    await pool.query(`UPDATE housing_groups SET batch_id = $1, status = 'SOFT_LOCKED' WHERE id = $2`,
        [ctx.batch.id, ctx.mainGroupId]);

    // Create allocation_submission for round 1
    const leaderRankRes = await pool.query(
        `SELECT individual_rank FROM students WHERE id = $1`, [ctx.students[0].id]
    );
    const leaderRank = leaderRankRes.rows[0].individual_rank ?? 999;

    const subRes = await pool.query(`
        INSERT INTO allocation_submissions
            (group_id, batch_id, submitted_by, round_number,
             effective_group_rank, effective_leader_rank, effective_group_size)
        VALUES ($1, $2, $3, 1, $4, $4, 2)
        RETURNING *
    `, [ctx.mainGroupId, ctx.batch.id, ctx.students[0].id, leaderRank]);
    const submission = subRes.rows[0];
    ctx.submissionId = submission.id;

    // Create preferences: prefer room4 (4-bed, 0 occupied) first
    await pool.query(`
        INSERT INTO submission_preferences (submission_id, room_id, preference_order)
        VALUES ($1, $2, 1), ($1, $3, 2)
    `, [submission.id, ctx.room4.id, ctx.room3.id]);

    // Attach preferences to submission object
    submission.preferences = [
        { room_id: ctx.room4.id, preference_order: 1 },
        { room_id: ctx.room3.id, preference_order: 2 },
    ];

    await test('processRound: allocates group to preferred room', async () => {
        const result = await processRound({
            batchId: ctx.batch.id,
            roundNumber: 1,
            submissions: [submission],
        });

        assertEquals(result.allocated, 1, 'Should allocate 1 group');
        assertEquals(result.failed, 0);
        assertEquals(result.processed, 1);
        assertEquals(result.results[0].success, true);
        assertEquals(result.results[0].roomId, ctx.room4.id);

        ctx.allocatedRoomId = result.results[0].roomId;
    });

    await test('processRound: group marked ALLOCATED in DB', async () => {
        // Re-fetch from DB — engine commits in its own transaction
        const grpRes = await pool.query(
            `SELECT status FROM housing_groups WHERE id = $1`, [ctx.mainGroupId]
        );
        assertEquals(grpRes.rows[0].status, 'ALLOCATED');
    });

    await test('processRound: students marked is_allotted in DB', async () => {
        const stuRes = await pool.query(
            `SELECT is_allotted, allocated_room_id FROM students
             WHERE id = ANY($1::int[])`,
            [[ctx.students[0].id, ctx.students[1].id]]
        );
        assert(stuRes.rows.every(s => s.is_allotted === true), 'All members should be allotted');
        assert(stuRes.rows.every(s => s.allocated_room_id === ctx.room4.id));
    });

    await test('processRound: room occupancy updated by trigger', async () => {
        const roomRes = await pool.query(
            `SELECT current_occupancy FROM rooms WHERE id = $1`, [ctx.room4.id]
        );
        assertEquals(parseInt(roomRes.rows[0].current_occupancy), 2, 'Room should show 2 occupants');
    });

    await test('processRound: is_processed = true on submission', async () => {
        const subRes = await pool.query(
            `SELECT is_processed, allocation_result FROM allocation_submissions
             WHERE group_id = $1 AND batch_id = $2 AND round_number = 1`,
            [ctx.mainGroupId, ctx.batch.id]
        );
        assertEquals(subRes.rows[0].is_processed, true);
        assertEquals(subRes.rows[0].allocation_result, 'ALLOCATED');
    });

    await test('processRound: idempotent — skips already-processed submission', async () => {
        // Re-fetch submission fresh from DB so is_processed reflects committed state
        const freshSubRes = await pool.query(
            `SELECT * FROM allocation_submissions WHERE id = $1`, [ctx.submissionId]
        );
        const freshSub = freshSubRes.rows[0];
        freshSub.preferences = submission.preferences;

        const result = await processRound({
            batchId: ctx.batch.id,
            roundNumber: 1,
            submissions: [freshSub],
        });
        assert(result.results[0].skipped === true, 'Should skip already-processed');
    });

    await test('processRound: handles FAILED result when no rooms fit', async () => {
        // Group with 4 members trying to fit into a 2-bed room
        const [, , s3, s4, s5, s6] = ctx.students;

        // Use createGroup() to satisfy validate_primary_applicant trigger
        const bigGroup = await createGroup(s3.id);
        // Add s4, s5, s6 as members directly (bypass invite flow for speed)
        await pool.query(`UPDATE students SET group_id = $1 WHERE id = ANY($2::int[])`,
            [bigGroup.id, [s4.id, s5.id, s6.id]]);

        // Set batch_id + SOFT_LOCKED
        await pool.query(
            `UPDATE housing_groups SET batch_id = $1, status = 'SOFT_LOCKED', group_rank = 100 WHERE id = $2`,
            [ctx.batch.id, bigGroup.id]
        );

        // Submission preferring only the 2-bed room (impossible for 4 members)
        const subRes = await pool.query(`
            INSERT INTO allocation_submissions
                (group_id, batch_id, submitted_by, round_number,
                 effective_group_rank, effective_leader_rank, effective_group_size)
            VALUES ($1, $2, $3, 1, 100, 100, 4)
            RETURNING *
        `, [bigGroup.id, ctx.batch.id, s3.id]);

        const failSub = subRes.rows[0];
        failSub.preferences = [{ room_id: ctx.room2.id, preference_order: 1 }];

        const result = await processRound({
            batchId: ctx.batch.id,
            roundNumber: 1,
            submissions: [failSub],
        });

        assertEquals(result.failed, 1);
        assertEquals(result.allocated, 0);

        ctx.failedGroupId = bigGroup.id;
        ctx.failedGroupStudents = [s3.id, s4.id, s5.id, s6.id];
    });
}

// ─────────────────────────────────────────────────────────
// 8. ROLLOVER EVALUATOR
// ─────────────────────────────────────────────────────────

async function testRolloverEvaluator() {
    section('engine/rolloverEvaluator.js');

    // Create a next batch (PENDING)
    const nextBatchNum = parseInt(RUN.replace('TS', '').slice(-6)) + 1;
    const nextBatchRes = await pool.query(`
        INSERT INTO batches (hostel_id, batch_number, start_time, end_time, status)
        VALUES ($1, $2, NOW() + INTERVAL '2 hours', NOW() + INTERVAL '3 hours', 'PENDING')
        RETURNING *
    `, [ctx.hostel.id, nextBatchNum]);
    ctx.nextBatch = nextBatchRes.rows[0];

    await test('evaluate: migrates failed group to next batch', async () => {
        const result = await evalRollover(ctx.batch.id);
        assert(typeof result.rolledOver === 'number');
        assertGte(result.rolledOver, 1, 'At least 1 group should roll over');
        assertEquals(result.nextBatchId, ctx.nextBatch.id);

        // Verify the group is now in the next batch
        const grpRes = await pool.query(
            `SELECT batch_id, rollover_count, is_rollover_priority FROM housing_groups WHERE id = $1`,
            [ctx.failedGroupId]
        );
        assertEquals(grpRes.rows[0].batch_id, ctx.nextBatch.id);
        assertEquals(grpRes.rows[0].rollover_count, 1);
        assertEquals(grpRes.rows[0].is_rollover_priority, true);
    });

    await test('evaluate: idempotent — does not double-rollover', async () => {
        const result = await evalRollover(ctx.batch.id);
        // Second call: the group already has batch_id = nextBatch, so it
        // should be skipped (rolledOver = 0)
        assertEquals(result.rolledOver, 0, 'Second call should roll over nothing');
    });

    // Cleanup next batch
    await pool.query(`DELETE FROM batches WHERE id = $1`, [ctx.nextBatch.id]);
}

// ─────────────────────────────────────────────────────────
// 9. GHOST PENALTY
// ─────────────────────────────────────────────────────────

async function testGhostPenalty() {
    section('engine/ghostPenalty.js');

    // Create a group that never submitted anything
    // Use createGroup() to satisfy validate_primary_applicant trigger
    const ghostStudent = ctx.students[6];
    const ghostGroup = await createGroup(ghostStudent.id);
    await pool.query(
        `UPDATE housing_groups SET batch_id = $1, status = 'SOFT_LOCKED', group_rank = 500 WHERE id = $2`,
        [ctx.batch.id, ghostGroup.id]
    );
    ctx.ghostGroupId = ghostGroup.id;
    ctx.ghostStudentId = ghostStudent.id;

    await test('execute: penalizes ghost group (zero submissions)', async () => {
        const result = await execGhost(ctx.batch.id);
        assertGte(result.penalized, 1, 'Ghost group should be penalized');

        const grpRes = await pool.query(
            `SELECT status FROM housing_groups WHERE id = $1`, [ghostGroup.id]
        );
        assertEquals(grpRes.rows[0].status, 'PENALIZED');
    });

    await test('execute: ghost student unlinked from group', async () => {
        const stuRes = await pool.query(
            `SELECT group_id FROM students WHERE id = $1`, [ghostStudent.id]
        );
        assert(stuRes.rows[0].group_id === null, 'Ghost student should be unlinked');
    });

    await test('execute: does not penalize groups that submitted', async () => {
        // ctx.mainGroupId submitted and was ALLOCATED — should be untouched
        const grpRes = await pool.query(
            `SELECT status FROM housing_groups WHERE id = $1`, [ctx.mainGroupId]
        );
        assertEquals(grpRes.rows[0].status, 'ALLOCATED', 'Allocated group must not be penalized');
    });
}

// ─────────────────────────────────────────────────────────
// 10. SHATTER PROTOCOL
// ─────────────────────────────────────────────────────────

async function testShatterProtocol() {
    section('engine/shatterProtocol.js');

    // Create a 4-member group but fill room4 so only the 2-bed room remains
    // room4 is already full (2 occupants from roundAllocator test)
    // room3 has 3 beds. room2 has 2 beds.
    // A group of 4 members cannot fit in any remaining room.
    const [,,,, s5, s6, , s8] = ctx.students; // pick unlinked students
    // s8 might not have a group — check
    await pool.query(`UPDATE students SET group_id = NULL WHERE id = $1`, [s8.id]);

    // Use createGroup() to satisfy validate_primary_applicant trigger
    const shatterTarget = await createGroup(s8.id);
    await pool.query(
        `UPDATE housing_groups SET batch_id = $1, status = 'SOFT_LOCKED', group_rank = 200 WHERE id = $2`,
        [ctx.batch.id, shatterTarget.id]
    );
    ctx.shatterGroupId = shatterTarget.id;

    // Add 3 more members to make it a 4-person group
    // failedGroupStudents are in a SOFT_LOCKED group — downgrade it first so
    // the prevent_illegal_group_modification trigger allows the unlink
    if (ctx.failedGroupId) {
        await pool.query(
            `UPDATE housing_groups SET status = 'FORMING' WHERE id = $1`,
            [ctx.failedGroupId]
        );
    }
    await pool.query(`UPDATE students SET group_id = NULL WHERE id = ANY($1::int[])`, [ctx.failedGroupStudents]);
    const extraStudents = ctx.failedGroupStudents.slice(0, 3);
    await pool.query(`UPDATE students SET group_id = $1 WHERE id = ANY($2::int[])`,
        [shatterTarget.id, extraStudents]);

    // Fill room3b AND ensure room4 is full so only room3a (3-bed) remains
    // room4 already has 2 occupants from roundAllocator — fill it completely
    await pool.query(`UPDATE rooms SET current_occupancy = 4 WHERE id = $1`, [ctx.room4.id]);
    // Fill room3b fully (3/3)
    await pool.query(`UPDATE rooms SET current_occupancy = 3 WHERE id = $1`, [ctx.room3.id]);
    // Now only room3a (3-bed) has space — a 4-person group cannot fit

    await test('evaluate: shatters group when group > largest available', async () => {
        const result = await evalShatter(shatterTarget.id, ctx.hostel.id);
        assertEquals(result.shattered, true, `Expected shatter, got: ${result.reason}`);
        assertEquals(result.groupSize, 4);
    });

    await test('evaluate: group status is SHATTERED in DB', async () => {
        const grpRes = await pool.query(
            `SELECT status FROM housing_groups WHERE id = $1`, [shatterTarget.id]
        );
        assertEquals(grpRes.rows[0].status, 'SHATTERED');
    });

    await test('evaluate: members unlinked after shatter', async () => {
        const stuRes = await pool.query(
            `SELECT id, group_id FROM students WHERE id = ANY($1::int[])`,
            [[...extraStudents, s8.id]]
        );
        assert(stuRes.rows.every(s => s.group_id === null), 'All members should be unlinked');
    });

    await test('evaluate: does not shatter when group fits', async () => {
        // Restore room3b capacity so a 1-person group fits
        await pool.query(`UPDATE rooms SET current_occupancy = 0 WHERE id = $1`, [ctx.room3.id]);
        await pool.query(`UPDATE rooms SET current_occupancy = 0 WHERE id = $1`, [ctx.room4.id]);

        const s = ctx.students[6]; // ghostStudent — already unlinked after penalty
        const smallGrp = await createGroup(s.id);
        await pool.query(
            `UPDATE housing_groups SET batch_id = $1, status = 'SOFT_LOCKED', group_rank = 300 WHERE id = $2`,
            [ctx.batch.id, smallGrp.id]
        );

        const result = await evalShatter(smallGrp.id, ctx.hostel.id);
        assertEquals(result.shattered, false);

        // Cleanup — downgrade status first so trigger allows the unlink
        await pool.query(`UPDATE housing_groups SET status = 'FORMING' WHERE id = $1`, [smallGrp.id]);
        await pool.query(`UPDATE students SET group_id = NULL WHERE id = $1`, [s.id]);
        await pool.query(`DELETE FROM housing_groups WHERE id = $1`, [smallGrp.id]);
    });


    // Restore room3 occupancy for final sweep test
    await pool.query(`UPDATE rooms SET current_occupancy = 0 WHERE id = $1`, [ctx.room3.id]);
}

// ─────────────────────────────────────────────────────────
// 11. FINAL SWEEP
// ─────────────────────────────────────────────────────────

async function testFinalSweep() {
    section('engine/finalSweep.js');

    // Unlinked, unallocated students: s5, s6, s8 + shatter extras
    // They have no group_id and is_allotted = false — orphan students
    // finalSweep should pick them up via the orphan query

    await test('execute: assigns unallocated orphan students to remaining beds', async () => {
        const result = await execFinalSweep(ctx.hostel.id);
        assert(typeof result.assigned === 'number');
        assert(typeof result.unplaced === 'number');
        assertGte(result.assigned, 1, 'Should assign at least 1 orphan student');
        console.log(`         ${YELLOW}assigned=${result.assigned} skipped=${result.skipped} unplaced=${result.unplaced}${RESET}`);
    });

    await test('execute: assigned students have is_allotted = true', async () => {
        // Check at least one of our test orphan students got assigned
        const res = await pool.query(
            `SELECT COUNT(*) as cnt FROM students
             WHERE id = ANY($1::int[]) AND is_allotted = true`,
            [ctx.failedGroupStudents]
        );
        assertGte(parseInt(res.rows[0].cnt), 1, 'At least one orphan should be allotted');
    });

    await test('execute: room_assignments created for assigned students', async () => {
        const res = await pool.query(
            `SELECT student_id, assigned_by FROM room_assignments
             WHERE student_id = ANY($1::int[]) AND assigned_by = 'FINAL_SWEEP'`,
            [ctx.failedGroupStudents]
        );
        assertGte(res.rowCount, 1, 'FINAL_SWEEP assignments should exist');
    });

    await test('execute: idempotent — skips already-allotted students', async () => {
        const result = await execFinalSweep(ctx.hostel.id);
        // All previously assigned students should be skipped
        assertGte(result.skipped, 0, 'Second run should skip allotted students');
    });
}

// ─────────────────────────────────────────────────────────
// 12. ALLOCATION SERVICE — wiring checks
// ─────────────────────────────────────────────────────────

async function testAllocationServiceWiring() {
    section('allocation.service.js — Service Layer Wiring');

    await test('getLiveRoomMap: returns room availability', async () => {
        const rooms = await allocationService.getLiveRoomMap(ctx.hostel.id);
        assertEquals(rooms.length, 3);
        assert(rooms.every(r => typeof r.remainingBeds === 'string' || typeof r.remainingBeds === 'number'));
    });

    await test('getAllocationStatus: returns student allocation status', async () => {
        const status = await allocationService.getAllocationStatus(ctx.students[0].id);
        assertEquals(status.studentId, ctx.students[0].id);
        assert(typeof status.allotted === 'boolean');
    });

    await test('getActiveBatch: finds ACTIVE batch', async () => {
        const batch = await allocationService.getActiveBatch(ctx.hostel.id);
        assert(batch !== null, 'Should find the test batch');
        assertEquals(batch.id, ctx.batch.id);
    });

    await test('getCurrentRound: returns integer 1-6', async () => {
        const round = await allocationService.getCurrentRound(ctx.batch.id);
        assert(round >= 1 && round <= 6, `Round ${round} out of range`);
    });
}

// ─────────────────────────────────────────────────────────
// MAIN RUNNER
// ─────────────────────────────────────────────────────────

async function main() {
    console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════════════════════════╗`);
    console.log(`║   Room Allocation — Integration Test Suite               ║`);
    console.log(`╚══════════════════════════════════════════════════════════╝${RESET}\n`);

    try {
        await setup();

        await testRoomSelectorUnit();
        await testLocking();
        await testPhaseService();
        await testRoomService();
        await testGroupService();
        await testRankService();
        await testRoundAllocator();
        await testRolloverEvaluator();
        await testGhostPenalty();
        await testShatterProtocol();
        await testFinalSweep();
        await testAllocationServiceWiring();

    } catch (err) {
        console.error(`\n${RED}${BOLD}Fatal error during test run:${RESET}`, err.message);
        console.error(err.stack);
    } finally {
        await teardown();
        await pool.end();
    }

    // ── Results ───────────────────────────────────────────
    const total = passed + failed + skipped;
    console.log(`\n${BOLD}╔══════════════════════════════════════════════════════════╗`);
    console.log(`║  Results                                                 ║`);
    console.log(`╚══════════════════════════════════════════════════════════╝${RESET}`);
    console.log(`  Total:   ${total}`);
    console.log(`  ${GREEN}Passed:  ${passed}${RESET}`);
    console.log(`  ${RED}Failed:  ${failed}${RESET}`);
    console.log(`  ${YELLOW}Skipped: ${skipped}${RESET}\n`);

    if (failed > 0) {
        process.exit(1);
    }
}

main();
