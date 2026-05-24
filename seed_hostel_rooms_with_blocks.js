import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

// The updated dataset with block allocations
const hostelsData = [
    {
        name: 'Kailash Boys Hostel', type: 'Boys', total_capacity: 612,
        rooms: [
            { block: 'A', prefix: 'K', start: 1, end: 41, capacity: 3, roomType: 'Student' },
            { block: 'B', prefix: 'K', start: 42, end: 82, capacity: 3, roomType: 'Student' },
            { block: 'C', prefix: 'K', start: 83, end: 123, capacity: 3, roomType: 'Student' },
            { block: 'D', prefix: 'K', start: 124, end: 164, capacity: 3, roomType: 'Student' },
            { block: 'E', prefix: 'K', start: 165, end: 204, capacity: 3, roomType: 'Student' }
        ]
    },
    {
        name: 'Himgiri Boys Hostel', type: 'Boys', total_capacity: 493,
        rooms: [
            { block: 'A', prefix: 'H-S', start: 1, end: 235, capacity: 1, roomType: 'Student' },
            { block: 'B', prefix: 'H-S', start: 236, end: 471, capacity: 1, roomType: 'Student' },
            { block: 'C', prefix: 'H-D', start: 1, end: 11, capacity: 2, roomType: 'Student' }
        ]
    },
    {
        name: 'Udaygiri Boys Hostel', type: 'Boys', total_capacity: 489,
        rooms: [
            { block: 'A', prefix: 'U', start: 1, end: 82, capacity: 3, roomType: 'Student' },
            { block: 'B', prefix: 'U', start: 83, end: 163, capacity: 3, roomType: 'Student' }
        ]
    },
    {
        name: 'Neelkanth Boys Hostel', type: 'Boys', total_capacity: 441,
        rooms: [
            { block: 'A', prefix: 'N-T', start: 1, end: 73, capacity: 3, roomType: 'Student' },
            { block: 'B', prefix: 'N-T', start: 74, end: 145, capacity: 3, roomType: 'Student' },
            { block: 'C', prefix: 'N-D', start: 1, end: 2, capacity: 2, roomType: 'Student' }
        ]
    },
    {
        name: 'Dhauladhar Boys Hostel', type: 'Boys', total_capacity: 165,
        rooms: [
            { block: 'A', prefix: 'D-T', start: 1, end: 24, capacity: 3, roomType: 'Student' },
            { block: 'B', prefix: 'D-S', start: 1, end: 91, capacity: 1, roomType: 'Student' },
            { block: 'Admin', prefix: 'D-G', start: 1, end: 2, capacity: 2, roomType: 'Guest' }
        ]
    },
    {
        name: 'Vindhyachal Boys Hostel', type: 'Boys', total_capacity: 166,
        rooms: [
            { block: 'A', prefix: 'V', start: 1, end: 83, capacity: 1, roomType: 'Student' },
            { block: 'B', prefix: 'V', start: 84, end: 166, capacity: 1, roomType: 'Student' }
        ]
    },
    {
        name: 'Shivalik Boys Hostel', type: 'Boys', total_capacity: 130,
        rooms: [
            { block: 'A', prefix: 'SH-6', start: 1, end: 15, capacity: 6, roomType: 'Student' },
            { block: 'B', prefix: 'SH-4', start: 1, end: 10, capacity: 4, roomType: 'Student' }
        ]
    },
    {
        name: 'Ambika Girls Hostel', type: 'Girls', total_capacity: 351,
        rooms: [
            { block: 'A', prefix: 'AM-D', start: 1, end: 66, capacity: 2, roomType: 'Student' },
            { block: 'B', prefix: 'AM-T', start: 1, end: 26, capacity: 3, roomType: 'Student' },
            { block: 'C', prefix: 'AM-4', start: 1, end: 4, capacity: 4, roomType: 'Student' },
            { block: 'D', prefix: 'AM-5', start: 1, end: 25, capacity: 5, roomType: 'Student' }
        ]
    },
    {
        name: 'Parvati Girls Hostel', type: 'Girls', total_capacity: 162,
        rooms: [
            { block: 'A', prefix: 'P-S', start: 1, end: 54, capacity: 1, roomType: 'Student' },
            { block: 'B', prefix: 'P-T', start: 1, end: 36, capacity: 3, roomType: 'Student' },
            { block: 'Admin', prefix: 'P-G', start: 1, end: 2, capacity: 2, roomType: 'Guest' },
            { block: 'Admin', prefix: 'P-VIS', start: 1, end: 1, capacity: 4, roomType: 'Visitor' }
        ]
    },
    {
        name: 'Mani-Mahesh Girls Hostel', type: 'Girls', total_capacity: 167,
        rooms: [
            { block: 'A', prefix: 'MM', start: 1, end: 84, capacity: 1, roomType: 'Student' },
            { block: 'B', prefix: 'MM', start: 85, end: 167, capacity: 1, roomType: 'Student' }
        ]
    },
    {
        name: 'Aravali Girls Hostel', type: 'Girls', total_capacity: 60,
        rooms: [
            { block: 'A', prefix: 'AR', start: 1, end: 15, capacity: 2, roomType: 'Student' },
            { block: 'B', prefix: 'AR', start: 16, end: 30, capacity: 2, roomType: 'Student' }
        ]
    },
    {
        name: 'Satpura Hostel', type: 'Boys', total_capacity: 297,
        rooms: [
            { block: 'A', prefix: 'SAT', start: 1, end: 50, capacity: 4, roomType: 'Student' },
            { block: 'B', prefix: 'SAT', start: 51, end: 99, capacity: 4, roomType: 'Student' }
        ]
    }
];

