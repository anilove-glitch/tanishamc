import { createRoom } from '../services/room.service.js';

/*
=================================================
CREATE ROOM
=================================================
*/

export const createRoomController = async (req, res) => {
    try {
        const { hostelId, roomNumber, roomType, maxCapacity } = req.body;
        const room = await createRoom(hostelId, roomNumber, roomType, maxCapacity);
        res.status(201).json({ success: true, room });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
};