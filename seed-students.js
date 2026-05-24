import 'dotenv/config';
import { faker } from '@faker-js/faker';
import pool from './src/db/pool.js';

// ==========================================
// 2. CONSTANTS & DATA POOLS
// ==========================================
const TOTAL_STUDENTS = 3000;
const CHUNK_SIZE = 500; // Safe chunk size to avoid Postgres parameter limits
const YEARS = [23, 24, 25, 26]; // 26 represents incoming first-years
const BRANCHES = {
    'BCS': 'Computer Science and Engineering',
    'BEC': 'Electronics and Communication',
    'BEE': 'Electrical Engineering',
    'BCE': 'Civil Engineering',
    'BME': 'Mechanical Engineering',
    'BAR': 'Architecture'
};
const CATEGORIES = ['General', 'OBC', 'SC', 'ST', 'EWS'];
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
const STATES = ['HOME_STATE', 'OTHER_STATE'];

async function runSeeder() {
    const client = await pool.connect();

    try {
        console.log('✅ Connected to database.');

        // ==========================================
        // 3. FETCH EXISTING INFRASTRUCTURE
        // ==========================================
        const { rows: hostels } = await client.query('SELECT id, name FROM hostel');
        const { rows: dbRooms } = await client.query('SELECT id, hostel_id, max_capacity FROM room');

        if (hostels.length === 0) {
            throw new Error('❌ No hostels found! Please add hostels and rooms to the database first.');
        }

        // Tracker for room occupancy in memory so we don't overfill rooms
        const roomsTracker = dbRooms.map(room => ({
            ...room,
            current_occupancy: 0
        }));

        console.log(`🏢 Found ${hostels.length} hostels and ${roomsTracker.length} rooms.`);

        // ==========================================
        // 4. GENERATE STUDENT DATA
        // ==========================================
        const studentsToInsert = [];
        
        // Fetch current max rank per joining year to avoid unique constraint violations
        const maxRankRes = await client.query('SELECT joining_year, MAX(individual_rank) as max_rank FROM student GROUP BY joining_year');
        const rankCounters = {};
        for (const row of maxRankRes.rows) {
            if (row.joining_year) {
                rankCounters[row.joining_year] = parseInt(row.max_rank || 0, 10);
            }
        }

        console.log(`⚙️ Generating ${TOTAL_STUDENTS} students in memory...`);

        for (let i = 1; i <= TOTAL_STUDENTS; i++) {
            const year = faker.helpers.arrayElement(YEARS);
            const branchCode = faker.helpers.arrayElement(Object.keys(BRANCHES));
            const department = BRANCHES[branchCode];
            
            // Format: 24BCS0001, 26BME1045
            const rollNo = `${year}${branchCode}${String(i).padStart(4, '0')}`;
            const joiningYear = 2000 + year;
            
            const isFirstYear = (year === 26);

            // Assign a random hostel
            const assignedHostel = faker.helpers.arrayElement(hostels);

            let physicalRoomId = null;
            let isAllotted = false;
            let cgpa = null;
            let individualRank = null;

            if (!isFirstYear) {
                // Seniors: Need CGPA, Rank, and a Physical Room
                cgpa = faker.number.float({ min: 5.0, max: 10.0, multipleOf: 0.01 });
                rankCounters[joiningYear] = (rankCounters[joiningYear] || 0) + 1;
                individualRank = rankCounters[joiningYear];
                
                // Find an available room in the assigned hostel
                const availableRooms = roomsTracker.filter(r => 
                    r.hostel_id === assignedHostel.id && 
                    r.current_occupancy < r.max_capacity
                );

                if (availableRooms.length > 0) {
                    const selectedRoom = faker.helpers.arrayElement(availableRooms);
                    physicalRoomId = selectedRoom.id;
                    selectedRoom.current_occupancy += 1; // Mark bed as taken in our JS tracker
                    isAllotted = true;
                }
            }

            // GUARANTEE UNIQUE EMAIL: Combine first name with the unique rollNo
            const safeFirstName = faker.person.firstName().replace(/[^a-zA-Z]/g, '').toLowerCase();
            const uniqueEmail = `${safeFirstName}.${rollNo.toLowerCase()}@nith.ac.in`;

            // Create the student object
            studentsToInsert.push({
                name: faker.person.fullName(),
                email: uniqueEmail,
                password: 'hashed_password_123', // In production, use hashed passwords
                hostel: assignedHostel.name,
                hostel_id: assignedHostel.id,
                roll_no: rollNo,
                phone: faker.phone.number({ style: 'national' }),
                department: department,
                cgpa: cgpa,
                joining_year: joiningYear,
                individual_rank: individualRank,
                is_allotted: isAllotted,
                physical_room_id: physicalRoomId,
                allocated_room_id: null, // Always null for new generation
                father_name: faker.person.fullName({ sex: 'male' }),
                parent_number: faker.phone.number({ style: 'national' }),
                category: faker.helpers.arrayElement(CATEGORIES),
                blood_group: faker.helpers.arrayElement(BLOOD_GROUPS),
                state: faker.helpers.arrayElement(STATES),
                address: faker.location.streetAddress(),
                pincode: faker.location.zipCode('######')
            });
        }

        // ==========================================
        // 5. BULK INSERT INTO DATABASE
        // ==========================================
        console.log(`🚀 Inserting records into the database in bulk...`);
        
        await client.query('BEGIN');

        for (let i = 0; i < studentsToInsert.length; i += CHUNK_SIZE) {
            const chunk = studentsToInsert.slice(i, i + CHUNK_SIZE);
            
            const valueStrings = [];
            const queryParams = [];
            let paramIndex = 1;

            chunk.forEach(s => {
                const rowParams = [];
                for (let col = 0; col < 21; col++) {
                    rowParams.push(`$${paramIndex++}`);
                }
                valueStrings.push(`(${rowParams.join(', ')})`);
                
                queryParams.push(
                    s.name, s.email, s.password, s.hostel, s.hostel_id, s.roll_no, s.phone, s.department,
                    s.cgpa, s.joining_year, s.individual_rank, s.is_allotted, s.physical_room_id, s.allocated_room_id,
                    s.father_name, s.parent_number, s.category, s.blood_group, s.state, s.address, s.pincode
                );
            });

            const bulkInsertQuery = `
                INSERT INTO student (
                    name, email, password, hostel, hostel_id, roll_no, phone, department, 
                    cgpa, joining_year, individual_rank, is_allotted, physical_room_id, allocated_room_id, 
                    father_name, parent_number, category, blood_group, state, address, pincode
                ) VALUES ${valueStrings.join(', ')}
                ON CONFLICT (roll_no) DO NOTHING
            `;

            await client.query(bulkInsertQuery, queryParams);
            console.log(`   ⏳ Inserted chunk: ${i + chunk.length} / ${TOTAL_STUDENTS}...`);
        }

        // ==========================================
        // 6. BULK UPDATE ROOM OCCUPANCIES
        // ==========================================
        const roomsToUpdate = roomsTracker.filter(r => r.current_occupancy > 0);

        if (roomsToUpdate.length > 0) {
            console.log(`🛏️ Bulk updating ${roomsToUpdate.length} room occupancies in a single query...`);

            const updateValues = [];
            const updateParams = [];
            let paramIndex = 1;

            roomsToUpdate.forEach(room => {
                // Cast types explicitly to prevent Postgres inference errors
                updateValues.push(`($${paramIndex++}::uuid, $${paramIndex++}::int)`);
                updateParams.push(room.id, room.current_occupancy);
            });

            const bulkUpdateQuery = `
                UPDATE room AS r
                SET current_occupancy = v.occupancy
                FROM (VALUES ${updateValues.join(', ')}) AS v(id, occupancy)
                WHERE r.id = v.id
            `;

            await client.query(bulkUpdateQuery, updateParams);
        }

        await client.query('COMMIT');
        console.log('🎉 Successfully seeded 3,000 students using bulk inserts!');

    } catch (error) {
        try { await client.query('ROLLBACK'); } catch(e) {}
        console.error('❌ Error seeding database:', error);
    } finally {
        client.release();
        await pool.end();
        console.log('🔌 Database connection closed.');
    }
}

runSeeder();