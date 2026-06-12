import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        console.log("=== Checking 'hostels' table ===");
        const res = await pool.query('SELECT * FROM hostels');
        console.log(res.rows);
    } catch (e) {
        console.log("No 'hostels' table or error:", e.message);
    }
    
    try {
        console.log("\n=== Checking 'hostel' table ===");
        const res2 = await pool.query('SELECT * FROM hostel');
        console.log(res2.rows);
    } catch (e) {
        console.log("No 'hostel' table or error:", e.message);
    }
    
    pool.end();
}

run();
