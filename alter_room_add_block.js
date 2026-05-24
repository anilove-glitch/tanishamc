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

        // 1) Add block column
        await client.query(`
            ALTER TABLE room
            ADD COLUMN IF NOT EXISTS block VARCHAR(50) DEFAULT NULL
        `);

        // 2) Drop legacy unique(hostel_id, room_number) if present
        const uniqueRes = await client.query(`
            SELECT conname, pg_get_constraintdef(oid) AS definition
            FROM pg_constraint
            WHERE conrelid = 'public.room'::regclass
              AND contype = 'u'
        `);

        for (const row of uniqueRes.rows) {
            const normalized = String(row.definition).replace(/\s+/g, ' ').toUpperCase();
            if (normalized.includes('UNIQUE (HOSTEL_ID, ROOM_NUMBER)')) {
                await client.query(`ALTER TABLE room DROP CONSTRAINT ${row.conname}`);
            }
        }

        // 3) Ensure new unique(hostel_id, block, room_number)
        const hasNewUnique = uniqueRes.rows.some((row) => {
            const normalized = String(row.definition).replace(/\s+/g, ' ').toUpperCase();
            return normalized.includes('UNIQUE (HOSTEL_ID, BLOCK, ROOM_NUMBER)');
        });

        if (!hasNewUnique) {
            await client.query(`
                ALTER TABLE room
                ADD CONSTRAINT room_hostel_block_room_number_key
                UNIQUE (hostel_id, block, room_number)
            `);
        }

        await client.query('COMMIT');

        const verifyColumn = await client.query(`
            SELECT column_name, data_type, column_default, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'room'
              AND column_name = 'block'
        `);
        const verifyUnique = await client.query(`
            SELECT conname, pg_get_constraintdef(oid) AS definition
            FROM pg_constraint
            WHERE conrelid = 'public.room'::regclass
              AND contype = 'u'
              AND pg_get_constraintdef(oid) ILIKE 'UNIQUE (hostel_id, block, room_number)%'
        `);

        console.log('Room migration completed:');
        console.log('Column:', verifyColumn.rows[0] ?? { message: 'block column not found' });
        console.log('Unique:', verifyUnique.rows[0] ?? { message: 'new unique constraint not found' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Failed to migrate room schema:', error.message);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

run();
