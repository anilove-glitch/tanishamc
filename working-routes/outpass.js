import express from 'express';
import pool from '../src/db/db.js';
import auth from '../src/middleware/middleware.js';

const router = express.Router();

router.post('/apply', auth, async (req, res) => {
    const { reason, destination, date_from, date_to, hostel, room, outpass_type } = req.body;
    const { id: student_id } = req.user;

    const normalizedType = String(outpass_type || '').toLowerCase();
    const isLocalOutpass = normalizedType === 'local' || normalizedType === 'market';
    const today = new Date().toISOString().split('T')[0];

    const finalDestination = isLocalOutpass ? 'Market' : destination;
    const finalDateFrom = isLocalOutpass ? today : date_from;
    const finalDateTo = isLocalOutpass ? today : date_to;

    if (!reason || !hostel || !room || !outpass_type) {
        return res.status(400).json({ message: 'Missing required fields' });
    }

    if (!isLocalOutpass && (!finalDestination || !finalDateFrom || !finalDateTo)) {
        return res.status(400).json({ message: 'Missing required fields for outstation outpass' });
    }

    try {
        const result = await pool.query(
            `INSERT INTO outpass (student_id, reason, outpass_type, destination, date_from, date_to, hostel, room, status, date_created)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
             RETURNING *`,
            [
                student_id,
                reason,
                normalizedType || outpass_type,
                finalDestination,
                finalDateFrom,
                finalDateTo,
                hostel,
                room,
                'pending',
            ]
        );

        const outpass = result.rows[0];
        return res.status(201).json({ message: 'Outpass application submitted successfully', outpass });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
    }
});


router.get('/my-outpasses', auth, async (req, res) => {
    const { id: student_id } = req.user;

    try {
        const outpasses = await pool.query(
            'SELECT * FROM outpass WHERE student_id = $1 ORDER BY date_created DESC',
            [student_id]
        );
        return res.status(200).json({ outpasses: outpasses.rows });
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

router.put('/update-outpass', auth, async (req, res) => {
    const { outpass_id, status } = req.body;
    const { id: attendant_id } = req.user;

    if (!outpass_id || !status) {
        return res.status(400).json({ message: 'outpass_id and status are required' });
    }

    try {
        const result = await pool.query(
            `UPDATE outpass SET status = $1, approved_by = $2, approved_at = NOW() 
             WHERE id = $3 AND status = 'pending'
             RETURNING *`,
            [status, attendant_id, outpass_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Outpass not found or not in pending status' });
        }

        return res.status(200).json({ message: 'Outpass updated successfully', outpass: result.rows[0] });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

router.get('/by-hostel', auth, async (req, res) => {
    const { hostel } = req.query;

    if (!hostel) {
        return res.status(400).json({ message: 'hostel query parameter is required' });
    }

    try {
        const outpasses = await pool.query(
            `SELECT op.*, s.name as student_name, s.room as student_room, s.phone as student_phone 
             FROM outpass op 
             JOIN student s ON op.student_id = s.id 
             WHERE op.hostel = $1 AND op.status = $2 
             ORDER BY op.date_created DESC`,
            [hostel, 'pending']
        );

        return res.status(200).json({ outpasses: outpasses.rows });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
    }
});



router.get('/all-approved', auth, async (req, res) => {
    try {
        const outpasses = await pool.query(
            `SELECT op.*, s.name as student_name, s.room as student_room, s.phone as student_phone, s.department 
             FROM outpass op 
             JOIN student s ON op.student_id = s.id 
             WHERE op.status = $1 AND op.approved_by IS NOT NULL
             ORDER BY op.hostel, op.date_created DESC`,
            ['approved']
        );

        return res.status(200).json({ outpasses: outpasses.rows });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

router.get('/approved-by-hostel', auth, async (req, res) => {
    const { hostel } = req.query;

    if (!hostel) {
        return res.status(400).json({ message: 'hostel query parameter is required' });
    }

    try {
        const outpasses = await pool.query(
            `SELECT op.*, s.name as student_name, s.room as student_room, s.phone as student_phone 
             FROM outpass op 
             JOIN student s ON op.student_id = s.id 
             WHERE op.hostel = $1 AND op.status = $2 AND op.approved_by IS NOT NULL
             ORDER BY op.date_created DESC`,
            [hostel, 'approved']
        );

        return res.status(200).json({ outpasses: outpasses.rows });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

router.put('/record-entry', auth, async (req, res) => {
    const { outpass_id, action, gate } = req.body;
    const { id: guard_id } = req.user;

    if (!outpass_id || !action) {
        return res.status(400).json({ message: 'outpass_id and action (exit/enter) are required' });
    }

    if (action !== 'exit' && action !== 'enter') {
        return res.status(400).json({ message: 'action must be either "exit" or "enter"' });
    }

    try {
        let updateQuery = '';
        let params = [];

        if (action === 'exit') {
            updateQuery = `UPDATE outpass SET is_exited = true, exit_time = NOW(), exit_guard_id = $1, gate = $2 
                          WHERE id = $3 AND status = 'approved'
                          RETURNING *`;
            params = [guard_id, gate || 'Main Gate', outpass_id];
        } else if (action === 'enter') {
            updateQuery = `UPDATE outpass SET is_entered = true, enter_time = NOW() 
                          WHERE id = $1 AND status = 'approved' AND is_exited = true
                          RETURNING *`;
            params = [outpass_id];
        }

        const result = await pool.query(updateQuery, params);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Outpass not found or not eligible for this action' });
        }

        return res.status(200).json({ message: `Outpass marked as ${action === 'exit' ? 'exited' : 'entered'}`, outpass: result.rows[0] });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

router.get('/monitor', async (req, res) => { 
    try {
        const outpasses = await pool.query(
            `SELECT op.*, 
                    s.name as student_name, 
                    s.room as student_room, 
                    s.phone as student_phone, 
                    s.department 
             FROM outpass op 
             JOIN student s ON op.student_id = s.id 
             ORDER BY op.date_created DESC`
        );

        return res.status(200).json({ outpasses: outpasses.rows });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

export default router;