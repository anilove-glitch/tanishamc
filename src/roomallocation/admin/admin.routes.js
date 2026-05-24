/**
 * admin.routes.js — Admin allocation scheduling endpoints
 *
 * Authority levels:
 *   1 = View only
 *   2 = Warden — can set allocation date + trigger phase transitions
 *   3 = Other admin — view + room override, but NOT set allocation date
 */

import express from 'express';
import jwt from 'jsonwebtoken';
import pool from '../../db/pool.js';
import { setCurrentPhase } from '../services/phase.service.js';

const router = express.Router();

// ─── Admin Auth Middleware ────────────────────────────────────────────────────

function adminAuth(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (!decoded.authority_level) {
            return res.status(403).json({ success: false, message: 'Not an admin account' });
        }
        req.admin = decoded;
        next();
    } catch {
        return res.status(401).json({ success: false, message: 'Invalid token' });
    }
}

function requireLevel(minLevel) {
    return (req, res, next) => {
        if ((req.admin?.authority_level ?? 0) < minLevel) {
            return res.status(403).json({
                success: false,
                message: `Requires authority level ${minLevel} or higher`
            });
        }
        next();
    };
}

// ─── GET /api/admin/hostels ───────────────────────────────────────────────────

router.get('/hostels', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, name, type, total_capacity, current_phase, is_paused,
                    allocation_date, lobby_opens_at
             FROM hostel ORDER BY name ASC`
        );
        return res.json({ success: true, hostels: result.rows });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ─── POST /api/admin/set-allocation-date ─────────────────────────────────────

router.post('/set-allocation-date', async (req, res) => {
    const { hostelId, allocationDate } = req.body;

    if (!hostelId || !allocationDate) {
        return res.status(400).json({
            success: false,
            message: 'hostelId and allocationDate are required'
        });
    }

    // Validate it's a Saturday (day = 6)
    const date = new Date(allocationDate + 'T00:00:00Z');
    if (date.getUTCDay() !== 6) {
        return res.status(400).json({
            success: false,
            message: 'Allocation date must be a Saturday'
        });
    }

    // lobby_opens_at = allocationDate - 5 days at 09:00 IST (03:30 UTC)
    const lobbyDate = new Date(date);
    lobbyDate.setUTCDate(lobbyDate.getUTCDate() - 5);
    lobbyDate.setUTCHours(3, 30, 0, 0); // 9:00 AM IST = 3:30 AM UTC

    try {
        const result = await pool.query(
            `UPDATE hostel
             SET allocation_date = $1, lobby_opens_at = $2
             WHERE id = $3
             RETURNING id, name, allocation_date, lobby_opens_at, current_phase`,
            [allocationDate, lobbyDate.toISOString(), hostelId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Hostel not found' });
        }

        return res.json({ success: true, hostel: result.rows[0] });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ─── GET /api/admin/allocation-status/:hostelId ───────────────────────────────

router.get('/allocation-status/:hostelId', async (req, res) => {
    try {
        const hostelRes = await pool.query(
            `SELECT id, name, current_phase, is_paused, allocation_date, lobby_opens_at
             FROM hostel WHERE id = $1`,
            [req.params.hostelId]
        );
        if (hostelRes.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Hostel not found' });
        }

        const hostel = hostelRes.rows[0];

        // Get batch summary
        const batchRes = await pool.query(
            `SELECT batch_number, status, start_time, end_time
             FROM batch WHERE hostel_id = $1 ORDER BY batch_number ASC`,
            [req.params.hostelId]
        );

        // Get unallocated student count
        const unallocRes = await pool.query(
            `SELECT COUNT(*) as cnt FROM student WHERE is_allotted = false`
        );

        return res.json({
            success: true,
            hostel,
            batches: batchRes.rows,
            unallocatedCount: parseInt(unallocRes.rows[0].cnt),
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// ─── POST /api/admin/trigger-phase ───────────────────────────────────────────

router.post('/trigger-phase', async (req, res) => {
    const { hostelId, phase } = req.body;
    if (!hostelId || !phase) {
        return res.status(400).json({ success: false, message: 'hostelId and phase are required' });
    }
    try {
        const updated = await setCurrentPhase(hostelId, phase);
        return res.json({ success: true, hostel: updated });
    } catch (err) {
        return res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
});

export default router;
