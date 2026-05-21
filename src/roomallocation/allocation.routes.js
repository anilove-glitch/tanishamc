import express from "express";
import { allocationService } from "./services/allocation.service.js";
import auth from "../middleware/middleware.js";

const router = express.Router();
router.use(auth);

// =====================================================
// EXECUTE BATCH ROUND
// =====================================================
router.post("/run", async (req, res) => {
    try {
        const { batchId, roundNumber } = req.body;

        if (!batchId || !roundNumber) {
            return res.status(400).json({
                success: false,
                message: "batchId and roundNumber are required"
            });
        }

        const result = await allocationService.executeBatchRound(batchId, roundNumber);

        res.status(200).json({
            success: true,
            result
        });

    } catch (error) {
        res.status(error.statusCode || 500).json({
            success: false,
            message: error.message
        });
    }
});

// =====================================================
// SUBMIT PREFERENCES
// =====================================================
router.post("/submit-preferences", async (req, res) => {
    try {
        const result = await allocationService.submitPreferences(req.body);
        res.status(200).json({ success: true, result });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
});

// =====================================================
// LIVE ROOM MAP
// =====================================================
router.get("/rooms/:hostelId", async (req, res) => {
    try {
        const result = await allocationService.getLiveRoomMap(req.params.hostelId);
        res.status(200).json({ success: true, rooms: result });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
});

// =====================================================
// ALLOCATION STATUS
// =====================================================
router.get("/status/:studentId", async (req, res) => {
    try {
        const result = await allocationService.getAllocationStatus(req.params.studentId);
        res.status(200).json({ success: true, result });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
});

// =====================================================
// BATCH RESULTS
// =====================================================
router.get("/results/:batchId", async (req, res) => {
    try {
        const result = await allocationService.getBatchResults(req.params.batchId);
        res.status(200).json({ success: true, result });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
});

export default router;