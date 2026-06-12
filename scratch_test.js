import 'dotenv/config';
import { assignGroupsToBatches } from '../hostel_backend/src/roomallocation/services/softLock.service.js';

async function test() {
    try {
        const result = await assignGroupsToBatches(1); // Assuming hostelId 1
        console.log("Result:", result);
    } catch (e) {
        console.error("Error:", e);
    }
    process.exit(0);
}
test();
