import {
    createRoomService
} from "./rooms.service.js";

/*
=================================================
CREATE ROOM
=================================================
*/

export const createRoomController =
async (req, res) => {

    try {

        const {
            hostelId,
            roomNumber,
            maxCapacity
        } = req.body;

        const room =
            await createRoomService(
                hostelId,
                roomNumber,
                maxCapacity
            );

        res.status(200).json({
            success: true,
            room
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });

    }

};