import express from "express";

import {
    submitPreferenceController,
    getAllRoomsController,
    getAllGroupsController
} from "./preferences.controller.js";

const router =
    express.Router();

/*
=================================================
SUBMIT PREFERENCE
=================================================
*/

router.post(
    "/submit",
    submitPreferenceController
);

/*
=================================================
GET ALL ROOMS
=================================================
*/

router.get(
    "/rooms",
    getAllRoomsController
);

/*
=================================================
GET ALL GROUPS
=================================================
*/

router.get(
    "/groups",
    getAllGroupsController
);
export default router;