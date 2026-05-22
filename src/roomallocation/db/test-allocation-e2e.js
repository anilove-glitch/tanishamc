/**
 * test-allocation-e2e.js
 *
 * Run:
 *   node src/roomallocation/db/test-allocation-e2e.js
 *
 * What it does:
 *   1) Resets one hostel to a clean allocation state
 *   2) Seeds deterministic dummy rooms in Ganga Hostel
 *   3) Creates test groups from existing hostel students
 *   4) Connects a websocket client and logs all allocation events
 *   5) Advances LOBBY -> SOFT_LOCK and verifies batch creation
 *   6) Demonstrates whether BATCH_STARTED fires automatically
 *   7) Manually activates batch for testing and submits sequential preferences
 *   8) Executes round 1 and compares DB room occupancy vs websocket events
 *
 * Goal:
 *   Pinpoint frontend desync causes with concrete evidence.
 */

import 'dotenv/config';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { io } from 'socket.io-client';
import pool from '../../db/pool.js';

const HOSTEL_NAME = 'Ganga Hostel';
const WS_URL = process.env.E2E_WS_URL ?? 'http://localhost:5000';
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:5000/api';
const http = axios.create({ timeout: 30000 });

const WS_EVENTS = [
  'PHASE_CHANGED',
  'BATCH_STARTED',
  'BATCH_ENDED',
  'NEXT_BATCH_READY',
  'ROUND_OPENED',
  'ROUND_FROZEN',
  'ROUND_EXECUTED',
  'ROUND_CYCLE_DONE',
  'ROOM_MAP_UPDATED',
  'EVALUATION_DONE',
  'SYSTEM_PAUSED',
  'SYSTEM_RESUMED',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function section(title) {
  console.log(`\n==================== ${title} ====================`);
}

function kv(label, value) {
  console.log(`[INFO] ${label}:`, value);
}

function warn(msg) {
  console.warn(`[WARN] ${msg}`);
}

function fail(msg) {
  console.error(`[FAIL] ${msg}`);
}

function ok(msg) {
  console.log(`[OK] ${msg}`);
}

function makeToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET);
}

function buildHeaders(role, token) {
  return {
    Authorization: `Bearer ${token}`,
    role,
    'Content-Type': 'application/json',
  };
}

function buildDummyRooms() {
  const blocks = ['A', 'B', 'C'];
  const rooms = [];

  for (const block of blocks) {
    for (let floor = 1; floor <= 3; floor++) {
      for (let num = 1; num <= 8; num++) {
        const roomNumber = `${block}-${floor}${String(num).padStart(2, '0')}`;
        const capacity = num % 3 === 0 ? 4 : num % 2 === 0 ? 3 : 2;
        rooms.push({
          roomNumber,
          maxCapacity: capacity,
          roomType: `${capacity}-Seater`,
        });
      }
    }
  }

  return rooms;
}

function generateSequentialPreferences(roomIds, groupIndex, pickCount = 10) {
  if (!roomIds.length) return [];

  const total = Math.min(pickCount, roomIds.length);
  const start = (groupIndex * 3) % roomIds.length;
  const out = [];

  for (let i = 0; i < total; i++) {
    out.push(roomIds[(start + i) % roomIds.length]);
  }

  return out;
}

async function fetchHostel(client) {
  const hostelRes = await client.query(
    `SELECT id, name, current_phase FROM hostel WHERE name = $1 LIMIT 1`,
    [HOSTEL_NAME]
  );

  if (hostelRes.rowCount === 0) {
    throw new Error(`Hostel "${HOSTEL_NAME}" not found. Seed it first.`);
  }

  return hostelRes.rows[0];
}

