import 'dotenv/config';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function seedBots() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Find existing max rank
        const rankRes = await client.query('SELECT MAX(individual_rank) as max_rank FROM student');
        let currentRank = (rankRes.rows[0].max_rank || 0) + 1;
        
        // Fetch hostel ID
        const hostelRes = await client.query('SELECT id FROM hostel LIMIT 1');
        const hostelId = hostelRes.rows[0].id;
        
        const hash = await bcrypt.hash('Password@123', 10);
        
        console.log(`Creating 100 groups...`);
        let botCount = 0;
        
        // Just use timestamp for uniqueness if run multiple times
        const runId = Math.floor(Date.now() / 1000);
        
        for (let g = 0; g < 100; g++) {
            // Random group size 1 to 4
            const groupSize = Math.floor(Math.random() * 4) + 1;
            
            let primaryStudentId = null;
            let groupStudents = [];
            
            // Create students
            for (let s = 0; s < groupSize; s++) {
                botCount++;
                const name = `Bot_${runId}_${botCount}`;
                const rollNo = `B${runId}${String(botCount).padStart(3, '0')}`;
                const email = `bot${runId}_${botCount}@nith.ac.in`;
                const cgpa = (Math.random() * (10.0 - 6.0) + 6.0).toFixed(2);
                
                const studentRes = await client.query(`
                    INSERT INTO student (name, email, password, hostel, hostel_id, roll_no, department, cgpa, individual_rank)
                    VALUES ($1, $2, $3, $4, $5, $6, 'B.Tech CSE', $7, $8)
                    RETURNING id
                `, [name, email, hash, 'Ganga Hostel', hostelId, rollNo, cgpa, currentRank++]);
                
                const studentId = studentRes.rows[0].id;
                groupStudents.push(studentId);
                
                if (s === 0) {
                    primaryStudentId = studentId;
                }
            }
            
            // Create group
            const groupRes = await client.query(`
                INSERT INTO housing_group (primary_applicant_id, status)
                VALUES ($1, 'FORMING')
                RETURNING id
            `, [primaryStudentId]);
            
            const groupId = groupRes.rows[0].id;
            
            // Assign members to group ID
            for (let i = 0; i < groupStudents.length; i++) {
                const sId = groupStudents[i];
                
                await client.query(`
                    UPDATE student SET group_id = $1 WHERE id = $2
                `, [groupId, sId]);
            }
        }
        
        await client.query('COMMIT');
        console.log(`Successfully seeded 100 groups with a total of ${botCount} bots.`);
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Failed to seed bots:', e);
    } finally {
        client.release();
        await pool.end();
    }
}

seedBots();
