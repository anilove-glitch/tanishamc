/**
 * seed.js — Seed students + hostel + rooms into the live Railway DB
 *
 * Run:  node src/roomallocation/db/seed.js
 *
 * What it seeds:
 *   - 1 hostel (LOBBY phase)
 *   - 30 rooms across 3 blocks, 3 floors (mix of 2-seat and 4-seat)
 *   - 20 students with realistic CGPAs + individual_rank 1–20
 *
 * Safe to re-run: ON CONFLICT DO UPDATE keeps data consistent.
 * All students get password "Password@123" (bcrypt hash).
 */

import 'dotenv/config';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

// ─── Config ────────────────────────────────────────────────────────────────
const HOSTEL_NAME = 'Ganga Hostel';
const PASSWORD    = 'Password@123';

// [name, department, cgpa]  — sorted by cgpa desc to assign ranks
const STUDENT_DATA = [
    ['Arjun Sharma',   'B.Tech CSE', 9.20],
    ['Priya Mehta',    'B.Tech ECE', 8.75],
    ['Rohan Das',      'B.Tech ME',  9.10],
    ['Sneha Agarwal',  'B.Tech CSE', 8.90],
    ['Vikram Kumar',   'B.Tech EE',  8.60],
    ['Anita Patel',    'B.Tech CE',  9.00],
    ['Rahul Gupta',    'B.Tech CSE', 8.40],
    ['Kavya Nair',     'B.Tech ECE', 8.80],
    ['Aditya Singh',   'B.Tech ME',  7.95],
    ['Pooja Sharma',   'B.Tech CSE', 9.15],
    ['Suresh Iyer',    'B.Tech EE',  8.55],
    ['Meera Reddy',    'B.Tech CE',  8.70],
    ['Karan Malhotra', 'B.Tech CSE', 8.30],
    ['Tanvi Shah',     'B.Tech ECE', 9.05],
    ['Dev Banerjee',   'B.Tech ME',  7.80],
    ['Riya Joshi',     'B.Tech CSE', 8.45],
    ['Amol Desai',     'B.Tech EE',  8.20],
    ['Shreya Pillai',  'B.Tech CE',  8.65],
    ['Nikhil Verma',   'B.Tech CSE', 7.60],
    ['Diya Kulkarni',  'B.Tech ECE', 8.85],
];

// ─── Helpers ───────────────────────────────────────────────────────────────
const toRoll  = (i)      => `22BCS${String(i + 1).padStart(3, '0')}`;
const toEmail = (name, i) => `${name.split(' ')[0].toLowerCase()}${i + 1}@nith.ac.in`;
const GREEN   = (s)      => `\x1b[32m${s}\x1b[0m`;
const RED     = (s)      => `\x1b[31m${s}\x1b[0m`;
const BOLD    = (s)      => `\x1b[1m${s}\x1b[0m`;

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
    const client = await pool.connect();
    const hash   = await bcrypt.hash(PASSWORD, 10);

    try {
        await client.query('BEGIN');

        // ── 1. Hostel ──────────────────────────────────────────────────
        const hostelRes = await client.query(`
            INSERT INTO hostel (name, type, total_capacity, current_phase)
            VALUES ($1, 'Boys', 120, 'LOBBY')
            ON CONFLICT (name) DO UPDATE
              SET name = EXCLUDED.name
            RETURNING id, name
        `, [HOSTEL_NAME]);
        const hostelId = hostelRes.rows[0].id;
        console.log(GREEN(`✔ Hostel`) + ` : ${HOSTEL_NAME}  (${hostelId})`);

        // ── 2. Rooms ───────────────────────────────────────────────────
        let roomCount = 0;
        const seededRooms = [];

        for (const block of ['A', 'B', 'C']) {
            for (let floor = 1; floor <= 3; floor++) {
                // 3–4 rooms per floor depending on block
                const roomsOnFloor = block === 'C' ? 4 : 3;
                for (let num = 1; num <= roomsOnFloor; num++) {
                    const roomNumber = `${block}-${floor}0${num}`;
                    const capacity   = num % 2 === 0 ? 4 : 2; // alternating 2/4 seater
                    const res = await client.query(`
                        INSERT INTO room (hostel_id, room_number, room_type, max_capacity, current_occupancy)
                        VALUES ($1, $2, $3, $4, 0)
                        ON CONFLICT (hostel_id, room_number) DO UPDATE
                          SET room_type = EXCLUDED.room_type,
                              max_capacity = EXCLUDED.max_capacity
                        RETURNING id
                    `, [hostelId, roomNumber, capacity === 4 ? '4-Seater' : '2-Seater', capacity]);
                    seededRooms.push({ id: res.rows[0].id, roomNumber, capacity });
                    roomCount++;
                }
            }
        }
        console.log(GREEN(`✔ Rooms`) + `   : ${roomCount} rooms across blocks A/B/C`);

        // ── 3. Students ────────────────────────────────────────────────
        // individual_rank is a UNIQUE column. Clear all existing ranks first
        // so re-seeding never collides mid-loop (ON CONFLICT only fires on roll_no).
        await client.query(`UPDATE student SET individual_rank = NULL`);

        const sorted = STUDENT_DATA
            .map(([name, dept, cgpa], i) => ({ name, dept, cgpa, origIdx: i }))
            .sort((a, b) => b.cgpa - a.cgpa);

        const seededStudents = [];
        for (let rank = 0; rank < sorted.length; rank++) {
            const { name, dept, cgpa, origIdx } = sorted[rank];
            const rollNo    = toRoll(origIdx);
            const emailAddr = toEmail(name, origIdx);

            // individual_rank has UNIQUE constraint — use a temp negative value
            // then update, to avoid collisions on re-seed
            const res = await client.query(`
                INSERT INTO student
                  (name, email, password, hostel, hostel_id, roll_no, phone, department, cgpa, individual_rank)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (roll_no) DO UPDATE
                  SET cgpa            = EXCLUDED.cgpa,
                      individual_rank = EXCLUDED.individual_rank,
                      email           = EXCLUDED.email,
                      password        = EXCLUDED.password
                RETURNING id
            `, [
                name, emailAddr, hash, HOSTEL_NAME, hostelId, rollNo, 
                `98${9000 + origIdx}`, dept, cgpa, rank + 1
            ]);

            seededStudents.push({
                id: res.rows[0].id, name, cgpa, rank: rank + 1, email: emailAddr,
            });
            process.stdout.write(`  ${GREEN('✔')} Rank ${String(rank + 1).padStart(2)} : ${name.padEnd(18)} CGPA ${cgpa}  ${emailAddr}\n`);
        }

        await client.query('COMMIT');

        // ── Summary ─────────────────────────────────────────────────────
        console.log(BOLD('\n✅ Seed complete'));
        console.log(`   Hostel ID  : ${hostelId}`);
        console.log(`   Rooms      : ${roomCount}`);
        console.log(`   Students   : ${sorted.length}`);
        console.log(BOLD('\n   Test login credentials'));
        console.log(`   Email    : ${seededStudents[0].email}  (rank #1, CGPA ${seededStudents[0].cgpa})`);
        console.log(`   Password : ${PASSWORD}`);
        console.log('\n   Now run: node src/roomallocation/db/test-api.js');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(RED('\n❌ Seed failed:'), err.message);
        console.error(err.stack);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

main();
