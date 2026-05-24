import { z } from 'zod';

// Define the valid state constraint options
const StateConstraintEnum = z.enum(['HOME_STATE', 'OTHER_STATE', 'ANY']);

// Define the valid branch diversity options
const BranchDiversityEnum = z.enum(['MUST_BE_UNIQUE', 'ALLOW_SAME', 'EXACT_MATCH']);

// Node schema representing a single bed's constraints
const NodeSchema = z.object({
    id: z.string().min(1, 'Node ID is required'),
    state: StateConstraintEnum,
    branch: z.string().nullable().optional(),
});

// Layout config schema
const LayoutConfigSchema = z.object({
    capacity: z.number().int().min(1).max(6),
    branchDiversity: BranchDiversityEnum,
    nodes: z.array(NodeSchema)
});

// The main payload schema
export const LayoutPayloadSchema = z.object({
    hostelId: z.string().uuid('Invalid hostel UUID'),
    targetRoomIds: z.array(z.string().uuid('Invalid room UUID')).min(1, 'At least one target room is required'),
    layoutConfig: LayoutConfigSchema
}).refine(data => data.layoutConfig.nodes.length === data.layoutConfig.capacity, {
    message: "The number of nodes must exactly match the capacity of the room",
    path: ["layoutConfig", "nodes"]
});

/**
 * Validates the incoming warden payload against the Zod schema.
 * Throws a ZodError if validation fails.
 * 
 * @param {any} payload 
 * @returns {any} Validated payload
 */
export const validateLayoutPayload = (payload) => {
    return LayoutPayloadSchema.parse(payload);
};
