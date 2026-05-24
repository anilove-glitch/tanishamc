import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function resolveRoomTable(client) {
    const res = await client.query(`
        SELECT
            to_regclass('public.room')  AS room_table,
            to_regclass('public.rooms') AS rooms_table
    `);
    if (res.rows[0].room_table) return 'room';
    if (res.rows[0].rooms_table) return 'rooms';
    throw new Error('Neither table "room" nor "rooms" exists.');
}

async function ensureEnumType(client) {
    await client.query(`
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'room_type_enum') THEN
                CREATE TYPE room_type_enum AS ENUM ('Student', 'Guest', 'Reserved');
            END IF;
        END
        $$;
    `);
}

async function applyTypeChange(client, tableName) {
    await client.query(`
        ALTER TABLE ${tableName}
        ALTER COLUMN room_type
        TYPE room_type_enum
        USING (
            CASE
                WHEN room_type IS NULL THEN NULL
                ELSE room_type::room_type_enum
            END
        )
    `);
}

async function run() {
    const client = await pool.connect();
    try {
        const tableName = await resolveRoomTable(client);
        console.log(`Target table: ${tableName}`);

        // First attempt: preserve existing data.
        try {
            await client.query('BEGIN');
            await ensureEnumType(client);
            await applyTypeChange(client, tableName);
            await client.query('COMMIT');
            console.log('Migration completed without wiping room data.');
        } catch (firstErr) {
            await client.query('ROLLBACK');
            console.warn('Initial cast failed:', firstErr.message);
            console.warn('Falling back to wipe room table data and retry...');

            await client.query('BEGIN');
            await ensureEnumType(client);
            await client.query(`DELETE FROM ${tableName}`);
            await applyTypeChange(client, tableName);
            await client.query('COMMIT');
            console.log('Migration completed after wiping room table data.');
        }

        const verify = await client.query(`
            SELECT
                c.column_name,
                c.udt_name,
                c.data_type
            FROM information_schema.columns c
            WHERE c.table_schema = 'public'
              AND c.table_name = $1
              AND c.column_name = 'room_type'
        `, [tableName]);

        console.log('Verification:', verify.rows[0] ?? 'room_type column not found');
    } catch (error) {
        console.error('Migration failed:', error.message);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

run();
