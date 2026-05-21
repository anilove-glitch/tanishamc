import pool from "../../db/db.js";

/*
=================================================
CREATE HOSTEL SERVICE
=================================================
*/

export const createHostelService =
async (name) => {

    const result =
        await pool.query(
            `
            INSERT INTO hostels (
                name
            )
            VALUES (
                $1
            )
            RETURNING *
            `,
            [name]
        );

    return result.rows[0];

};