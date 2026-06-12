import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

async function reset() {
    const { default: pool } = await import('./src/db/pool.js');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("UPDATE housing_group SET status = 'FORMING', batch_id = NULL, group_rank = NULL");
        await client.query('DELETE FROM batch');
        await client.query("UPDATE hostel SET current_phase = 'LOBBY'");
        await client.query('COMMIT');
        console.log('Reset complete!');
    } catch(e) {
        await client.query('ROLLBACK');
        console.error(e);
    } finally {
        client.release();
        process.exit(0);
    }
}
reset();
