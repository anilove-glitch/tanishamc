import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import asyncHandler from "../utils/asyncHandler.js";
import pool from "../db/pool.js";

/*
=================================================
SEARCH STUDENT BY NAME OR ROLL NUMBER
=================================================
*/
const searchByNameOrRollno = asyncHandler(async (req, res) => {

    const { name, roll_no } = req.body;

    if (!name && !roll_no) {
        throw new ApiError(
            400,
            "Provide either name or roll number"
        );
    }

    let query = `
        SELECT *
        FROM student
    `;

    const conditions = [];
    const values = [];

    if (roll_no) {

        values.push(roll_no);

        conditions.push(
            `roll_no = $${values.length}`
        );
    }

    if (name) {

        values.push(name);

        conditions.push(
            `name ILIKE '%' || $${values.length} || '%'`
        );
    }

    query += `
        WHERE ${conditions.join(" OR ")}
        ORDER BY created_at DESC
    `;

    const result = await pool.query(
        query,
        values
    );

    if (result.rowCount === 0) {
        throw new ApiError(
            404,
            "No matching students found"
        );
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            result.rows,
            "Students fetched successfully"
        )
    );
});

/*
=================================================
GET STUDENTS WITH OUTPASSES IN RANGE
=================================================
*/
const sortStudentsInRange = asyncHandler(async (req, res) => {

    const {
        departure_datetime,
        arrival_datetime
    } = req.body;

    if (
        !departure_datetime ||
        !arrival_datetime
    ) {
        throw new ApiError(
            400,
            "Provide departure time and arrival time"
        );
    }

    const query = `
        SELECT
            s.id AS student_id,
            s.name,
            s.roll_no,
            s.department,
            s.email,
            s.phone,
            s.hostel,
            r.room_number AS room,

            o.id AS outpass_id,
            o.parent_contact,
            o.outpass_type,
            o.place_of_visit,
            o.purpose,
            o.departure_datetime,
            o.arrival_datetime,
            o.outp_status,
            o.std_status,
            o.created_at

        FROM student s

        JOIN outpass o
        ON o.student_id = s.id
        
        LEFT JOIN room r
        ON s.physical_room_id = r.id

        WHERE
            o.departure_datetime
            BETWEEN $1 AND $2

        ORDER BY
            o.departure_datetime DESC;
    `;

    const result = await pool.query(
        query,
        [
            departure_datetime,
            arrival_datetime
        ]
    );

    if (result.rowCount === 0) {
        throw new ApiError(
            404,
            "No students found"
        );
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            result.rows,
            "Students fetched successfully"
        )
    );
});

/*
=================================================
GET ALL OUTPASSES BY STATUS
=================================================
*/
const getAllOutpassesByStatus = asyncHandler(async (req, res) => {

    const { outp_status } = req.body;

    if (!outp_status) {
        throw new ApiError(
            400,
            "Outpass status is required"
        );
    }

    const allowedStatus = [
        "Pending",
        "Approved",
        "Rejected"
    ];

    if (
        !allowedStatus.includes(outp_status)
    ) {
        throw new ApiError(
            400,
            "Invalid outpass status"
        );
    }

    const query = `
        SELECT
            o.*,

            s.name,
            s.roll_no,
            s.department,
            s.email,
            s.phone,
            s.hostel,
            r.room_number AS room

        FROM outpass o

        JOIN student s
        ON o.student_id = s.id
        
        LEFT JOIN room r
        ON s.physical_room_id = r.id

        WHERE
            o.outp_status = $1

        ORDER BY
            o.created_at DESC;
    `;

    const result = await pool.query(
        query,
        [outp_status]
    );

    if (result.rowCount === 0) {
        throw new ApiError(
            404,
            "No outpasses found"
        );
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            result.rows,
            `${outp_status} outpasses fetched successfully`
        )
    );
});

export {
    searchByNameOrRollno,
    sortStudentsInRange,
    getAllOutpassesByStatus
};