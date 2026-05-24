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

        await client.query(`
            ALTER TABLE student
            ADD COLUMN IF NOT EXISTS father_name VARCHAR(255),
            ADD COLUMN IF NOT EXISTS parent_number VARCHAR(20),
            ADD COLUMN IF NOT EXISTS category VARCHAR(50),
            ADD COLUMN IF NOT EXISTS blood_group VARCHAR(10),
            ADD COLUMN IF NOT EXISTS state VARCHAR(100),
            ADD COLUMN IF NOT EXISTS address TEXT,
            ADD COLUMN IF NOT EXISTS pincode VARCHAR(20)
        `);

        await client.query('COMMIT');

        const verify = await client.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'student'
              AND column_name IN (
                'father_name',
                'parent_number',
                'category',
                'blood_group',
                'state',
                'address',
                'pincode'
              )
            ORDER BY column_name
        `);

        console.log('Student profile field migration completed.');
        console.log(verify.rows);
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Failed to alter student table:', error.message);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

run();
