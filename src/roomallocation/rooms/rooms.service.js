import pool from "../../db/db.js";

/*
=================================================
CREATE ROOM SERVICE
=================================================
*/

export const createRoomService =
async (
    hostelId,
    roomNumber,
    maxCapacity
) => {

    const result =
        await pool.query(
            `
            INSERT INTO rooms (
                hostel_id,
                room_number,
                max_capacity
            )
            VALUES (
                $1,
                $2,
                $3
            )
            RETURNING *
            `,
            [
                hostelId,
                roomNumber,
                maxCapacity
            ]
        );

    return result.rows[0];

};