import 'dotenv/config';
import pool from './src/db/pool.js';

try {
  await pool.query(`
    ALTER TABLE hostel 
    ADD COLUMN IF NOT EXISTS allocation_date DATE,
    ADD COLUMN IF NOT EXISTS lobby_opens_at TIMESTAMP WITH TIME ZONE
  `);
  console.log('Migration complete: allocation_date + lobby_opens_at added to hostel table');
  const res = await pool.query('SELECT id, name, current_phase, allocation_date, lobby_opens_at FROM hostel LIMIT 5');
  console.log('Current hostel rows:', JSON.stringify(res.rows, null, 2));
} catch (err) {
  console.error('Migration error:', err.message);
} finally {
  await pool.end();
  process.exit(0);
}
