import express from "express";

import {
    createHostelController
} from "./hostels.controller.js";

const router =
    express.Router();

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