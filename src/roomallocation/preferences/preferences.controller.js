import {
    submitPreferenceService,
    getAllRoomsService,
    getAllGroupsService
} from "./preferences.service.js";

/*
=================================================
SUBMIT ROOM PREFERENCE
=================================================
*/

export const submitPreferenceController =
async (req, res) => {

    try {

        const {
            groupId,
            roomId,
            preferenceOrder
        } = req.body;

        const result =
            await submitPreferenceService(
                groupId,
                roomId,
                preferenceOrder
            );

        res.status(200).json({
            success: true,
            preference: result
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });

    }

};
/*
=================================================
GET ALL ROOMS
=================================================
*/

export const getAllRoomsController =
async (req, res) => {

    try {

        const rooms =
            await getAllRoomsService();

        res.status(200).json({
            success: true,
            rooms
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });

    }

};

/*
=================================================
GET ALL GROUPS
=================================================
*/

export const getAllGroupsController =
async (req, res) => {

    try {

        const groups =
            await getAllGroupsService();

        res.status(200).json({
            success: true,
            groups
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });

    }

};