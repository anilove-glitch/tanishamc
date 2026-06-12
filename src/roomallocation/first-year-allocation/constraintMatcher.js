/**
 * constraintMatcher.js
 * The core Constraint Satisfaction Problem (CSP) Engine.
 * In-memory bipartite matching that maps elements from S (unassigned students) 
 * to R (target rooms) using L (layout config) as the strict parameter.
 */

/**
 * Checks if a student matches the node's state and branch constraints.
 */
const matchesStateAndBranch = (student, nodeConstraint) => {
    // Check State
    if (nodeConstraint.state !== 'ANY' && student.state_category !== nodeConstraint.state) {
        return false;
    }
    // Check Branch (if constraint is specific)
    if (nodeConstraint.branch && nodeConstraint.branch !== 'ANY' && student.branch !== nodeConstraint.branch) {
        return false;
    }
    return true;
};

/**
 * Checks if adding this student violates the overall room's branch diversity rule.
 */
const matchesBranchDiversity = (student, candidateGroup, diversityRule) => {
    if (candidateGroup.length === 0) return true; // First student always fits

    const existingBranches = candidateGroup.map(s => s.branch);

    switch (diversityRule) {
        case 'MUST_BE_UNIQUE':
            return !existingBranches.includes(student.branch);
        case 'EXACT_MATCH':
            // Everyone must have the EXACT SAME branch as the first person
            return existingBranches[0] === student.branch;
        case 'ALLOW_SAME':
            return true; // No restriction
        default:
            return true;
    }
};

/**
 * Executes the greedy heuristic matching.
 * 
 * @param {Array} unassignedStudents Array of student objects from DB
 * @param {Array<string>} targetRoomIds Array of UUIDs
 * @param {Object} layoutConfig 
 * @returns {Map<string, Array<number>>} Map of RoomID -> Array of Student IDs
 */
export const matchConstraints = (unassignedStudents, targetRoomIds, layoutConfig) => {
    const allocations = new Map();
    // Clone array to allow splicing without mutating the original source
    const availableStudents = [...unassignedStudents];

    for (const roomId of targetRoomIds) {
        const candidateGroup = [];
        
        for (const nodeConstraint of layoutConfig.nodes) {
            const matchIndex = availableStudents.findIndex(s => 
                matchesStateAndBranch(s, nodeConstraint) && 
                matchesBranchDiversity(s, candidateGroup, layoutConfig.branchDiversity)
            );

            if (matchIndex !== -1) {
                // Add to candidate group
                candidateGroup.push(availableStudents[matchIndex]);
                // Remove from temporary available pool so they aren't matched again
                availableStudents.splice(matchIndex, 1);
            } else {
                // Constraint failure for this room
                break;
            }
        }

        if (candidateGroup.length === layoutConfig.capacity) {
            // Atomic success: Room configuration completely satisfied
            allocations.set(roomId, candidateGroup.map(s => s.id));
        } else {
            // Atomic failure: Return partial candidates back to the available pool
            availableStudents.push(...candidateGroup);
        }
    }

    return allocations;
};