function normalizeRoomType(roomType) {
    if (roomType === 'Visitor') return 'Reserved';
    return roomType;
}

async function seedDatabase() {
    const client = await pool.connect();
    console.log('Connected to database. Starting seed process...');

    try {
        await client.query('BEGIN');

        let totalRooms = 0;

        for (const hostel of hostelsData) {
            console.log(`Upserting ${hostel.name}...`);

            const hostelInsertQuery = `
                INSERT INTO hostel (name, type, total_capacity)
                VALUES ($1, $2, $3)
                ON CONFLICT (name)
                DO UPDATE SET
                    type = EXCLUDED.type,
                    total_capacity = EXCLUDED.total_capacity
                RETURNING id;
            `;

            const hostelResult = await client.query(hostelInsertQuery, [
                hostel.name,
                hostel.type,
                hostel.total_capacity
            ]);

            const hostelId = hostelResult.rows[0].id;

            const roomValues = [];
            let paramIndex = 1;
            const insertParams = [];

            hostel.rooms.forEach((config) => {
                for (let i = config.start; i <= config.end; i++) {
                    const roomNumber = `${config.prefix}-${i}`;
                    const roomType = normalizeRoomType(config.roomType);

                    roomValues.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4})`);

                    insertParams.push(hostelId, config.block, roomNumber, config.capacity, roomType);

                    paramIndex += 5;
                    totalRooms++;
                }
            });

            if (roomValues.length > 0) {
                const roomInsertQuery = `
                    INSERT INTO room (hostel_id, block, room_number, max_capacity, room_type)
                    VALUES ${roomValues.join(', ')}
                    ON CONFLICT (hostel_id, block, room_number)
                    DO UPDATE SET
                        max_capacity = EXCLUDED.max_capacity,
                        room_type = EXCLUDED.room_type;
                `;
                await client.query(roomInsertQuery, insertParams);
            }
        }

        await client.query('COMMIT');
        console.log(`✅ Database seeded successfully! Total room rows processed: ${totalRooms}`);
        console.log('Note: roomType "Visitor" from input was mapped to "Reserved" to match room_type_enum.');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error seeding database. Transaction rolled back.', error.message);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

seedDatabase();
