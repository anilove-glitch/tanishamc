import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

// Supports DATABASE_URL (Railway/cloud) or individual DB_* vars
const pool = process.env.DATABASE_URL
    ? new Pool({
          connectionString: process.env.DATABASE_URL,
          ssl: { rejectUnauthorized: false },
      })
    : new Pool({
          user:     process.env.DB_USER,
          host:     process.env.DB_HOST,
          database: process.env.DB_NAME,
          password: process.env.DB_PASSWORD,
          port:     process.env.DB_PORT,
      });

pool.connect()
    .then(() => {
        console.log("PostgreSQL connected successfully");
    })
    .catch((err) => {
        console.error("Database connection error:", err);
    });

export default pool;