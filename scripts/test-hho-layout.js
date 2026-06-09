import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

async function runTest() {
    const { default: pool } = await import('./src/db/pool.js');
    const { getUnassignedFirstYearStudents } = await import('./src/roomallocation/first-year-allocation/studentPool.service.js');
    const { matchConstraints } = await import('./src/roomallocation/first-year-allocation/constraintMatcher.js');
    
    const client = await pool.connect();

    try {
        console.log('--- STARTING [HOME, HOME, OTHER] LAYOUT TEST ---');
        
        const hostelRes = await client.query(`SELECT id, name FROM hostel WHERE name = 'Kailash Boys Hostel' LIMIT 1`);
        const hostelId = hostelRes.rows[0].id;
        console.log(`✅ Found ${hostelRes.rows[0].name} (${hostelId})`);

        const roomsRes = await client.query(`
            SELECT id, room_number, max_capacity, current_occupancy 
            FROM room 
            WHERE hostel_id = $1 AND current_occupancy = 0 AND max_capacity = 3
        `, [hostelId]);
        const targetRoomIds = roomsRes.rows.map(r => r.id).slice(0, 10);
        console.log(`✅ Selected ${targetRoomIds.length} empty rooms of capacity 3.`);

        const unassignedStudents = await getUnassignedFirstYearStudents(hostelId);
        console.log(`✅ Fetched ${unassignedStudents.length} unassigned first-year students.`);

        // Log breakdown for clarity
        const homeStateCount = unassignedStudents.filter(s => s.state_category === 'HOME_STATE').length;
        const otherStateCount = unassignedStudents.filter(s => s.state_category === 'OTHER_STATE').length;
        console.log(`   (HOME_STATE: ${homeStateCount}, OTHER_STATE: ${otherStateCount})`);

        const layoutConfig = {
            capacity: 3,
            branchDiversity: 'ALLOW_SAME',
            nodes: [
                { id: 'bed_0', state: 'HOME_STATE', branch: 'ANY' },
                { id: 'bed_1', state: 'HOME_STATE', branch: 'ANY' },
                { id: 'bed_2', state: 'OTHER_STATE', branch: 'ANY' }
            ]
        };

        const allocations = matchConstraints(unassignedStudents, targetRoomIds, layoutConfig);
        console.log(`\nResult: Matched ${allocations.size} rooms.`);

        let i = 1;
        for (const [roomId, students] of allocations.entries()) {
            console.log(`Room ${i++} (${roomId}): Student IDs [${students.join(', ')}]`);
        }

    } catch (err) {
        console.error('Test crashed:', err);
    } finally {
        client.release();
        process.exit(0);
    }
}

runTest();
