import express from "express";

import {
    createOutpass,
    getMyOutpasses,
    getActiveOutpass,
    getOutpassById,
    cancelOutpass,
    getPendingOutpasses,
    approveOutpass,
    rejectOutpass,
    getLateReturns,
    studentExit,
    studentReturn
} from "../controllers/outpass.controller.js";

// import verifyJWT from "../middlewares/auth.middleware.js";

// import verifyStudent from "../middlewares/student.middleware.js";
// import verifyMMCA from "../middlewares/mmca.middleware.js";
// import verifyGuard from "../middlewares/guard.middleware.js";

const router = express.Router();

/*
=================================================
STUDENT ROUTES
=================================================
*/

// CREATE OUTPASS
// POST /api/outpasses
router.post(
    "/",
    // verifyJWT,
    // verifyStudent,
    createOutpass
);

// GET MY OUTPASSES
// GET /api/outpasses/my
router.get(
    "/my",
    // verifyJWT,
    // verifyStudent,
    getMyOutpasses
);

// GET ACTIVE OUTPASS
// GET /api/outpasses/active
router.get(
    "/active",
    // verifyJWT,
    // verifyStudent,
    getActiveOutpass
);

/*
=================================================
GUARD ROUTES
=================================================
*/

// STUDENT EXIT
// POST /api/outpasses/guard/exit
router.post(
    "/guard/exit",
    // verifyJWT,
    // verifyGuard,
    studentExit
);

// STUDENT RETURN
// POST /api/outpasses/guard/return
router.post(
    "/guard/return",
    // verifyJWT,
    // verifyGuard,
    studentReturn
);

/*
=================================================
MMCA ROUTES
=================================================
*/

// GET PENDING OUTPASSES
// GET /api/outpasses/mmca/pending
router.get(
    "/mmca/pending",
    // verifyJWT,
    // verifyMMCA,
    getPendingOutpasses
);

// GET LATE RETURNS
// GET /api/outpasses/mmca/late
router.get(
    "/mmca/late",
    // verifyJWT,
    // verifyMMCA,
    getLateReturns
);

// APPROVE OUTPASS
// PATCH /api/outpasses/mmca/:id/approve
router.patch(
    "/mmca/:id/approve",
    // verifyJWT,
    // verifyMMCA,
    approveOutpass
);

// REJECT OUTPASS
// PATCH /api/outpasses/mmca/:id/reject
router.patch(
    "/mmca/:id/reject",
    // verifyJWT,
    // verifyMMCA,
    rejectOutpass
);

/*
=================================================
DYNAMIC ROUTES (KEEP LAST)
=================================================
*/

// GET SINGLE OUTPASS
// GET /api/outpasses/:id
router.get(
    "/:id",
    // verifyJWT,
    // verifyStudent,
    getOutpassById
);

// CANCEL OUTPASS
// PATCH /api/outpasses/:id/cancel
router.patch(
    "/:id/cancel",
    // verifyJWT,
    // verifyStudent,
    cancelOutpass
);

export default router;