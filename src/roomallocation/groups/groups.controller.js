import {
    createGroup,
    sendGroupRequest,
    respondToGroupRequest,
    leaveGroup,
    transferLeadership,
    getAllRequests,
    getAllGroups,
    getGroupMembers,
} from '../services/group.service.js';

/*
=================================================
CREATE GROUP
=================================================
*/

export const createGroupController = async (req, res) => {
    try {
        const { leaderId } = req.body;
        const result = await createGroup(leaderId);
        res.status(201).json({ success: true, data: result });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
};

/*
=================================================
INVITE STUDENT  (primary applicant → student)
=================================================
*/

export const inviteStudentController = async (req, res) => {
    try {
        const { groupId, studentId } = req.body;
        const result = await sendGroupRequest(groupId, studentId, 'INVITE_FROM_PRIMARY');
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
};

/*
=================================================
ACCEPT INVITE
=================================================
*/

export const acceptInviteController = async (req, res) => {
    try {
        const { requestId } = req.body;
        const result = await respondToGroupRequest(requestId, 'ACCEPTED');
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
};

/*
=================================================
REJECT INVITE
=================================================
*/

export const rejectInviteController = async (req, res) => {
    try {
        const { requestId } = req.body;
        const result = await respondToGroupRequest(requestId, 'REJECTED');
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
};

/*
=================================================
LEAVE GROUP
=================================================
*/

export const leaveGroupController = async (req, res) => {
    try {
        const { studentId } = req.body;
        const result = await leaveGroup(studentId);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
};

/*
=================================================
TRANSFER LEADERSHIP
=================================================
*/

export const transferLeadershipController = async (req, res) => {
    try {
        const { groupId, newLeaderId } = req.body;
        const result = await transferLeadership(groupId, newLeaderId);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
};

/*
=================================================
GET ALL REQUESTS
=================================================
*/

export const getAllRequestsController = async (req, res) => {
    try {
        const requests = await getAllRequests();
        res.status(200).json({ success: true, requests });
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

/*
=================================================
GET GROUP MEMBERS
=================================================
*/

export const getGroupMembersController = async (req, res) => {
    try {
        const { groupId } = req.params;
        const result = await getGroupMembers(groupId);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
};