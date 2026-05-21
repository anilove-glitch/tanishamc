import 'dotenv/config';
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

pool.query(`
  SELECT trigger_name, event_manipulation, event_object_table, action_statement
  FROM information_schema.triggers
  WHERE trigger_name ILIKE '%primary_applicant%' 
     OR action_statement ILIKE '%primary_applicant%'
     OR trigger_name ILIKE '%validate%';
`).then(res => {
  console.log(JSON.stringify(res.rows, null, 2));
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
