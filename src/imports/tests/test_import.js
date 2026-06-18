import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pool from '../../db/pool.js';
import { previewImport, executeImport } from '../import.service.js';

const TEST_FILE_PATH = path.join(process.cwd(), 'uploads', 'temp', 'test_import.csv');

// Create test CSV content
const csvContent = `Student Name,Email Address,Branch,Hostel Code,Roll Number,Year Joined,Caste Category,GPA,Phone Number,Merit No
John Doe,johndoe@nith.ac.in,CSE,1,22bcs100,2022,GENERAL,9.2,9999999999,1
Jane Smith,janesmith@nith.ac.in,ECE,1,22bec101,2022,OBC,8.5,8888888888,2
Duplicate Email,johndoe@nith.ac.in,CSE,1,22bcs102,2022,SC,7.0,7777777777,
Invalid Hostel,invalid@nith.ac.in,ME,999,22bme103,2022,ST,6.5,6666666666,3
Missing Fields,,,,22bce104,,,,,
`;

async function runTest() {
    console.log("=== Setting up test ===");
    
    // Ensure temp dir exists
    const tempDir = path.dirname(TEST_FILE_PATH);
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    fs.writeFileSync(TEST_FILE_PATH, csvContent);
    console.log("Created test CSV file.");

    try {
        console.log("\n=== STEP 1: Preview Import ===");
        const preview = await previewImport(TEST_FILE_PATH, 'test_import.csv');
        console.log("Preview Response:");
        console.log(JSON.stringify(preview, null, 2));

        console.log("\n=== STEP 2: Execute Import ===");
        
        // Simulating admin reviewing mapping and assigning 'hostel_id' manually
        const finalMappings = {
            ...preview.detectedMappings,
            hostel_id: 'Hostel Code'
        };

        console.log("Final Mappings used for execution:");
        console.log(finalMappings);

        const execution = await executeImport('test_import.csv', finalMappings);
        
        console.log("\nExecution Report:");
        console.log(JSON.stringify(execution, null, 2));

    } catch (err) {
        console.error("Test failed:", err);
    } finally {
        fs.unlinkSync(TEST_FILE_PATH);
        await pool.end();
        console.log("\nCleaned up.");
    }
}

runTest();
