import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

async function main() {
  await client.connect();

  const res = await client.query(`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_type = 'BASE TABLE'
    ORDER BY table_schema, table_name;
  `);

  console.table(res.rows);

  await client.end();
}

main().catch(console.error);