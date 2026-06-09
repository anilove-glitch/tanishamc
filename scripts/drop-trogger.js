import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

async function dropTrigger() {
    const { default: pool } = await import('./src/db/pool.js');
    const client = await pool.connect();
    
    try {
        console.log('🔗 Connected to database.');
        await client.query('BEGIN');

        console.log('Dropping trigger from student table...');
        // Note: We use IF EXISTS so the script won't crash if the names are slightly different
        await client.query(`
            DROP TRIGGER IF EXISTS check_group_capacity_trigger ON student;
        `);
        await client.query(`
            DROP TRIGGER IF EXISTS trigger_check_group_capacity ON student;
        `);

        console.log('Dropping the underlying function...');
        await client.query(`
            DROP FUNCTION IF EXISTS check_group_capacity();
        `);

        await client.query('COMMIT');
        console.log('✅ Trigger and function dropped successfully! Your database is unblocked.');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Failed to drop trigger:', err);
    } finally {
        client.release();
        await pool.end();
        process.exit(0);
    }
}

dropTrigger();