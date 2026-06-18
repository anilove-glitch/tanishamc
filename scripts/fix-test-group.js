import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

async function fixTestGroup() {
    const { default: pool } = await import('./src/db/pool.js');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Find the test user
        const testRes = await client.query("SELECT * FROM student WHERE name = 'test'");
        const testUser = testRes.rows[0];
        
        if (!testUser) {
            console.log('No test user found.');
            process.exit(0);
        }

        console.log(`Found test user ${testUser.id} in group ${testUser.group_id}`);

        // Create a brand new group with test user as the primary applicant
        const groupRes = await client.query(
            "INSERT INTO housing_group (primary_applicant_id, status) VALUES ($1, 'FORMING') RETURNING id",
            [testUser.id]
        );
        const newGroupId = groupRes.rows[0].id;
        
        // Update the test user to point to the new group
        await client.query("UPDATE student SET group_id = $1 WHERE id = $2", [newGroupId, testUser.id]);
        
        await client.query('COMMIT');
        console.log(`Test user is now the primary applicant of group ${newGroupId}`);
    } catch(e) {
        await client.query('ROLLBACK');
        console.error(e);
    } finally {
        client.release();
        process.exit(0);
    }
}
fixTestGroup();
