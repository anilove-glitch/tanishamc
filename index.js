import express from 'express';
import pool from './src/db/db.js';
import authRoutes from './working-routes/auth.js';
import complaintRoutes from './working-routes/complaint.js';
import outpassRoutes from './working-routes/outpass.js';
import groupRoutes from './src/roomallocation/groups/groups.routes.js';
import roomRoutes from './src/roomallocation/rooms/rooms.routes.js';
import hostelRoutes from './src/roomallocation/hostels/hostels.routes.js';
import preferenceRoutes from './src/roomallocation/preferences/preferences.routes.js';
import allocationRoutes from './src/roomallocation/allocation.routes.js';

const app = express();
const port = process.env.PORT || 4000;

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'http://localhost:5173');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, role, token');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});

app.use(express.json());
app.use('/auth', authRoutes);
app.use('/complaint', complaintRoutes);
app.use('/outpass', outpassRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/hostels', hostelRoutes);
app.use('/api/preferences', preferenceRoutes);
app.use('/api/allocation', allocationRoutes);


app.get('/', (req, res) => {
    res.send('Hello World!');
});

app.get('/add-student', async (req, res) => {

    try {

        const query = `
            INSERT INTO students (
                name,
                roll_no,
                email,
                password_hash,
                cgpa
            )
            VALUES (
                'Student2',
                '24BMA002',
                'student2@gmail.com',
                'test123',
                9.1
            )
            RETURNING *;
        `;

        const result =
            await pool.query(query);

        res.json({
            success: true,
            student: result.rows[0]
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });

    }

});

app.get('/groups', async (req, res) => {

    try {

        const result =
            await pool.query(`
                SELECT *
                FROM housing_groups
            `);

        res.json({
            success: true,
            groups: result.rows
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });

    }

});

app.get('/requests', async (req, res) => {

    try {

        const result =
            await pool.query(`
                SELECT *
                FROM group_requests
            `);

        res.json({
            success: true,
            requests: result.rows
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });

    }

});

app.get('/students', async (req, res) => {

    try {

        const result =
            await pool.query(`
                SELECT
                    id,
                    name,
                    group_id
                FROM students
            `);

        res.json({
            success: true,
            students: result.rows
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });

    }

});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});