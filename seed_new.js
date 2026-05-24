import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
});

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Seed Hostel
    const hostelRes = await client.query(`
      INSERT INTO hostel (name, type, total_capacity, current_phase)
      VALUES ($1, 'Boys', 120, 'LOBBY')
      ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `, ['Hostel A']);
    
    const hostelId = hostelRes.rows[0].id;
    console.log(`✔ Hostel 'Hostel A' seeded with ID: ${hostelId}`);

    // 2. Seed Rooms
    let roomCount = 0;
    for (const block of ['A', 'B', 'C']) {
      for (let floor = 1; floor <= 3; floor++) {
        for (let num = 1; num <= 4; num++) {
          const roomNumber = `${block}-${floor}0${num}`;
          const capacity = (num % 2 === 0) ? 4 : 2;
          
          await client.query(`
            INSERT INTO room (hostel_id, room_number, room_type, max_capacity, current_occupancy)
            VALUES ($1, $2, $3, $4, 0)
            ON CONFLICT (hostel_id, room_number) DO NOTHING
          `, [hostelId, roomNumber, capacity === 4 ? '4-Seater' : '2-Seater', capacity]);
          
          roomCount++;
        }
      }
    }
    console.log(`✔ ${roomCount} Rooms seeded for Hostel A`);

    await client.query('COMMIT');
    console.log('Seeding complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seeding failed:', err);
  } finally {
    client.release();
    pool.end();
  }
}

seed();