async function snapshotCounts(client, hostelId) {
  const [roomC, studentC, groupC, batchC, subC, assignC] = await Promise.all([
    client.query('SELECT COUNT(*)::int AS count FROM room WHERE hostel_id = $1', [hostelId]),
    client.query('SELECT COUNT(*)::int AS count FROM student WHERE hostel_id = $1', [hostelId]),
    client.query(
      `SELECT COUNT(*)::int AS count
       FROM housing_group hg
       WHERE EXISTS (SELECT 1 FROM student s WHERE s.group_id = hg.id AND s.hostel_id = $1)`,
      [hostelId]
    ),
    client.query('SELECT COUNT(*)::int AS count FROM batch WHERE hostel_id = $1', [hostelId]),
    client.query(
      `SELECT COUNT(*)::int AS count
       FROM allocation_submission a
       JOIN batch b ON b.id = a.batch_id
       WHERE b.hostel_id = $1`,
      [hostelId]
    ),
    client.query(
      `SELECT COUNT(*)::int AS count
       FROM room_assignment ra
       WHERE ra.room_id IN (SELECT id FROM room WHERE hostel_id = $1)
          OR ra.student_id IN (SELECT id FROM student WHERE hostel_id = $1)`,
      [hostelId]
    ),
  ]);

  return {
    rooms: roomC.rows[0].count,
    students: studentC.rows[0].count,
    groups: groupC.rows[0].count,
    batches: batchC.rows[0].count,
    submissions: subC.rows[0].count,
    assignments: assignC.rows[0].count,
  };
}

