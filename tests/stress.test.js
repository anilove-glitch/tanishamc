/**
 * stress.test.js — Multi-Hostel Concurrent Stress Test
 * ============================================================
 * Simulates real-world allocation load:
 *   - 7 hostels running simultaneously
 *   - 50 students per hostel (350 total)
 *   - Groups of 3-4 students submit room preferences
 *   - 2-second rounds (configurable)
 *   - Measures allocation latency per round and per hostel
 *   - Reports worst-case, average, and P95 timings
 *
 * Run: NODE_ENV=test node tests/stress.test.js
 * ============================================================
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const dotenv  = require('dotenv');
dotenv.config();

import pg from 'pg';
const { Pool } = pg;

// ── Config ─────────────────────────────────────────────────
const NUM_HOSTELS           = 7;
const STUDENTS_PER_HOSTEL   = 50;
const ROOMS_PER_HOSTEL      = 20;       // mix of 3-bed and 4-bed
const ROUND_DURATION_MS     = 2000;     // 2 seconds per round
const NUM_ROUNDS            = 3;        // rounds per batch
const RUN                   = `ST${Date.now().toString().slice(-6)}`;

// ── Colors ─────────────────────────────────────────────────
const GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m', RESET = '\x1b[0m', BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

// ── Pool ───────────────────────────────────────────────────
function createPool() {
    if (process.env.DATABASE_URL) {
        return new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false },
            max: 30,
        });
    }
    return new Pool({
        user: process.env.DB_USER, host: process.env.DB_HOST,
        database: process.env.DB_NAME, password: process.env.DB_PASSWORD,
        port: process.env.DB_PORT || 5432, max: 30,
    });
}
const pool = createPool();

// ── Engine imports ─────────────────────────────────────────
import { processRound } from '../src/roomallocation/engine/roundallocator.js';

// ── Timing utilities ───────────────────────────────────────
const timings = { setup: 0, rounds: [], roundsPerHostel: {}, teardown: 0, totalAllocation: 0 };

function hrMs(start) {
    const [s, ns] = process.hrtime(start);
    return Math.round(s * 1000 + ns / 1e6);
}

function fmtMs(ms) {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

function stats(arr) {
    if (arr.length === 0) return { min: 0, max: 0, avg: 0, p95: 0 };
    const sorted = [...arr].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    return {
        min: sorted[0],
        max: sorted[sorted.length - 1],
        avg: Math.round(sum / sorted.length),
        p95: sorted[Math.floor(sorted.length * 0.95)],
    };
}

// ── Data tracking ──────────────────────────────────────────
const hostels = [];

// ── SETUP ──────────────────────────────────────────────────
async function setup() {
    const t = process.hrtime();
    console.log(`\n${BOLD}${CYAN}═══ SETUP ═══${RESET}`);
    console.log(`  Creating ${NUM_HOSTELS} hostels × ${STUDENTS_PER_HOSTEL} students × ${ROOMS_PER_HOSTEL} rooms each...\n`);

    const batchBase = parseInt(RUN.replace('ST', '')) || Math.floor(Date.now() / 1000);

    for (let h = 0; h < NUM_HOSTELS; h++) {
        const hostelT = process.hrtime();
        const hostelName = `${RUN}_SH${h + 1}`;
        process.stdout.write(`  [${h + 1}/${NUM_HOSTELS}] ${hostelName}  `);

        // ── Hostel ──
        const hRes = await pool.query(
            `INSERT INTO hostels (name, type, total_capacity, current_phase, is_paused)
             VALUES ($1, 'BOYS', $2, 'LIVE_BATCHES', false) RETURNING id`,
            [hostelName, ROOMS_PER_HOSTEL * 3]
        );
        const hostelId = hRes.rows[0].id;
        process.stdout.write(`hostel ✓  `);

        // ── Rooms ──
        const rooms = [];
        for (let r = 0; r < ROOMS_PER_HOSTEL; r++) {
            const cap = r % 3 === 0 ? 4 : 3;
            const type = cap === 4 ? 'QUAD' : 'TRIPLE';
            const rRes = await pool.query(
                `INSERT INTO rooms (hostel_id, room_number, room_type, max_capacity)
                 VALUES ($1, $2, $3, $4) RETURNING id, max_capacity`,
                [hostelId, `${RUN}_H${h + 1}_R${r + 1}`, type, cap]
            );
            rooms.push(rRes.rows[0]);
        }
        process.stdout.write(`${rooms.length} rooms ✓  `);

        // ── Students ──
        const students = [];
        const rankBase = (h * STUDENTS_PER_HOSTEL) + batchBase * 10;
        for (let s = 0; s < STUDENTS_PER_HOSTEL; s++) {
            const sRes = await pool.query(
                `INSERT INTO students (name, email, password_hash, roll_no, individual_rank)
                 VALUES ($1, $2, 'stresshash', $3, $4) RETURNING id, individual_rank`,
                [
                    `${RUN}_H${h + 1}_S${s + 1}`,
                    `${RUN}_h${h + 1}_s${s + 1}@stress.test`,
                    `${RUN}_H${h + 1}_ROLL${(s + 1).toString().padStart(3, '0')}`,
                    rankBase + s,
                ]
            );
            students.push(sRes.rows[0]);
        }
        process.stdout.write(`${students.length} students ✓  `);

        // ── Batch ──
        const batchNum = batchBase + h;
        const bRes = await pool.query(
            `INSERT INTO batches (hostel_id, batch_number, start_time, end_time, status)
             VALUES ($1, $2, NOW() - INTERVAL '1 minute', NOW() + INTERVAL '30 minutes', 'ACTIVE')
             RETURNING id`,
            [hostelId, batchNum]
        );
        const batchId = bRes.rows[0].id;

        // ── Groups (3-4 members each) ──
        // CRITICAL: wrap each group creation in a transaction so the
        // deferred validate_primary_applicant trigger fires AFTER
        // both INSERT into housing_groups AND UPDATE students SET group_id.
        const groups = [];
        let sIdx = 0;
        while (sIdx < students.length) {
            const remaining = students.length - sIdx;
            let groupSize;
            if (remaining <= 4) {
                groupSize = remaining >= 3 ? remaining : remaining;
                if (groupSize < 1) break;
            } else {
                groupSize = groups.length % 3 === 0 ? 4 : 3;
            }

            const leader = students[sIdx];
            const memberIds = [];
            for (let m = 0; m < groupSize && sIdx + m < students.length; m++) {
                memberIds.push(students[sIdx + m].id);
            }

            // Single transaction: create group + link all members
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const gRes = await client.query(
                    `INSERT INTO housing_groups (primary_applicant_id, group_rank, batch_id, status)
                     VALUES ($1, $2, $3, 'SOFT_LOCKED') RETURNING id`,
                    [leader.id, leader.individual_rank, batchId]
                );
                const groupId = gRes.rows[0].id;

                // Link ALL members (including leader) inside same txn
                await client.query(
                    `UPDATE students SET group_id = $1 WHERE id = ANY($2::int[])`,
                    [groupId, memberIds]
                );
                await client.query('COMMIT');

                groups.push({ id: groupId, leaderRank: leader.individual_rank, memberIds, leaderId: leader.id });
            } catch (e) {
                await client.query('ROLLBACK').catch(() => {});
                throw e;
            } finally {
                client.release();
            }

            sIdx += groupSize;
        }

        const elapsed = hrMs(hostelT);
        console.log(`${groups.length} groups ✓  ${DIM}(${fmtMs(elapsed)})${RESET}`);

        hostels.push({ id: hostelId, name: hostelName, rooms, students, groups, batchId, batchNum });
    }

    timings.setup = hrMs(t);
    const totalStudents = hostels.reduce((sum, h) => sum + h.students.length, 0);
    const totalGroups = hostels.reduce((sum, h) => sum + h.groups.length, 0);
    console.log(`\n  ${GREEN}${BOLD}Setup complete${RESET} ${DIM}(${fmtMs(timings.setup)})${RESET}`);
    console.log(`  ${DIM}${totalStudents} students | ${totalGroups} groups | ${NUM_HOSTELS * ROOMS_PER_HOSTEL} rooms${RESET}`);
}

// ── CREATE SUBMISSIONS FOR A HOSTEL ────────────────────────
async function createSubmissions(hostel, roundNumber) {
    const submissions = [];

    for (const group of hostel.groups) {
        const shuffled = [...hostel.rooms].sort(() => Math.random() - 0.5);
        const prefRooms = shuffled.slice(0, Math.min(3, shuffled.length));

        const subRes = await pool.query(
            `INSERT INTO allocation_submissions
                (group_id, batch_id, submitted_by, round_number,
                 effective_group_rank, effective_leader_rank, effective_group_size)
             VALUES ($1, $2, $3, $4, $5, $5, $6)
             RETURNING id`,
            [group.id, hostel.batchId, group.leaderId, roundNumber,
             group.leaderRank, group.memberIds.length]
        );
        const submissionId = subRes.rows[0].id;

        const preferences = [];
        for (let p = 0; p < prefRooms.length; p++) {
            await pool.query(
                `INSERT INTO submission_preferences (submission_id, room_id, preference_order)
                 VALUES ($1, $2, $3)`,
                [submissionId, prefRooms[p].id, p + 1]
            );
            preferences.push({ room_id: prefRooms[p].id, preference_order: p + 1 });
        }

        submissions.push({
            id: submissionId,
            group_id: group.id,
            submitted_by: group.leaderId,
            effective_group_rank: group.leaderRank,
            effective_group_size: group.memberIds.length,
            preferences,
        });
    }

    return submissions;
}

// ── RUN ONE ROUND FOR ONE HOSTEL ───────────────────────────
async function runHostelRound(hostel, roundNumber) {
    const t = process.hrtime();

    const submissions = await createSubmissions(hostel, roundNumber);
    const submitTime = hrMs(t);

    const allocT = process.hrtime();
    const result = await processRound({
        batchId: hostel.batchId,
        roundNumber,
        submissions,
    });
    const allocTime = hrMs(allocT);
    const totalTime = hrMs(t);

    return {
        hostelName: hostel.name.replace(`${RUN}_`, ''),
        roundNumber,
        groups: submissions.length,
        allocated: result.allocated,
        failed: result.failed,
        submitTimeMs: submitTime,
        allocTimeMs: allocTime,
        totalTimeMs: totalTime,
    };
}

// ── RESET HOSTEL STATE BETWEEN ROUNDS ──────────────────────
async function resetHostelForNextRound(hostel) {
    const allStudentIds = hostel.students.map(s => s.id);
    const allGroupIds = hostel.groups.map(g => g.id);

    await pool.query(`DELETE FROM room_assignments WHERE student_id = ANY($1::int[])`, [allStudentIds]);

    await pool.query(
        `UPDATE students SET is_allotted = false, allocated_room_id = NULL, physical_room_id = NULL
         WHERE id = ANY($1::int[])`,
        [allStudentIds]
    );

    await pool.query(
        `UPDATE housing_groups SET status = 'SOFT_LOCKED' WHERE id = ANY($1::uuid[])`,
        [allGroupIds]
    );

    for (const room of hostel.rooms) {
        await pool.query(`UPDATE rooms SET current_occupancy = 0 WHERE id = $1`, [room.id]);
    }

    await pool.query(
        `DELETE FROM submission_preferences WHERE submission_id IN
         (SELECT id FROM allocation_submissions WHERE group_id = ANY($1::uuid[]))`,
        [allGroupIds]
    );
    await pool.query(`DELETE FROM allocation_submissions WHERE group_id = ANY($1::uuid[])`, [allGroupIds]);
}

// ── MAIN STRESS TEST ───────────────────────────────────────
async function runStressTest() {
    console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════════════════════════╗`);
    console.log(`║   Room Allocation — Concurrent Stress Test               ║`);
    console.log(`╚══════════════════════════════════════════════════════════╝${RESET}`);
    console.log(`  ${DIM}Config: ${NUM_HOSTELS} hostels × ${STUDENTS_PER_HOSTEL} students × ${NUM_ROUNDS} rounds (${ROUND_DURATION_MS}ms each)${RESET}`);
    console.log(`  ${DIM}Run ID: ${RUN}${RESET}\n`);

    await setup();

    const allTimings = [];
    const totalT = process.hrtime();

    for (let round = 1; round <= NUM_ROUNDS; round++) {
        console.log(`\n${BOLD}${CYAN}═══ ROUND ${round}/${NUM_ROUNDS} ═══${RESET}`);

        // Reset between rounds
        if (round > 1) {
            process.stdout.write(`  Resetting hostel state... `);
            const resetT = process.hrtime();
            await Promise.all(hostels.map(h => resetHostelForNextRound(h)));
            console.log(`${GREEN}done${RESET} ${DIM}(${fmtMs(hrMs(resetT))})${RESET}`);
        }

        process.stdout.write(`  Submitting preferences + running engine across ${NUM_HOSTELS} hostels concurrently...\n`);
        const roundStart = process.hrtime();

        // ALL hostels CONCURRENTLY
        const roundPromises = hostels.map(h => runHostelRound(h, round));
        const roundResults = await Promise.all(roundPromises);

        const roundTotalMs = hrMs(roundStart);

        // Per-hostel results
        console.log('');
        let totalAlloc = 0, totalFail = 0;
        for (const r of roundResults) {
            const bar = r.allocated > 0 ? GREEN : YELLOW;
            console.log(
                `  ${bar}${r.hostelName}${RESET}  ` +
                `alloc=${String(r.allocated).padStart(2)}  fail=${String(r.failed).padStart(2)}  ` +
                `${DIM}submit=${fmtMs(r.submitTimeMs)}  engine=${fmtMs(r.allocTimeMs)}  total=${fmtMs(r.totalTimeMs)}${RESET}`
            );
            allTimings.push(r.allocTimeMs);
            if (!timings.roundsPerHostel[r.hostelName]) timings.roundsPerHostel[r.hostelName] = [];
            timings.roundsPerHostel[r.hostelName].push(r.allocTimeMs);
            totalAlloc += r.allocated;
            totalFail += r.failed;
        }

        timings.rounds.push(roundTotalMs);
        console.log(`\n  ${BOLD}Round ${round} summary:${RESET} allocated=${totalAlloc} failed=${totalFail} wall=${fmtMs(roundTotalMs)}`);

        const elapsedTotal = hrMs(totalT);
        const remainingRounds = NUM_ROUNDS - round;
        const eta = remainingRounds > 0 ? fmtMs(Math.round((elapsedTotal / round) * remainingRounds)) : '—';
        console.log(`  ${DIM}Elapsed: ${fmtMs(elapsedTotal)} | ETA for remaining ${remainingRounds} rounds: ~${eta}${RESET}`);

        // Round gap
        if (round < NUM_ROUNDS) {
            const gap = Math.max(100, ROUND_DURATION_MS - roundTotalMs);
            if (gap > 100) {
                console.log(`  ${DIM}Waiting ${fmtMs(gap)} before next round...${RESET}`);
                await new Promise(r => setTimeout(r, gap));
            }
        }
    }

    // ── RESULTS ────────────────────────────────────────────
    timings.totalAllocation = timings.rounds.reduce((a, b) => a + b, 0);
    const engineStats = stats(allTimings);
    const roundStats = stats(timings.rounds);
    const totalElapsed = hrMs(totalT);

    console.log(`\n${BOLD}╔══════════════════════════════════════════════════════════╗`);
    console.log(`║  STRESS TEST RESULTS                                     ║`);
    console.log(`╚══════════════════════════════════════════════════════════╝${RESET}`);

    console.log(`\n  ${BOLD}Configuration${RESET}`);
    console.log(`  Hostels:          ${NUM_HOSTELS}`);
    console.log(`  Students/hostel:  ${STUDENTS_PER_HOSTEL}`);
    console.log(`  Total students:   ${NUM_HOSTELS * STUDENTS_PER_HOSTEL}`);
    console.log(`  Total groups:     ${hostels.reduce((s, h) => s + h.groups.length, 0)}`);
    console.log(`  Rooms/hostel:     ${ROOMS_PER_HOSTEL}`);
    console.log(`  Rounds:           ${NUM_ROUNDS}`);
    console.log(`  Round window:     ${fmtMs(ROUND_DURATION_MS)}`);

    console.log(`\n  ${BOLD}Timing — Setup${RESET}`);
    console.log(`  Data creation:    ${fmtMs(timings.setup)}`);

    console.log(`\n  ${BOLD}Timing — Engine (per hostel per round)${RESET}`);
    console.log(`  Min:              ${fmtMs(engineStats.min)}`);
    console.log(`  Max (worst case): ${BOLD}${engineStats.max > ROUND_DURATION_MS ? RED : GREEN}${fmtMs(engineStats.max)}${RESET}`);
    console.log(`  Avg:              ${fmtMs(engineStats.avg)}`);
    console.log(`  P95:              ${BOLD}${engineStats.p95 > ROUND_DURATION_MS ? RED : GREEN}${fmtMs(engineStats.p95)}${RESET}`);

    console.log(`\n  ${BOLD}Timing — Round wall-clock (all ${NUM_HOSTELS} hostels concurrent)${RESET}`);
    console.log(`  Min:              ${fmtMs(roundStats.min)}`);
    console.log(`  Max:              ${BOLD}${roundStats.max > ROUND_DURATION_MS ? RED : GREEN}${fmtMs(roundStats.max)}${RESET}`);
    console.log(`  Avg:              ${fmtMs(roundStats.avg)}`);

    console.log(`\n  ${BOLD}Timing — Total${RESET}`);
    console.log(`  Allocation only:  ${fmtMs(timings.totalAllocation)}`);
    console.log(`  End-to-end:       ${fmtMs(totalElapsed)}`);

    // Verdict
    const fitInRound = roundStats.max <= ROUND_DURATION_MS;
    const p95Fits = engineStats.p95 <= ROUND_DURATION_MS;
    console.log(`\n  ${BOLD}Verdict${RESET}`);
    if (fitInRound) {
        console.log(`  ${GREEN}${BOLD}✅ PASS — All rounds completed within ${fmtMs(ROUND_DURATION_MS)} window${RESET}`);
    } else {
        console.log(`  ${RED}${BOLD}❌ FAIL — Round wall-clock (max ${fmtMs(roundStats.max)}) exceeds ${fmtMs(ROUND_DURATION_MS)} window${RESET}`);
    }
    if (!p95Fits) {
        const recommended = Math.ceil(engineStats.p95 * 1.3);
        console.log(`  ${YELLOW}⚠  P95 engine time (${fmtMs(engineStats.p95)}) exceeds round duration`);
        console.log(`     → Minimum recommended round length: ${fmtMs(recommended)}${RESET}`);
    } else {
        console.log(`  ${GREEN}✅ P95 engine time (${fmtMs(engineStats.p95)}) fits within round window${RESET}`);
    }

    // Per-hostel breakdown
    console.log(`\n  ${BOLD}Per-Hostel Engine Time (across all rounds)${RESET}`);
    for (const [name, times] of Object.entries(timings.roundsPerHostel)) {
        const s = stats(times);
        console.log(`  ${name.padEnd(14)} avg=${String(fmtMs(s.avg)).padStart(7)}  max=${String(fmtMs(s.max)).padStart(7)}  p95=${String(fmtMs(s.p95)).padStart(7)}`);
    }
    console.log('');
}

// ── TEARDOWN ───────────────────────────────────────────────
async function teardown() {
    const t = process.hrtime();
    console.log(`${BOLD}${CYAN}═══ TEARDOWN ═══${RESET}`);

    const allStudentIds = hostels.flatMap(h => h.students.map(s => s.id));
    const allHostelIds = hostels.map(h => h.id);
    const allBatchIds = hostels.map(h => h.batchId);
    const allGroupIds = hostels.flatMap(h => h.groups.map(g => g.id));

    try {
        if (allStudentIds.length === 0) {
            console.log(`  ${YELLOW}No data to clean up${RESET}`);
            return;
        }

        process.stdout.write(`  Cleaning assignments... `);
        await pool.query(`DELETE FROM room_assignments WHERE student_id = ANY($1::int[])`, [allStudentIds]);
        console.log(`${GREEN}✓${RESET}`);

        process.stdout.write(`  Cleaning submissions... `);
        await pool.query(
            `DELETE FROM submission_preferences WHERE submission_id IN
             (SELECT id FROM allocation_submissions WHERE batch_id = ANY($1::uuid[]))`,
            [allBatchIds]
        );
        await pool.query(`DELETE FROM allocation_submissions WHERE batch_id = ANY($1::uuid[])`, [allBatchIds]);
        console.log(`${GREEN}✓${RESET}`);

        process.stdout.write(`  Unlinking students (bypass trigger)... `);
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`SET LOCAL app.bypass_group_lock = 'on'`);
            await client.query(`UPDATE students SET group_id = NULL WHERE id = ANY($1::int[])`, [allStudentIds]);
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            throw e;
        } finally {
            client.release();
        }
        console.log(`${GREEN}✓${RESET}`);

        process.stdout.write(`  Deleting groups, batches, students... `);
        await pool.query(`DELETE FROM housing_groups WHERE id = ANY($1::uuid[])`, [allGroupIds]);
        await pool.query(`DELETE FROM batches WHERE id = ANY($1::uuid[])`, [allBatchIds]);
        await pool.query(`DELETE FROM students WHERE id = ANY($1::int[])`, [allStudentIds]);
        console.log(`${GREEN}✓${RESET}`);

        process.stdout.write(`  Deleting rooms & hostels... `);
        for (const hId of allHostelIds) {
            await pool.query(`DELETE FROM rooms WHERE hostel_id = $1`, [hId]);
        }
        await pool.query(`DELETE FROM hostels WHERE id = ANY($1::uuid[])`, [allHostelIds]);
        console.log(`${GREEN}✓${RESET}`);

        timings.teardown = hrMs(t);
        console.log(`  ${GREEN}${BOLD}Teardown complete${RESET} ${DIM}(${fmtMs(timings.teardown)})${RESET}\n`);
    } catch (err) {
        console.error(`  ${RED}Teardown error: ${err.message}${RESET}`);
    }
}

// ── ENTRY POINT ────────────────────────────────────────────
async function main() {
    try {
        await runStressTest();
    } catch (err) {
        console.error(`\n${RED}${BOLD}Fatal error:${RESET}`, err.message);
        console.error(err.stack);
    } finally {
        await teardown();
        await pool.end();
    }
}

main();
