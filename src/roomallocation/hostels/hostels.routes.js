import express from "express";

import {
    createHostelController,
    getAllHostelsController
} from "./hostels.controller.js";

const router =
    express.Router();

/*
=================================================
GET ALL HOSTELS
=================================================
*/

router.get(
    "/",
    getAllHostelsController
);

/*
=================================================
CREATE HOSTEL
=================================================
*/

router.post(
    "/create",
    createHostelController
);

export default router;