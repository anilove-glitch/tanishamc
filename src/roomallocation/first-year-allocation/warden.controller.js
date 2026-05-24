import { validateLayoutPayload } from './layout.validator.js';
import { getUnassignedFirstYearStudents, getUnassignedStudentPoolStats, getAvailableRoomsStats } from './studentPool.service.js';
import { matchConstraints } from './constraintMatcher.js';
import { executeBulkAllocation, rollbackAllocations } from './bulkAllocator.js';

/**
 * Controller for the First-Year Allocation System
 */
export const WardenController = {
    /**
     * Get pre-allocation analytics (how many students by state/branch, available rooms)
     */
    async getAnalytics(req, res) {
        try {
            const { hostelId } = req.params;
            if (!hostelId) return res.status(400).json({ success: false, message: 'hostelId is required' });

            const studentPool = await getUnassignedStudentPoolStats(hostelId);
            const availableRooms = await getAvailableRoomsStats(hostelId);

            res.status(200).json({
                success: true,
                analytics: {
                    studentPool,
                    availableRooms
                }
            });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    },

    /**
     * Executes the greedy constraint matcher and commits the result
     */
    async allocate(req, res) {
        try {
            // 1. Validate Payload strictly via Zod
            const payload = validateLayoutPayload(req.body);
            const { hostelId, targetRoomIds, layoutConfig } = payload;

            // 2. Fetch the current unassigned pool
            const unassignedStudents = await getUnassignedFirstYearStudents(hostelId);
            if (unassignedStudents.length === 0) {
                return res.status(400).json({ success: false, message: 'No unassigned first-year students available in this hostel.' });
            }

            // 3. Match constraints in-memory
            const allocations = matchConstraints(unassignedStudents, targetRoomIds, layoutConfig);

            if (allocations.size === 0) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Constraint Engine failed to find any valid matches for the given layout.' 
                });
            }

            // 4. Execute atomic state mutation
            const result = await executeBulkAllocation(allocations, hostelId);

            res.status(200).json({
                success: true,
                message: `Successfully allocated ${result.studentsAllocated} students to ${result.roomsAllocated} rooms.`,
                result
            });
        } catch (error) {
            // Zod errors format
            if (error.errors) {
                return res.status(400).json({ success: false, message: 'Validation Failed', errors: error.errors });
            }
            res.status(500).json({ success: false, message: error.message });
        }
    },

    /**
     * Emergency rollback for specific rooms
     */
    async rollback(req, res) {
        try {
            const { hostelId, roomIds } = req.body;
            if (!hostelId || !Array.isArray(roomIds) || roomIds.length === 0) {
                return res.status(400).json({ success: false, message: 'hostelId and a non-empty roomIds array are required.' });
            }

            const result = await rollbackAllocations(roomIds, hostelId);

            res.status(200).json({
                success: true,
                message: `Successfully rolled back ${result.roomsRolledBack} rooms.`,
                result
            });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }
};
