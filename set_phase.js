import 'dotenv/config';
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.query("UPDATE hostels SET current_phase = 'LOBBY'").then(() => {
  console.log('Phase set to LOBBY');
  process.exit(0);
});
