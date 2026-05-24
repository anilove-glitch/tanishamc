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

async function run() {
    const client = await pool.connect();
    try {
        const tableName = await resolveRoomTable(client);

        await client.query('BEGIN');
        await client.query(`
            ALTER TABLE ${tableName}
            ALTER COLUMN room_type
            SET DEFAULT 'Student'
        `);
        await client.query('COMMIT');

        const verify = await client.query(`
            SELECT
                column_name,
                udt_name,
                data_type,
                column_default,
                is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = $1
              AND column_name = 'room_type'
        `, [tableName]);

        console.log(`Default updated on table "${tableName}"`);
        console.log(verify.rows[0] ?? { message: 'room_type column not found' });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Failed to set room_type default:', error.message);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

run();
