import pool from "../../db/db.js";

/*
=================================================
SUBMIT ROOM PREFERENCE
=================================================
*/

export const submitPreferenceService =
async (
    groupId,
    roomId,
    preferenceOrder
) => {

    /*
    ============================
    CHECK GROUP
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

    if (
        groupResult.rows.length === 0
    ) {

        throw new Error(
            "Group not found"
        );

    }

    /*
    ============================
    CHECK ROOM
    ============================
    */

    const roomResult =
        await pool.query(
            `
            SELECT *
            FROM rooms
            WHERE id = $1
            `,
            [roomId]
        );

    if (
        roomResult.rows.length === 0
    ) {

        throw new Error(
            "Room not found"
        );

    }

    /*
    ============================
    INSERT PREFERENCE
    ============================
    */

    const result =
        await pool.query(
            `
            INSERT INTO room_preferences (
                group_id,
                room_id,
                preference_order
            )
            VALUES (
                $1,
                $2,
                $3
            )
            RETURNING *
            `,
            [
                groupId,
                roomId,
                preferenceOrder
            ]
        );

    return result.rows[0];

};