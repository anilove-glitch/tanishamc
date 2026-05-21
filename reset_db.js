import 'dotenv/config';
import pg from 'pg';
import fs from 'fs';

const pool = new pg.Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
});

async function resetDB() {
  try {
    console.log('Reading newdb.sql...');
    const sql = fs.readFileSync('src/roomallocation/db/newdb.sql', 'utf8');
    
    console.log('Dropping all tables...');
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    
    console.log('Running newdb.sql...');
    await pool.query(sql);
    
    console.log('Database reset successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Error resetting database:', error);
    process.exit(1);
  }
}

resetDB();
