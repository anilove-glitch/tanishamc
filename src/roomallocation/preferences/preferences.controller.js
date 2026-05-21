import { getRoomsByHostel, getAllHostels } from '../services/room.service.js';
import { getAllGroups } from '../services/group.service.js';
import { allocationService } from '../services/allocation.service.js';

/*
=================================================
SUBMIT ROOM PREFERENCE
  (redirected to allocation.service.submitPreferences
   which writes to allocation_submissions +
   submission_preferences — the actual DB tables)
=================================================
*/

export const submitPreferenceController = async (req, res) => {
    try {
        const {
            groupId,
            submittedBy,
            hostelId,
            batchNumber,
            roundNumber,
            preferences,   // array of room IDs in order
        } = req.body;

        const result = await allocationService.submitPreferences({
            groupId,
            submittedBy,
            hostelId,
            batchNumber,
            roundNumber,
            preferences,
        });

        res.status(200).json({ success: true, ...result });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
};

/*
=================================================
GET ALL ROOMS FOR A HOSTEL
=================================================
*/

export const getAllRoomsController = async (req, res) => {
    try {
        const { hostelId } = req.query;
        if (!hostelId) {
            return res.status(400).json({ success: false, message: 'hostelId query param is required' });
        }
        const rooms = await getRoomsByHostel(hostelId);
        res.status(200).json({ success: true, rooms });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
};

/*
=================================================
GET ALL GROUPS
=================================================
*/

export const getAllGroupsController = async (req, res) => {
    try {
        const groups = await getAllGroups();
        res.status(200).json({ success: true, groups });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
};