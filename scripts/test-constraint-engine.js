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
    const { executeBulkAllocation } = await import('./src/roomallocation/first-year-allocation/bulkAllocator.js');
    
    const client = await pool.connect();

    try {
        console.log('--- STARTING CONSTRAINT ENGINE TEST ---');
        
        // 1. Find Kailash Boys Hostel
        const hostelRes = await client.query(`SELECT id, name FROM hostel WHERE name = 'Kailash Boys Hostel' LIMIT 1`);
        if (hostelRes.rowCount === 0) {
            console.error('Kailash Boys Hostel not found!');
            return;
        }
        const hostelId = hostelRes.rows[0].id;
        console.log(`✅ Found ${hostelRes.rows[0].name} (${hostelId})`);

        // 2. Find empty rooms
        const roomsRes = await client.query(`
            SELECT id, room_number, max_capacity, current_occupancy 
            FROM room 
            WHERE hostel_id = $1 AND current_occupancy = 0
            ORDER BY max_capacity DESC
        `, [hostelId]);
        
        console.log(`✅ Found ${roomsRes.rowCount} empty rooms.`);
        if (roomsRes.rowCount === 0) return;

        // Group rooms by capacity
        const roomsByCapacity = {};
        for (const r of roomsRes.rows) {
            if (!roomsByCapacity[r.max_capacity]) roomsByCapacity[r.max_capacity] = [];
            roomsByCapacity[r.max_capacity].push(r.id);
        }

        const capacityToTest = Object.keys(roomsByCapacity)[0];
        const targetRoomIds = roomsByCapacity[capacityToTest].slice(0, 10); // Test up to 10 rooms
        
        console.log(`✅ Selected ${targetRoomIds.length} rooms of capacity ${capacityToTest} to test allocation.`);

        // 3. Fetch unassigned students
        const unassignedStudents = await getUnassignedFirstYearStudents(hostelId);
        console.log(`✅ Fetched ${unassignedStudents.length} unassigned first-year students for this hostel.`);
        
        if (unassignedStudents.length === 0) {
            console.log('❌ No unassigned students found. Engine will fail because pool is empty.');
            
            // Let's debug why by checking raw student count
            const rawStudentCount = await client.query(`SELECT COUNT(*) FROM student WHERE hostel_id = $1`, [hostelId]);
            console.log(`   (There are ${rawStudentCount.rows[0].count} total students in this hostel in DB)`);
            
            const firstYearCount = await client.query(`
                SELECT COUNT(*) FROM student 
                WHERE hostel_id = $1 AND roll_no LIKE '26%'
            `, [hostelId]);
            console.log(`   (There are ${firstYearCount.rows[0].count} students with roll_no starting with '26')`);
            return;
        }

        // 4. Create Layout Config
        const layoutConfig = {
            capacity: parseInt(capacityToTest),
            branchDiversity: 'ALLOW_SAME',
            nodes: Array(parseInt(capacityToTest)).fill({ state: 'ANY', branch: null })
        };
        console.log(`✅ Using Layout Config:`, JSON.stringify(layoutConfig, null, 2));

        // 5. Run matcher
        console.log('\n--- RUNNING IN-MEMORY MATCHER ---');
        const allocations = matchConstraints(unassignedStudents, targetRoomIds, layoutConfig);
        console.log(`Result: Matched ${allocations.size} rooms.`);

        if (allocations.size === 0) {
            console.log('❌ Matcher failed to match any rooms.');
            return;
        }

        // 6. Run bulk allocator (simulated with ROLLBACK)
        console.log('\n--- RUNNING BULK ALLOCATOR (TRANSACTION) ---');
        await client.query('BEGIN'); // nested transaction just in case
        try {
            const result = await executeBulkAllocation(allocations, hostelId);
            console.log('✅ Bulk Allocator Success:', result);
        } catch (e) {
            console.error('❌ Bulk Allocator Failed:', e.message);
        } finally {
            console.log('Rolling back test transaction...');
            await client.query('ROLLBACK');
        }

    } catch (err) {
        console.error('Test script crashed:', err);
    } finally {
        client.release();
        process.exit(0);
    }
}

runTest();
