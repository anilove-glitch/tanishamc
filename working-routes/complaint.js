import express from 'express';
import pool from '../src/db/db.js';
import auth from '../src/middleware/middleware.js';

const router = express.Router();

router.get('/by-hostel', auth, async (req, res) => {
    const { hostel } = req.query;

    if (!hostel) {
        return res.status(400).json({ message: 'hostel query parameter is required' });
    }

    try {
        const complaints = await pool.query(
            `SELECT c.*, s.name as student_name, s.room as student_room, s.phone as student_phone 
             FROM complaint c 
             JOIN student s ON c.student_id = s.id 
             WHERE c.hostel = $1 AND c.status = $2 
             ORDER BY c.date_created DESC`,
            [hostel, 'pending']
        );

        return res.status(200).json({ complaints: complaints.rows });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

router.put('/update-complaint', auth, async (req, res) => {
    const { complaint_id, status } = req.body;
    const { id: attendant_id } = req.user;

    if (!complaint_id || !status) {
        return res.status(400).json({ message: 'complaint_id and status are required' });
    }

    try {
        const result = await pool.query(
            `UPDATE complaint SET status = $1, resolved_by = $2, resolved_at = NOW() 
             WHERE id = $3 AND status != 'resolved'
             RETURNING *`,
            [status, attendant_id, complaint_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Complaint not found or already resolved' });
        }

        return res.status(200).json({ message: 'Complaint updated successfully', complaint: result.rows[0] });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

export default router;