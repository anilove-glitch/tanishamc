import pool from './src/db/pool.js';

const result = await pool.query(`
    UPDATE batches 
    SET start_time = NOW(), 
        end_time = NOW() + INTERVAL '2 hours'
    WHERE id = '3f5a498b-e232-41c0-85b1-3cc3ed5f44fc'
    RETURNING *
`);

console.log(result.rows);
process.exit();