import pool from './src/db/pool.js';

async function migrate() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        console.log('1. Adding joining_year column...');
        await client.query('ALTER TABLE student ADD COLUMN IF NOT EXISTS joining_year INTEGER;');
        
        console.log('2. Updating joining_year based on roll_no for existing students...');
        await client.query(`
            UPDATE student 
            SET joining_year = 2000 + CAST(SUBSTRING(roll_no FROM 1 FOR 2) AS INTEGER) 
            WHERE roll_no ~ '^[0-9]{2}' AND joining_year IS NULL;
        `);
        
        console.log('3. Dropping old individual_rank unique constraint...');
        await client.query('ALTER TABLE student DROP CONSTRAINT IF EXISTS student_individual_rank_key;');
        
        console.log('4. Adding composite unique constraint (joining_year, individual_rank)...');
        await client.query(`
            ALTER TABLE student 
            ADD CONSTRAINT student_joining_year_individual_rank_key UNIQUE (joining_year, individual_rank);
        `);
        
        await client.query('COMMIT');
        console.log('✅ Migration successful!');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ Migration failed:', e);
    } finally {
        client.release();
        await pool.end();
    }
}

migrate();
