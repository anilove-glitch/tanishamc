import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function run() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await client.query('ALTER TABLE room DROP CONSTRAINT room_max_capacity_check;');
        await client.query(
            'ALTER TABLE room ADD CONSTRAINT room_max_capacity_check CHECK (max_capacity IN (1,2,3,4,5,6));'
        );

        await client.query('COMMIT');

        const verify = await client.query(
            `SELECT conname, pg_get_constraintdef(c.oid) AS definition
             FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             WHERE t.relname = 'room' AND conname = 'room_max_capacity_check'`
        );

        console.log('Constraint updated successfully:');
        console.log(verify.rows[0] ?? { message: 'Constraint not found after update.' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Failed to alter room_max_capacity_check:', error.message);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

run();
