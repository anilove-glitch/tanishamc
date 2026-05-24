import 'dotenv/config';
import bcrypt from 'bcrypt';
import pool from './src/db/pool.js';

async function updatePasswords() {
    const client = await pool.connect();

    try {
        console.log('✅ Connected to database.');

        // 1. Generate the real bcrypt hash for '1234'
        console.log('⏳ Generating bcrypt hash for "1234"...');
        const saltRounds = 10; 
        const realHash = await bcrypt.hash('1234', saltRounds);
        console.log(`🔐 Hash generated: ${realHash}`);

        // 2. Update every student in the database
        console.log('🚀 Bulk updating all student passwords...');
        const result = await client.query('UPDATE student SET password = $1', [realHash]);

        // 3. Confirm success
        console.log(`🎉 Successfully updated ${result.rowCount} students!`);

    } catch (error) {
        console.error('❌ Error updating passwords:', error);
    } finally {
        client.release();
        await pool.end();
        console.log('🔌 Database connection closed.');
        process.exit(0); // Force exit just in case
    }
}

updatePasswords();