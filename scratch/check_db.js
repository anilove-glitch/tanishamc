import dotenv from 'dotenv';
import pg from 'pg';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function check() {
    try {
        const res = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
        console.log('Tables in Real DB:');
        res.rows.forEach(r => console.log('- ' + r.table_name));
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
check();
