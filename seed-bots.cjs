require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function seed() {
    try {
        const hash = await bcrypt.hash('bot', 10);
        
        const hostelRes = await pool.query('SELECT id, name FROM hostel LIMIT 1');
        if (hostelRes.rowCount === 0) throw new Error("No hostel found in DB");
        const hostel = hostelRes.rows[0];
        
        for (let i = 1; i <= 20; i++) {
            const email = `bot${i}@nith.ac.in`;
            const res = await pool.query('SELECT id FROM student WHERE email = $1', [email]);
            if (res.rowCount === 0) {
                await pool.query(
                    `INSERT INTO student (name, roll_no, email, password, department, cgpa, hostel, hostel_id, phone) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, 
                    ['Bot ' + i, 'BOT' + String(i).padStart(3, '0'), email, hash, 'B.Tech CSE', (7 + Math.random()*2).toFixed(2), hostel.name, hostel.id, '9999999999']
                );
            }
        }
        console.log('Seeded 20 bots successfully.');
    } catch (err) {
        console.error('Seeding failed:', err);
    } finally {
        pool.end();
    }
}

seed();
