/**
 * migrate.js
 * ============================================================
 * ONE-SHOT database migration script.
 *
 * What it does:
 *  1. Drops all old tables (student, attendent, guard, complaint,
 *     outpass) and their dependents — CASCADE.
 *  2. Drops old enum types if present.
 *  3. Runs the new schema from:
 *       hostel_backend/src/roomallocation/db/db.sql
 *  4. Runs extension SQL from:
 *       hostel_backend/src/db/extensions.sql
 *     (fixes authority_level check, adds extra columns)
 *
 * Usage:
 *   node src/db/migrate.js
 * ============================================================
 */

import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false,
    },
});

// ============================================================
// SQL to drop all OLD tables (legacy schema)
// ============================================================
const DROP_OLD_TABLES = `
-- Drop old tables in dependency order (children first)
DROP TABLE IF EXISTS outpass    CASCADE;
DROP TABLE IF EXISTS complaint  CASCADE;
DROP TABLE IF EXISTS attendent  CASCADE;
DROP TABLE IF EXISTS guard      CASCADE;
DROP TABLE IF EXISTS student    CASCADE;

-- Drop old enum types if they exist (from old schema attempts)
DROP TYPE IF EXISTS request_type_enum    CASCADE;
DROP TYPE IF EXISTS request_status_enum  CASCADE;
DROP TYPE IF EXISTS batch_status_enum    CASCADE;
DROP TYPE IF EXISTS assigned_by_enum     CASCADE;
DROP TYPE IF EXISTS system_phase_enum    CASCADE;
DROP TYPE IF EXISTS group_status_enum    CASCADE;
DROP TYPE IF EXISTS allocation_result_enum CASCADE;
DROP TYPE IF EXISTS assignment_status_enum CASCADE;

-- Drop new tables if they already exist (full reset)
DROP TABLE IF EXISTS submission_preferences  CASCADE;
DROP TABLE IF EXISTS allocation_submissions  CASCADE;
DROP TABLE IF EXISTS group_requests          CASCADE;
DROP TABLE IF EXISTS room_assignments        CASCADE;
DROP TABLE IF EXISTS housing_groups          CASCADE;
DROP TABLE IF EXISTS visit_logs              CASCADE;
DROP TABLE IF EXISTS outpasses               CASCADE;
DROP TABLE IF EXISTS complaints              CASCADE;
DROP TABLE IF EXISTS students                CASCADE;
DROP TABLE IF EXISTS batches                 CASCADE;
DROP TABLE IF EXISTS rooms                   CASCADE;
DROP TABLE IF EXISTS hostels                 CASCADE;
DROP TABLE IF EXISTS admins                  CASCADE;

-- Drop views
DROP VIEW IF EXISTS v_housing_groups_with_size CASCADE;

-- Drop functions
DROP FUNCTION IF EXISTS check_group_capacity()              CASCADE;
DROP FUNCTION IF EXISTS prevent_illegal_group_modification() CASCADE;
DROP FUNCTION IF EXISTS validate_primary_applicant()        CASCADE;
DROP FUNCTION IF EXISTS handle_primary_applicant_leave()    CASCADE;
DROP FUNCTION IF EXISTS sync_student_room_snapshot()        CASCADE;
DROP FUNCTION IF EXISTS recalculate_room_occupancy()        CASCADE;
DROP FUNCTION IF EXISTS validate_submission_leader()        CASCADE;
DROP FUNCTION IF EXISTS validate_submission_window()        CASCADE;
DROP FUNCTION IF EXISTS assign_student_to_room(INTEGER, UUID, TEXT) CASCADE;
`;

async function runMigration() {
    await client.connect();
    console.log('✅ Connected to database');

    try {
        // -------------------------------------------------------
        // STEP 1: Drop all old and existing new tables
        // -------------------------------------------------------
        console.log('\n🗑️  Dropping old tables and types...');
        await client.query(DROP_OLD_TABLES);
        console.log('✅ Old schema cleared');

        // -------------------------------------------------------
        // STEP 2: Run new base schema (db.sql — unmodified)
        // -------------------------------------------------------
        const newSchemaPath = path.resolve(
            __dirname,
            '../roomallocation/db/db.sql'
        );
        const newSchema = fs.readFileSync(newSchemaPath, 'utf8');

        console.log('\n📦 Running new schema from roomallocation/db/db.sql...');

        // PostgreSQL does not accept:
        //   AFTER INSERT OR UPDATE OF col1 OR UPDATE OF col2 OR DELETE
        // It requires:
        //   AFTER INSERT OR UPDATE OF col1, col2 OR DELETE
        // Since db.sql cannot be modified, patch in-memory before execution.
        const patchedSchema = newSchema.replace(
            /AFTER INSERT\s*\n\s*OR UPDATE OF room_id\s*\n\s*OR UPDATE OF assignment_status\s*\n\s*OR DELETE/g,
            'AFTER INSERT OR UPDATE OF room_id, assignment_status OR DELETE'
        );

        await client.query(patchedSchema);
        console.log('✅ New base schema created');

        // -------------------------------------------------------
        // STEP 3: Run extension SQL (extra columns, level 4)
        // -------------------------------------------------------
        const extensionsPath = path.resolve(
            __dirname,
            './extensions.sql'
        );
        const extensions = fs.readFileSync(extensionsPath, 'utf8');

        console.log('\n🔧 Applying extensions (authority_level 4, extra columns)...');
        await client.query(extensions);
        console.log('✅ Extensions applied');

        // -------------------------------------------------------
        // STEP 4: Verify tables exist
        // -------------------------------------------------------
        const verifyRes = await client.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_type = 'BASE TABLE'
            ORDER BY table_name;
        `);

        console.log('\n📋 Tables in database:');
        verifyRes.rows.forEach(r => console.log('  •', r.table_name));

        console.log('\n🎉 Migration completed successfully!\n');

    } catch (err) {
        console.error('\n❌ Migration failed:', err.message);
        console.error(err);
        process.exit(1);
    } finally {
        await client.end();
    }
}

runMigration();
