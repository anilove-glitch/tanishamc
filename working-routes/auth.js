import express from 'express';
import jwt from 'jsonwebtoken';
import pool from '../src/db/db.js';
import auth from '../src/middleware/middleware.js';
import dotenv from 'dotenv';
dotenv.config();


const router = express.Router();


const ROLE_TABLES = {
    student: 'student',
    attendant: 'attendent',
    guard: 'guard',
};

router.get('/login', (req, res) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : req.headers.token;
    const { role } = req.headers;

    if (!token || !role) {
        return res.status(400).json({ message: 'Token and role are required' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (decoded.role !== role) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        return res.status(200).json({ message: 'Token is valid', user: decoded });
    } catch (err) {
        return res.status(401).json({ message: 'Invalid token' });
    }
});

router.post('/login', async (req, res) => {
    const { email, password, role } = req.body;

    if (!email || !password || !role) {
        return res.status(400).json({ message: 'Email, password and role are required' });
    }

    const tableName = ROLE_TABLES[role];

    if (!tableName) {
        return res.status(400).json({ message: 'Invalid role' });
    }

    try {
        const result = await pool.query(
            `SELECT * FROM ${tableName} WHERE email = $1 AND password = $2 LIMIT 1`,
            [email, password]
        );

        const user = result.rows[0];

        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, role },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        return res.status(200).json({ message: 'Login successful', user, token });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

router.get('/me', auth, async (req, res) => {
    const { id, email, role } = req.user;
    const tableName = ROLE_TABLES[role];

    if (!tableName) {
        return res.status(400).json({ message: 'Invalid role' });
    }

    try {
        const result = await pool.query(
            `SELECT * FROM ${tableName} WHERE id = $1 AND email = $2 LIMIT 1`,
            [id, email]
        );

        const user = result.rows[0];

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        return res.status(200).json({ user, role });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

router.post('/signup', async (req, res) => {
    const data = req.body;

    if (!data || !data.role) {
        return res.status(400).json({ message: 'Role is required' });
    }

    try {
        let result;
        let user;

        if (data.role === 'student') {
            const { name, email, password, room, phone, department, hostel } = data;
            if (!name || !email || !password || !room || !phone || !department || !hostel) {
                return res.status(400).json({ message: 'Missing required fields for student' });
            }
            result = await pool.query(
                'INSERT INTO student (name, email, password, hostel, room, phone, department) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
                [name, email, password, hostel, room, phone, department]
            );
            user = result.rows[0];
        } else if (data.role === 'attendant') {
            const { name, email, password, hostel ,phone } = data;
            if (!name || !email || !password || !phone || !hostel) {
                return res.status(400).json({ message: 'Missing required fields for attendant' });
            }
            result = await pool.query(
                'INSERT INTO attendent (name, email, password, hostel , phone) VALUES ($1,$2,$3,$4,$5) RETURNING *',
                [name, email, password, hostel,phone]
            );
            user = result.rows[0];
        } else if (data.role === 'guard') {
            const { name, email, password, phone } = data;
            if (!name || !email || !password || !phone) {
                return res.status(400).json({ message: 'Missing required fields for guard' });
            }
            result = await pool.query(
                'INSERT INTO guard (name, email, password, phone) VALUES ($1,$2,$3,$4) RETURNING *',
                [name, email, password, phone]
            );
            user = result.rows[0];
        } else {
            return res.status(400).json({ message: 'Invalid role' });
        }

        const token = jwt.sign({ id: user.id, email: user.email, role: data.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
        return res.status(201).json({ message: 'User created successfully', user, token });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

export default router;