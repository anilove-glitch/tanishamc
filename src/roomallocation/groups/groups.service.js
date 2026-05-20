import pool from "../../db/db.js";

/*
=================================================
CREATE GROUP SERVICE
=================================================
*/

export const createGroupService =
async (leaderId) => {

    const client =
        await pool.connect();

    try {

        await client.query("BEGIN");

        /*
        ============================
        CHECK STUDENT EXISTS
        ============================
        */

        const studentQuery = `
            SELECT *
            FROM students
            WHERE id = $1
        `;

        const studentResult =
            await client.query(
                studentQuery,
                [leaderId]
            );

        const student =
            studentResult.rows[0];

        if (!student) {

            throw new Error(
                "Student not found"
            );

        }

        /*
        ============================
        CHECK ALREADY IN GROUP
        ============================
        */

        if (student.group_id) {

            throw new Error(
                "Student already in group"
            );

        }

        /*
        ============================
        CREATE GROUP
        ============================
        */

        const createGroupQuery = `
            INSERT INTO housing_groups (
                primary_applicant_id,
                status
            )
            VALUES (
                $1,
                'FORMING'
            )
            RETURNING *
        `;

        const groupResult =
            await client.query(
                createGroupQuery,
                [leaderId]
            );

        const group =
            groupResult.rows[0];

        /*
        ============================
        UPDATE STUDENT
        ============================
        */

        const updateStudentQuery = `
            UPDATE students
            SET group_id = $1
            WHERE id = $2
            RETURNING *
        `;

        const updatedStudent =
            await client.query(
                updateStudentQuery,
                [
                    group.id,
                    leaderId
                ]
            );

        await client.query(
            "COMMIT"
        );

        return {

            message:
                "Group created successfully",

            group,

            student:
                updatedStudent.rows[0]

        };

    } catch (error) {

        await client.query(
            "ROLLBACK"
        );

        throw error;

    } finally {

        client.release();

    }

};

/*
=================================================
INVITE STUDENT SERVICE
=================================================
*/

export const inviteStudentService =
async (
    groupId,
    studentId
) => {

    /*
    ============================
    CHECK GROUP EXISTS
    ============================
    */

    const groupResult =
        await pool.query(
            `
            SELECT *
            FROM housing_groups
            WHERE id = $1
            `,
            [groupId]
        );

    const group =
        groupResult.rows[0];

    if (!group) {

        throw new Error(
            "Group not found"
        );

    }

    /*
    ============================
    CHECK STUDENT EXISTS
    ============================
    */

    const studentResult =
        await pool.query(
            `
            SELECT *
            FROM students
            WHERE id = $1
            `,
            [studentId]
        );

    const student =
        studentResult.rows[0];

    if (!student) {

        throw new Error(
            "Student not found"
        );

    }

    /*
    ============================
    ALREADY IN GROUP?
    ============================
    */

    if (student.group_id) {

        throw new Error(
            "Student already in group"
        );

    }

    /*
    ============================
    CHECK GROUP SIZE
    ============================
    */

    const sizeResult =
        await pool.query(
            `
            SELECT COUNT(*) AS size
            FROM students
            WHERE group_id = $1
            `,
            [groupId]
        );

    const groupSize =
        parseInt(
            sizeResult.rows[0].size
        );

    if (groupSize >= 4) {

        throw new Error(
            "Group is full"
        );

    }

    /*
    ============================
    CHECK DUPLICATE REQUEST
    ============================
    */

    const existingRequest =
        await pool.query(
            `
            SELECT *
            FROM group_requests
            WHERE group_id = $1
            AND student_id = $2
            AND status IN (
                'PENDING',
                'ACCEPTED'
            )
            `,
            [
                groupId,
                studentId
            ]
        );

    if (
        existingRequest.rows.length > 0
    ) {

        throw new Error(
            "Invite already exists"
        );

    }

    /*
    ============================
    CREATE INVITE
    ============================
    */

    const inviteResult =
        await pool.query(
            `
            INSERT INTO group_requests (
                group_id,
                student_id,
                request_type,
                status
            )
            VALUES (
                $1,
                $2,
                'INVITE_FROM_PRIMARY',
                'PENDING'
            )
            RETURNING *
            `,
            [
                groupId,
                studentId
            ]
        );

    return {

        message:
            "Invite sent successfully",

        invite:
            inviteResult.rows[0]

    };

};

