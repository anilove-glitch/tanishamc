import('./src/db/pool.js').then(async m => {
  const res = await m.default.query("SELECT * FROM student WHERE roll_no = '24bcs033'");
  console.log('Ayush Data:', res.rows[0]);
  process.exit(0);
});
