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

import verifyJWT from "../middlewares/auth.middleware.js";

import verifyStudent from "../middlewares/student.middleware.js";
import verifyMMCA from "../middlewares/mmca.middleware.js";
import verifyGuard from "../middlewares/guard.middleware.js";

const router = express.Router();

/*
=================================================
STUDENT ROUTES
=================================================
*/

// Create Outpass
// POST /api/outpasses
router.post(
    "/",
    verifyJWT,
    verifyStudent,
    createOutpass
);

// Get My Outpasses
// GET /api/outpasses/my
router.get(
    "/my",
    verifyJWT,
    verifyStudent,
    getMyOutpasses
);

// Get Active Outpass
// GET /api/outpasses/active
router.get(
    "/active",
    verifyJWT,
    verifyStudent,
    getActiveOutpass
);

// Get Single Outpass
// GET /api/outpasses/:id
router.get(
    "/:id",
    verifyJWT,
    verifyStudent,
    getOutpassById
);

// Cancel Outpass
// PATCH /api/outpasses/:id/cancel
router.patch(
    "/:id/cancel",
    verifyJWT,
    verifyStudent,
    cancelOutpass
);

/*
=================================================
GUARD ROUTES
=================================================
*/

// Student Exit
// POST /api/outpasses/guard/exit
router.post(
    "/guard/exit",
    verifyJWT,
    verifyGuard,
    studentExit
);

// Student Return
// POST /api/outpasses/guard/return
router.post(
    "/guard/return",
    verifyJWT,
    verifyGuard,
    studentReturn
);

/*
=================================================
MMCA ROUTES
=================================================
*/

// Get Pending Outpasses
// GET /api/outpasses/mmca/pending
router.get(
    "/mmca/pending",
    verifyJWT,
    verifyMMCA,
    getPendingOutpasses
);

// Approve Outpass
// PATCH /api/outpasses/mmca/:id/approve
router.patch(
    "/mmca/:id/approve",
    verifyJWT,
    verifyMMCA,
    approveOutpass
);

// Reject Outpass
// PATCH /api/outpasses/mmca/:id/reject
router.patch(
    "/mmca/:id/reject",
    verifyJWT,
    verifyMMCA,
    rejectOutpass
);

// Get Late Returns
// GET /api/outpasses/mmca/late
router.get(
    "/mmca/late",
    verifyJWT,
    verifyMMCA,
    getLateReturns
);

export default router;