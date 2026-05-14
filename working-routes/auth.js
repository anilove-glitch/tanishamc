import express from 'express';
import jwt from 'jsonwebtoken';
import pool from '../src/db/db.js';
import auth from '../src/middleware/middleware.js';
import dotenv from 'dotenv';
dotenv.config();


const router = express.Router();


router.get('/login', (req,res)=>{
    const {token, role}=req.headers;
    if (!token || !role) {
        return res.status(400).json({ message: 'Token and role are required' });
    }
    try{
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.role !== role) {
            return res.status(401).json({ message: 'Unauthorized' });
        }
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Invalid token' });
    }

})

router.post('/signup', async (req,res)=>{
    const data = req.body;

    if (!data || !data.role) {
        return res.status(400).json({ message: 'Role is required' });
    }

    try {
        let result;
        let user;

        if (data.role === 'student') {
            const { name, email, password, room, phone_number, department, hostel } = data;
            if (!name || !email || !password) {
                return res.status(400).json({ message: 'Missing required fields for student' });
            }

            result = await pool.query(
                'INSERT INTO students (name, email, password, role, room, phone_number, department, hostel) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
                [name, email, password, 'student', room || null, phone_number || null, department || null, hostel || null]
            );
            user = result.rows[0];
        } else if (data.role === 'attendant' || data.role === 'attendant') {
            const { name, email, password, hostel } = data;
            if (!name || !email || !password) {
                return res.status(400).json({ message: 'Missing required fields for attendant' });
            }

            result = await pool.query(
                'INSERT INTO attendants (name, email, password, hostel) VALUES ($1,$2,$3,$4) RETURNING *',
                [name, email, password, hostel || null]
            );
            user = result.rows[0];
        } else if (data.role === 'guard') {
            const { name, email, password } = data;
            if (!name || !email || !password) {
                return res.status(400).json({ message: 'Missing required fields for guard' });
            }

            result = await pool.query(
                'INSERT INTO guards (name, email, password) VALUES ($1,$2,$3) RETURNING *',
                [name, email, password]
            );
            user = result.rows[0];
        } else {
            return res.status(400).json({ message: 'Invalid role' });
        }

        const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '1h' });

        return res.status(201).json({ message: 'User created successfully', user, token });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

export default router;