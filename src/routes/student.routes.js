import { Router } from "express";

import auth from "../middleware/middleware.js";

import {
    searchByNameOrRollno,
    sortStudentsInRange,
    getAllOutpassesByStatus
} from "../controllers/student.controller.js";

const router = Router();

/*
=================================================
SEARCH STUDENT
=================================================
*/
router.post(
    "/search",
    auth,
    searchByNameOrRollno
);

/*
=================================================
OUTPASSES IN RANGE
=================================================
*/
router.post(
    "/range",
    auth,
    sortStudentsInRange
);

/*
=================================================
OUTPASSES BY STATUS
=================================================
*/
router.post(
    "/status",
    auth,
    getAllOutpassesByStatus
);

export default router;