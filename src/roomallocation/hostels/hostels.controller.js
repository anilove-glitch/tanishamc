import { createHostel } from '../services/room.service.js';

/*
=================================================
CREATE HOSTEL
=================================================
*/

export const createHostelController = async (req, res) => {
    try {
        const { name, type, totalCapacity } = req.body;
        const hostel = await createHostel(name, type, totalCapacity);
        res.status(201).json({ success: true, hostel });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
};