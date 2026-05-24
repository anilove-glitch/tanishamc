import 'dotenv/config';
import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:5000/api';

async function test() {
    try {
        console.log("=== Testing First-Year Allocation System ===");

        // Note: For this to work, there needs to be a hostel with empty rooms and some unassigned students
        // with the correct roll_no prefix (e.g. 26...)

        // Step 1: We need a hostelId to test with.
        const res = await fetch(`${BASE_URL}/hostels`);
        const hostelsData = await res.json();
        const hostelId = hostelsData?.hostels?.[0]?.id;

        if (!hostelId) {
            console.log("No hostels found in the database. Run the seed script first.");
            return;
        }

        console.log(`Using Hostel ID: ${hostelId}`);

        // Step 2: Get Analytics
        console.log("\n[1] Fetching Analytics...");
        const analyticsRes = await fetch(`${BASE_URL}/warden/analytics/${hostelId}`);
        const analytics = await analyticsRes.json();
        console.log("Analytics Response:", JSON.stringify(analytics, null, 2));

        // Step 3: Test Allocation with a dummy layout
        // We will attempt to grab 1 room from the analytics (if any exist)
        const availableRooms = analytics.analytics?.availableRooms || [];
        if (availableRooms.length === 0) {
            console.log("\nNo available rooms found for this hostel. Cannot test allocation.");
            return;
        }

        // We need the actual room IDs, but analytics only gives count. Let's fetch the room map.
        const roomsRes = await fetch(`${BASE_URL}/allocation/rooms/${hostelId}`);
        const roomsData = await roomsRes.json();
        const emptyRoomId = roomsData.rooms?.find(r => r.current_occupancy === 0 && r.max_capacity >= 2)?.id;

        if (!emptyRoomId) {
            console.log("\nNo empty rooms with capacity >= 2 found.");
            return;
        }

        console.log(`\n[2] Attempting Allocation on Room ID: ${emptyRoomId}...`);
        
        const layoutPayload = {
            hostelId,
            targetRoomIds: [emptyRoomId],
            layoutConfig: {
                capacity: 2,
                branchDiversity: "ALLOW_SAME",
                nodes: [
                    { id: "bed_1", state: "ANY", branch: null },
                    { id: "bed_2", state: "ANY", branch: null }
                ]
            }
        };

        const allocateRes = await fetch(`${BASE_URL}/warden/allocate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(layoutPayload)
        });

        const allocateData = await allocateRes.json();
        console.log("Allocate Response:", JSON.stringify(allocateData, null, 2));

        if (allocateData.success) {
            console.log("\n[3] Rolling back the allocation to leave the DB clean...");
            const rollbackRes = await fetch(`${BASE_URL}/warden/rollback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hostelId, roomIds: [emptyRoomId] })
            });
            const rollbackData = await rollbackRes.json();
            console.log("Rollback Response:", JSON.stringify(rollbackData, null, 2));
        }

    } catch (err) {
        console.error("Test script failed:", err);
    }
}

test();
