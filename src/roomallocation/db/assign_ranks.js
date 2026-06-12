/**
 * assign_ranks.js — Assign individual_rank to students who have none
 * 
 * Run: node src/roomallocation/db/assign_ranks.js
 * 
 * - Finds all students with NULL individual_rank
 * - Assigns each a random CGPA (between 6.0 and 10.0) if they also have no CGPA
 * - Then recalculates individual_rank for ALL students by CGPA DESC (ties broken by id)
 * - Uses a single transaction — safe to re-run anytime
 */

import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const RED   = (s) => `\x1b[31m${s}\x1b[0m`;
const BOLD  = (s) => `\x1b[1m${s}\x1b[0m`;

async function main() {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Assign random CGPA to students who have neither rank nor cgpa
        const noCgpa = await client.query(`
            SELECT id FROM student WHERE individual_rank IS NULL AND (cgpa IS NULL OR cgpa = 0)
        `);
        
        for (const row of noCgpa.rows) {
            const randomCgpa = (Math.random() * (10.0 - 6.0) + 6.0).toFixed(2);
            await client.query(
                `UPDATE student SET cgpa = $1 WHERE id = $2`,
                [randomCgpa, row.id]
            );
        }
        console.log(`${GREEN('✔')} Assigned random CGPA to ${noCgpa.rowCount} student(s) with no CGPA.`);

        // 2. Clear ALL ranks first so we can recalculate without UNIQUE conflicts
        await client.query(`UPDATE student SET individual_rank = NULL`);

        // 3. Recalculate ranks for ALL students by CGPA DESC, then id ASC for ties
        const allStudents = await client.query(`
            SELECT id FROM student
            ORDER BY COALESCE(cgpa, 0) DESC, id ASC
        `);

        let rank = 1;
        for (const row of allStudents.rows) {
            await client.query(
                `UPDATE student SET individual_rank = $1 WHERE id = $2`,
                [rank++, row.id]
            );
        }

        const unrankedBefore = noCgpa.rowCount;
        console.log(`${GREEN('✔')} Ranked ${allStudents.rowCount} students total (${unrankedBefore} newly added).`);

        await client.query('COMMIT');

        // 4. Verify
        const check = await client.query(`
            SELECT COUNT(*) as total,
                   COUNT(individual_rank) as ranked,
                   MIN(individual_rank) as min_rank,
                   MAX(individual_rank) as max_rank
            FROM student
        `);
        const { total, ranked, min_rank, max_rank } = check.rows[0];
        console.log(BOLD('\n✅ Done!'));
        console.log(`   Total students : ${total}`);
        console.log(`   Ranked         : ${ranked}`);
        console.log(`   Rank range     : ${min_rank} → ${max_rank}`);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(RED('\n❌ Failed:'), err.message);
        console.error(err.stack);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

main();
