import express from "express";

import {
    createRoomController
} from "./rooms.controller.js";

const router =
    express.Router();

/*
=================================================
CREATE ROOM
=================================================
*/

router.post(
    "/create",
    createRoomController
);

export default router;