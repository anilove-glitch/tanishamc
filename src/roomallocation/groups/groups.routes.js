import express from "express";
import auth from "../../middleware/middleware.js";

import {
    createGroupController,
    inviteStudentController,
    acceptInviteController,
    leaveGroupController,
    transferLeadershipController,
    getAllRequestsController,
    getAllGroupsController,
    getGroupMembersController,
    kickMemberController
} from "./groups.controller.js";

const router = express.Router();
router.use(auth);

/*
=================================================
CREATE GROUP
=================================================
*/

router.post(
    "/create",
    createGroupController
);

/*
=================================================
INVITE STUDENT
=================================================
*/

router.post(
    "/invite",
    inviteStudentController
);

/*
=================================================
ACCEPT INVITE
=================================================
*/

router.post(
    "/accept-invite",
    acceptInviteController
);

/*
=================================================
LEAVE GROUP
=================================================
*/

router.post(
    "/leave",
    leaveGroupController
);

/*
=================================================
TRANSFER LEADERSHIP
=================================================
*/

router.post(
    "/transfer-leadership",
    transferLeadershipController
);

/*
=================================================
KICK MEMBER
=================================================
*/

router.post(
    "/kick",
    kickMemberController
);

/*
=================================================
GET ALL REQUESTS
=================================================
*/

router.get(
    "/requests",
    getAllRequestsController
);

router.get(
    "/",
    getAllGroupsController
);

router.get(
    "/:groupId/members",
    getGroupMembersController
);

export default router;