async function resetHostelState(client, hostelId) {
  await client.query('BEGIN');
  try {
    await client.query(
      `DELETE FROM room_assignment
       WHERE room_id IN (SELECT id FROM room WHERE hostel_id = $1)
          OR student_id IN (SELECT id FROM student WHERE hostel_id = $1)`,
      [hostelId]
    );

    await client.query(
      `DELETE FROM submission_preference
       WHERE submission_id IN (
         SELECT a.id
         FROM allocation_submission a
         JOIN batch b ON b.id = a.batch_id
         WHERE b.hostel_id = $1
       )`,
      [hostelId]
    );

    await client.query(
      `DELETE FROM allocation_submission
       WHERE batch_id IN (SELECT id FROM batch WHERE hostel_id = $1)`,
      [hostelId]
    );

    await client.query(
      `DELETE FROM group_request
       WHERE group_id IN (
         SELECT DISTINCT hg.id
         FROM housing_group hg
         JOIN student s ON s.group_id = hg.id
         WHERE s.hostel_id = $1
       )`,
      [hostelId]
    );

    await client.query(
      `UPDATE student
       SET group_id = NULL,
           is_allotted = FALSE,
           allocated_room_id = NULL,
           physical_room_id = NULL
       WHERE hostel_id = $1`,
      [hostelId]
    );

    await client.query(
      `DELETE FROM housing_group
       WHERE id IN (
         SELECT DISTINCT g.id
         FROM housing_group g
         JOIN student s ON s.id = g.primary_applicant_id
         WHERE s.hostel_id = $1
       )`,
      [hostelId]
    );

    await client.query('DELETE FROM batch WHERE hostel_id = $1', [hostelId]);

    await client.query(
      `UPDATE room
       SET current_occupancy = 0
       WHERE hostel_id = $1`,
      [hostelId]
    );

    await client.query(
      `UPDATE hostel
       SET current_phase = 'LOBBY',
           is_paused = FALSE
       WHERE id = $1`,
      [hostelId]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function seedDummyRooms(client, hostelId) {
  const rooms = buildDummyRooms();

  for (const room of rooms) {
    await client.query(
      `INSERT INTO room (hostel_id, room_number, room_type, max_capacity, current_occupancy)
       VALUES ($1, $2, $3, $4, 0)
       ON CONFLICT (hostel_id, room_number)
       DO UPDATE SET
         room_type = EXCLUDED.room_type,
         max_capacity = EXCLUDED.max_capacity,
         current_occupancy = 0`,
      [hostelId, room.roomNumber, room.roomType, room.maxCapacity]
    );
  }

  return rooms.length;
}

async function createGroups(client, hostelId) {
  const studentRes = await client.query(
    `SELECT id, name, individual_rank
     FROM student
     WHERE hostel_id = $1
     ORDER BY individual_rank ASC NULLS LAST, id ASC
     LIMIT 24`,
    [hostelId]
  );

  const students = studentRes.rows;
  if (students.length < 8) {
    throw new Error(`Need at least 8 students in ${HOSTEL_NAME}, found ${students.length}`);
  }

  const groups = [];
  let cursor = 0;

  while (cursor < students.length) {
    const size = Math.min(4, students.length - cursor);
    if (size < 2) break;

    const members = students.slice(cursor, cursor + size);
    cursor += size;

    const leader = members[0];
    const groupRes = await client.query(
      `INSERT INTO housing_group (primary_applicant_id, status, group_rank)
       VALUES ($1, 'FORMING', $2)
       RETURNING id`,
      [leader.id, leader.individual_rank ?? null]
    );

    const groupId = groupRes.rows[0].id;

    for (const member of members) {
      await client.query(
        'UPDATE student SET group_id = $1 WHERE id = $2',
        [groupId, member.id]
      );
    }

    groups.push({ groupId, leaderId: leader.id, leaderName: leader.name, size, members });
  }

  if (!groups.length) {
    throw new Error('No groups were created');
  }

  return groups;
}

async function connectSocket(hostelId, wsLog) {
  const socket = io(WS_URL, {
    transports: ['websocket', 'polling'],
    timeout: 8000,
    reconnectionAttempts: 2,
  });

  for (const event of WS_EVENTS) {
    socket.on(event, (payload) => {
      const entry = {
        ts: new Date().toISOString(),
        event,
        payload,
      };
      wsLog.push(entry);
      console.log(`[WS] ${entry.ts} ${event} ${JSON.stringify(payload)}`);
    });
  }

  socket.on('connect_error', (err) => {
    console.error('[WS] connect_error:', err.message);
  });

  await Promise.race([
    new Promise((resolve) => {
      socket.on('connect', () => {
        socket.emit('join_hostel', { hostelId });
        ok(`Socket connected (${socket.id}) and joined hostel room ${hostelId}`);
        resolve();
      });
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Socket connect timeout')), 10000)),
  ]);

  return socket;
}

function eventCount(wsLog, eventName) {
  return wsLog.filter((e) => e.event === eventName).length;
}

function printWsSummary(wsLog) {
  section('WEBSOCKET EVENT SUMMARY');
  for (const name of WS_EVENTS) {
    kv(name, eventCount(wsLog, name));
  }
}

async function main() {
  const adminToken = makeToken({ id: 1, role: 'admin' });
  const apiHeadersAdmin = buildHeaders('admin', adminToken);

  let socket = null;
  const wsLog = [];
  const client = await pool.connect();

  try {
    section('PRECHECKS');

    const hostel = await fetchHostel(client);
    kv('Hostel', `${hostel.name} (${hostel.id})`);
    kv('Current phase (before)', hostel.current_phase);

    const preCounts = await snapshotCounts(client, hostel.id);
    kv('DB counts before reset', preCounts);

    section('RESET + SEED');
    await resetHostelState(client, hostel.id);
    ok('Reset completed');

    const seeded = await seedDummyRooms(client, hostel.id);
    ok(`Dummy room grid upserted (${seeded} rooms template)`);

    const groups = await createGroups(client, hostel.id);
    ok(`Created ${groups.length} groups`);
    groups.forEach((g, idx) => {
      kv(`Group ${idx + 1}`, `id=${g.groupId}, leader=${g.leaderName}, size=${g.size}`);
    });

    const postSeedCounts = await snapshotCounts(client, hostel.id);
    kv('DB counts after reset/seed/grouping', postSeedCounts);

    section('SOCKET TRACE START');
    socket = await connectSocket(hostel.id, wsLog);

    section('PHASE LOBBY -> SOFT_LOCK');
    const softLockRes = await http.post(
      `${API_URL}/allocation/dev/advance-phase`,
      { hostelId: hostel.id, targetPhase: 'SOFT_LOCK' },
      { headers: apiHeadersAdmin }
    );
    kv('Advance-phase response', softLockRes.data);

    await sleep(1500);

    const batchRes = await client.query(
      `SELECT id, batch_number, status, start_time, end_time
       FROM batch
       WHERE hostel_id = $1
       ORDER BY batch_number ASC`,
      [hostel.id]
    );

    if (batchRes.rowCount === 0) {
      throw new Error('No batches created in SOFT_LOCK. Allocation cannot progress.');
    }

    kv('Batches created', batchRes.rows.map((b) => ({
      id: b.id,
      number: b.batch_number,
      status: b.status,
      start: b.start_time,
      end: b.end_time,
    })));

    const firstBatch = batchRes.rows[0];

    section('CHECK AUTOMATIC BATCH START');
    await client.query(
      `UPDATE batch
       SET start_time = NOW() + INTERVAL '5 seconds',
           end_time = NOW() + INTERVAL '4 minutes',
           status = 'PENDING'
       WHERE id = $1`,
      [firstBatch.id]
    );
    kv('First batch moved to near-future start', firstBatch.id);

    const batchStartedBefore = eventCount(wsLog, 'BATCH_STARTED');
    await sleep(9000);
    const batchStartedAfter = eventCount(wsLog, 'BATCH_STARTED');

    if (batchStartedAfter === batchStartedBefore) {
      warn('No BATCH_STARTED event fired after batch start_time elapsed.');
      warn('Likely cause: batches created during SOFT_LOCK are never scheduled with batchScheduler.scheduleBatch().');
    } else {
      ok('BATCH_STARTED fired automatically. Scheduler timer appears active.');
    }

    section('MANUAL TEST ACTIVATION');
    await client.query(
      `UPDATE batch
       SET status = 'ACTIVE',
           start_time = NOW() - INTERVAL '20 seconds',
           end_time = NOW() + INTERVAL '3 minutes'
       WHERE id = $1`,
      [firstBatch.id]
    );
    await client.query(
      `UPDATE housing_group
       SET status = 'HARD_LOCKED'
       WHERE batch_id = $1`,
      [firstBatch.id]
    );

    const liveRes = await http.post(
      `${API_URL}/allocation/dev/advance-phase`,
      { hostelId: hostel.id, targetPhase: 'LIVE_BATCHES' },
      { headers: apiHeadersAdmin }
    );
    kv('Advance-phase response', liveRes.data);

    await sleep(1200);

    section('SEQUENTIAL PREFERENCE SUBMISSION');
    const roomMapRes = await http.get(`${API_URL}/allocation/rooms/${hostel.id}`, {
      headers: apiHeadersAdmin,
    });

    const roomIds = (roomMapRes.data.rooms ?? []).map((r) => r.id);
    kv('Available rooms for preferences', roomIds.length);

    if (!roomIds.length) {
      throw new Error('No rooms available for preference generation');
    }

    const groupsWithBatchRes = await client.query(
      `SELECT hg.id AS group_id, hg.batch_id, b.batch_number, hg.primary_applicant_id
       FROM housing_group hg
       JOIN batch b ON b.id = hg.batch_id
       WHERE b.id = $1
       ORDER BY b.batch_number ASC, hg.id ASC`,
      [firstBatch.id]
    );

    for (let i = 0; i < groupsWithBatchRes.rowCount; i++) {
      const g = groupsWithBatchRes.rows[i];
      const preferences = generateSequentialPreferences(roomIds, i, 10);
      const studentToken = makeToken({ id: g.primary_applicant_id, role: 'student' });
      const studentHeaders = buildHeaders('student', studentToken);

      try {
        const subRes = await http.post(
          `${API_URL}/allocation/submit-preferences`,
          {
            groupId: g.group_id,
            submittedBy: g.primary_applicant_id,
            hostelId: hostel.id,
            batchNumber: g.batch_number,
            roundNumber: 1,
            preferences,
          },
          { headers: studentHeaders }
        );

        ok(`Submitted preferences for group ${g.group_id} (${preferences.length} rooms)`);
        kv('Submit response', subRes.data.result ?? subRes.data);
      } catch (err) {
        fail(`Preference submission failed for group ${g.group_id}`);
        console.error(err.response?.data ?? err.message);
      }
    }

    section('EXECUTE ROUND 1');
    const beforeOccRes = await client.query(
      `SELECT room_number, current_occupancy
       FROM room
       WHERE hostel_id = $1
       ORDER BY room_number ASC`,
      [hostel.id]
    );

    const runRes = await http.post(
      `${API_URL}/allocation/run`,
      { batchId: firstBatch.id, roundNumber: 1 },
      { headers: apiHeadersAdmin }
    );

    kv('Run response', runRes.data.result ?? runRes.data);

    await sleep(1200);

    const afterOccRes = await client.query(
      `SELECT room_number, current_occupancy
       FROM room
       WHERE hostel_id = $1
       ORDER BY room_number ASC`,
      [hostel.id]
    );

    const beforeByRoom = new Map(beforeOccRes.rows.map((r) => [r.room_number, Number(r.current_occupancy)]));
    const changedRooms = [];
    for (const row of afterOccRes.rows) {
      const prev = beforeByRoom.get(row.room_number) ?? 0;
      const next = Number(row.current_occupancy);
      if (next !== prev) {
        changedRooms.push({
          roomNumber: row.room_number,
          before: prev,
          after: next,
        });
      }
    }

    kv('Rooms changed in DB after round execution', changedRooms.length ? changedRooms : 'none');

    const roomMapEvents = eventCount(wsLog, 'ROOM_MAP_UPDATED');
    if (changedRooms.length > 0 && roomMapEvents === 0) {
      warn('DB occupancy changed but no ROOM_MAP_UPDATED websocket event was emitted.');
      warn('Likely cause: /allocation/run executes allocation logic directly and does not use roundScheduler.broadcastResults().');
    }

    section('FRONTEND CONTRACT CHECKS (API SHAPE)');
    const sampleRoom = roomMapRes.data.rooms?.[0];
    kv('GET /allocation/rooms top-level keys', Object.keys(roomMapRes.data ?? {}));
    kv('Sample room keys', sampleRoom ? Object.keys(sampleRoom) : []);

    if (!('rooms' in (roomMapRes.data ?? {}))) {
      warn('API is not returning { rooms: [...] }. Frontend room parsing will fail.');
    }

    if (sampleRoom && !('roomNumber' in sampleRoom && 'capacity' in sampleRoom && 'occupancy' in sampleRoom)) {
      warn('Room object keys differ from expected adapter contract.');
    }

    printWsSummary(wsLog);

    section('DIAGNOSIS');
    console.log('1) If PHASE_CHANGED arrives but UI does not move phase, check frontend state adapter fields.');
    console.log('2) If DB room occupancy changes but ROOM_MAP_UPDATED is zero, room grid cannot auto-refresh via websocket.');
    console.log('3) If BATCH_STARTED never fires after SOFT_LOCK, scheduler timers for newly created batches are likely not armed.');
    console.log('4) Verify room grid consumer uses `response.rooms` and room keys `roomNumber/capacity/occupancy`.');

    ok('E2E diagnostic flow finished');
  } catch (error) {
    fail('E2E diagnostic failed');
    console.error(error.response?.data ?? error.stack ?? error.message);
    process.exitCode = 1;
  } finally {
    if (socket) {
      socket.disconnect();
    }
    client.release();
    await pool.end();
  }
}

main();
