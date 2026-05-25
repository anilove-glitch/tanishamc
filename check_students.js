import pool from "./src/db/pool.js";

async function main() {
  const args = process.argv.slice(2);
  const rollArgIndex = args.findIndex((arg) => arg === "--roll");
  const rollNo = rollArgIndex >= 0 ? args[rollArgIndex + 1] : null;
  const limitArgIndex = args.findIndex((arg) => arg === "--limit");
  const limitRaw = limitArgIndex >= 0 ? args[limitArgIndex + 1] : "20";
  const limit = Number.parseInt(limitRaw, 10);

  if (rollArgIndex >= 0 && !rollNo) {
    throw new Error("Missing value for --roll. Example: --roll 24bcs033");
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("Invalid --limit value. Example: --limit 10");
  }

  const countRes = await pool.query("SELECT COUNT(*)::int AS total FROM student");
  console.log(`Total students in table: ${countRes.rows[0].total}`);

  let query = `
    SELECT id, name, roll_no, email, department, joining_year, individual_rank, hostel, created_at
    FROM student
  `;
  const values = [];

  if (rollNo) {
    query += " WHERE roll_no = $1";
    values.push(rollNo);
  }

  query += rollNo
    ? " ORDER BY created_at DESC"
    : " ORDER BY created_at DESC LIMIT $1";

  if (!rollNo) {
    values.push(limit);
  }

  const res = await pool.query(query, values);
  console.log(`Rows returned: ${res.rowCount}`);

  if (res.rowCount === 0) {
    console.log("No matching student records found.");
    return;
  }

  console.table(res.rows);
}

main()
  .catch((err) => {
    console.error("Failed to check student table entries:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
