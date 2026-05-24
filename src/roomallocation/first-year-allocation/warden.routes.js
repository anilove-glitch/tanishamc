import express from 'express';
import { WardenController } from './warden.controller.js';
import auth from '../../middleware/middleware.js';

const router = express.Router();

// Apply auth middleware if necessary (assumed admins only)
// router.use(auth);

// Get analytics for pre-allocation heuristic
router.get('/analytics/:hostelId', WardenController.getAnalytics);

// Execute the allocation constraint engine
router.post('/allocate', WardenController.allocate);

// Emergency rollback
router.post('/rollback', WardenController.rollback);

export default router;
