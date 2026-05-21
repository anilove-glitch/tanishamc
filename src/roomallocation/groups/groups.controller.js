import {
    createGroupService,
    inviteStudentService,
    acceptInviteService,
    leaveGroupService,
    transferLeadershipService,
    getAllRequestsService,
    getAllGroupsService,
    getGroupMembersService
} from "./groups.service.js";

/*
=================================================
CREATE GROUP
=================================================
*/

export const createGroupController =
async (req, res) => {

    try {

        const { leaderId } =
            req.body;

        const result =
            await createGroupService(
                leaderId
            );

        res.status(200).json({
            success: true,
            data: result
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
INVITE STUDENT
=================================================
*/

export const inviteStudentController =
async (req, res) => {

    try {

        const {
            groupId,
            studentId
        } = req.body;

        const result =
            await inviteStudentService(
                groupId,
                studentId
            );

        res.status(200).json({
            success: true,
            data: result
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
ACCEPT INVITE
=================================================
*/

export const acceptInviteController =
async (req, res) => {

    try {

        const { requestId } =
            req.body;

        const result =
            await acceptInviteService(
                requestId
            );

        res.status(200).json({
            success: true,
            data: result
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
LEAVE GROUP
=================================================
*/

export const leaveGroupController =
async (req, res) => {

    try {

        const { studentId } =
            req.body;

        const result =
            await leaveGroupService(
                studentId
            );

        res.status(200).json({
            success: true,
            data: result
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
TRANSFER LEADERSHIP
=================================================
*/

export const transferLeadershipController =
async (req, res) => {

    try {

        const {
            groupId,
            newLeaderId
        } = req.body;

        const result =
            await transferLeadershipService(
                groupId,
                newLeaderId
            );

        res.status(200).json({
            success: true,
            data: result
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
GET ALL REQUESTS
=================================================
*/

export const getAllRequestsController =
async (req, res) => {

    try {

        const requests =
            await getAllRequestsService();

        res.status(200).json({
            success: true,
            requests
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

/*
=================================================
GET GROUP MEMBERS
=================================================
*/

export const getGroupMembersController =
async (req, res) => {

    try {

        const { groupId } =
            req.params;

        const result =
            await getGroupMembersService(
                groupId
            );

        res.status(200).json({
            success: true,
            data: result
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });

    }

};