/*
=================================================
ACCEPT INVITE SERVICE
=================================================
*/

export const acceptInviteService =
async (requestId) => {

    const client =
        await pool.connect();

    try {

        await client.query("BEGIN");

        /*
        ============================
        GET REQUEST
        ============================
        */

        const requestResult =
            await client.query(
                `
                SELECT *
                FROM group_requests
                WHERE id = $1
                `,
                [requestId]
            );

        const request =
            requestResult.rows[0];

        if (!request) {

            throw new Error(
                "Request not found"
            );

        }

        /*
        ============================
        CHECK PENDING
        ============================
        */

        if (
            request.status !==
            "PENDING"
        ) {

            throw new Error(
                "Request already processed"
            );

        }

        /*
        ============================
        CHECK GROUP SIZE
        ============================
        */

        const sizeResult =
            await client.query(
                `
                SELECT COUNT(*) AS size
                FROM students
                WHERE group_id = $1
                `,
                [request.group_id]
            );

        const groupSize =
            parseInt(
                sizeResult.rows[0].size
            );

        if (groupSize >= 4) {

            throw new Error(
                "Group is already full"
            );

        }

        /*
        ============================
        UPDATE STUDENT
        ============================
        */

        await client.query(
            `
            UPDATE students
            SET group_id = $1
            WHERE id = $2
            `,
            [
                request.group_id,
                request.student_id
            ]
        );

        /*
        ============================
        UPDATE REQUEST STATUS
        ============================
        */

        const updatedRequest =
            await client.query(
                `
                UPDATE group_requests
                SET status = 'ACCEPTED'
                WHERE id = $1
                RETURNING *
                `,
                [requestId]
            );

        await client.query(
            "COMMIT"
        );

        return {

            message:
                "Invite accepted successfully",

            request:
                updatedRequest.rows[0]

        };

    } catch (error) {

        await client.query(
            "ROLLBACK"
        );

        throw error;

    } finally {

        client.release();

    }

};

/*
=================================================
LEAVE GROUP SERVICE
=================================================
*/

export const leaveGroupService =
async (studentId) => {

    const client =
        await pool.connect();

    try {

        await client.query("BEGIN");

        /*
        ============================
        CHECK STUDENT
        ============================
        */

        const studentResult =
            await client.query(
                `
                SELECT *
                FROM students
                WHERE id = $1
                `,
                [studentId]
            );

        const student =
            studentResult.rows[0];

        if (!student) {

            throw new Error(
                "Student not found"
            );

        }

        /*
        ============================
        NOT IN GROUP?
        ============================
        */

        if (!student.group_id) {

            throw new Error(
                "Student not in any group"
            );

        }

        const groupId =
            student.group_id;

        /*
        ============================
        REMOVE FROM GROUP
        ============================
        */

        await client.query(
            `
            UPDATE students
            SET group_id = NULL
            WHERE id = $1
            `,
            [studentId]
        );

        /*
        ============================
        CHECK REMAINING MEMBERS
        ============================
        */

        const membersResult =
            await client.query(
                `
                SELECT *
                FROM students
                WHERE group_id = $1
                `,
                [groupId]
            );

        const members =
            membersResult.rows;

        /*
        ============================
        IF GROUP EMPTY
        DELETE GROUP
        ============================
        */

        if (members.length === 0) {

            await client.query(
                `
                DELETE FROM housing_groups
                WHERE id = $1
                `,
                [groupId]
            );

            await client.query(
                "COMMIT"
            );

            return {

                message:
                    "Group deleted because empty"

            };

        }

        /*
        ============================
        IF LEADER LEFT
        ASSIGN NEW LEADER
        ============================
        */

        const groupResult =
            await client.query(
                `
                SELECT *
                FROM housing_groups
                WHERE id = $1
                `,
                [groupId]
            );

        const group =
            groupResult.rows[0];

        if (
            group.primary_applicant_id
            === studentId
        ) {

            const newLeader =
                members[0];

            await client.query(
                `
                UPDATE housing_groups
                SET primary_applicant_id = $1
                WHERE id = $2
                `,
                [
                    newLeader.id,
                    groupId
                ]
            );

        }

        await client.query(
            "COMMIT"
        );

        return {

            message:
                "Student left group successfully"

        };

    } catch (error) {

        await client.query(
            "ROLLBACK"
        );

        throw error;

    } finally {

        client.release();

    }

};

/*
=================================================
TRANSFER LEADERSHIP SERVICE
=================================================
*/

export const transferLeadershipService =
async (
    groupId,
    newLeaderId
) => {

    const client =
        await pool.connect();

    try {

        await client.query(
            "BEGIN"
        );

        /*
        ============================
        CHECK GROUP EXISTS
        ============================
        */

        const groupResult =
            await client.query(
                `
                SELECT *
                FROM housing_groups
                WHERE id = $1
                `,
                [groupId]
            );

        const group =
            groupResult.rows[0];

        if (!group) {

            throw new Error(
                "Group not found"
            );

        }

        /*
        ============================
        CHECK STUDENT EXISTS
        ============================
        */

        const studentResult =
            await client.query(
                `
                SELECT *
                FROM students
                WHERE id = $1
                `,
                [newLeaderId]
            );

        const student =
            studentResult.rows[0];

        if (!student) {

            throw new Error(
                "Student not found"
            );

        }

        /*
        ============================
        CHECK STUDENT BELONGS
        TO SAME GROUP
        ============================
        */

        if (
            !student.group_id
        ) {

            throw new Error(
                "Student not in any group"
            );

        }

        if (
            student.group_id.toString()
            !==
            groupId.toString()
        ) {

            throw new Error(
                "Student not in this group"
            );

        }

        /*
        ============================
        UPDATE LEADER
        ============================
        */

        const updatedGroup =
            await client.query(
                `
                UPDATE housing_groups
                SET primary_applicant_id = $1
                WHERE id = $2
                RETURNING *
                `,
                [
                    newLeaderId,
                    groupId
                ]
            );

        await client.query(
            "COMMIT"
        );

        return {

            message:
                "Leadership transferred successfully",

            group:
                updatedGroup.rows[0]

        };

    } catch (error) {

        await client.query(
            "ROLLBACK"
        );

        throw error;

    } finally {

        client.release();

    }

};
/*
=================================================
GET ALL REQUESTS
=================================================
*/

export const getAllRequestsService =
async () => {

    const result =
        await pool.query(
            `
            SELECT *
            FROM group_requests
            ORDER BY created_at DESC
            `
        );

    return result.rows;

};

/*
=================================================
GET ALL GROUPS
=================================================
*/

export const getAllGroupsService =
async () => {

    const result =
        await pool.query(
            `
            SELECT *
            FROM housing_groups
            ORDER BY id
            `
        );

    return result.rows;

};

/*
=================================================
GET GROUP MEMBERS
=================================================
*/

export const getGroupMembersService =
async (groupId) => {

    /*
    ============================
    CHECK GROUP EXISTS
    ============================
    */

    const groupResult =
        await pool.query(
            `
            SELECT *
            FROM housing_groups
            WHERE id = $1
            `,
            [groupId]
        );

    const group =
        groupResult.rows[0];

    if (!group) {

        throw new Error(
            "Group not found"
        );

    }

    /*
    ============================
    GET MEMBERS
    ============================
    */

    const membersResult =
        await pool.query(
            `
            SELECT
                id,
                name,
                roll_no,
                email,
                cgpa
            FROM students
            WHERE group_id = $1
            ORDER BY id
            `,
            [groupId]
        );

    return {

        group,
        members: membersResult.rows

    };

};