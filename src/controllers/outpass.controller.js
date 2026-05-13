import asyncHandler from "../utils/asyncHandler.js";
import pool from "../db/pool.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";

/*
=================================================
CREATE OUTPASS
POST /api/outpasses
=================================================
*/
const createOutpass = asyncHandler(async (req, res) => {
    console.log(req.body);
    console.log("BODY:", req.body);
console.log("METHOD:", req.method);
console.log("URL:", req.originalUrl);
    const {
        outpass_type,
        place_of_visit,
        purpose,
        departure_datetime,
        arrival_datetime,
        parent_contact
    } = req.body || {};

// TEMP: fallback until JWT auth is implemented
const studentId = req.user?.id || req.body?.student_id;

    if (
        !outpass_type ||
        !departure_datetime ||
        !parent_contact
    ) {
        throw new ApiError(
            400,
            "Required fields are missing"
        );
    }

    if (
        outpass_type !== "Local" &&
        outpass_type !== "Outstation"
    ) {
        throw new ApiError(
            400,
            "Invalid outpass type"
        );
    }

    if (outpass_type === "Outstation") {
        if (!place_of_visit || !purpose) {
            throw new ApiError(
                400,
                "Place of visit and purpose are required for Outstation outpass"
            );
        }
    }

    const existingOutpassQuery = `
        SELECT *
        FROM outpasses
        WHERE student_id = $1
        AND is_active = true
        AND outp_status IN ('Pending', 'Approved');
    `;

    const existingOutpass = await pool.query(
        existingOutpassQuery,
        [studentId]
    );

    if (existingOutpass.rows.length > 0) {
        throw new ApiError(
            400,
            "You already have an active outpass request"
        );
    }

    const departure = new Date(departure_datetime);

    if (departure < new Date()) {
        throw new ApiError(
            400,
            "Departure time cannot be in the past"
        );
    }

    if (arrival_datetime) {
        const arrival = new Date(arrival_datetime);

        if (arrival <= departure) {
            throw new ApiError(
                400,
                "Arrival time must be after departure time"
            );
        }
    }

    const query = `
        INSERT INTO outpasses (
            student_id,
            outpass_type,
            place_of_visit,
            purpose,
            departure_datetime,
            arrival_datetime,
            parent_contact
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *;
    `;

    const values = [
        studentId,
        outpass_type,
        place_of_visit || null,
        purpose || null,
        departure_datetime,
        arrival_datetime || null,
        parent_contact
    ];


    const result = await pool.query(query, values);

    return res.status(201).json(
        new ApiResponse(
            201,
            result.rows[0],
            "Outpass request created successfully"
        )
    );
});

/*
=================================================
GET MY OUTPASSES
GET /api/outpasses/my
=================================================
*/
const getMyOutpasses = asyncHandler(async (req, res) => {
    // TEMP: fallback until JWT auth is implemented
const studentId = req.user?.id || req.query.student_id;

    const query = `
        SELECT *
        FROM outpasses
        WHERE student_id = $1
        ORDER BY created_at DESC;
    `;

    const result = await pool.query(query, [studentId]);

    return res.status(200).json(
        new ApiResponse(
            200,
            result.rows,
            "Outpasses fetched successfully"
        )
    );
});

/*
=================================================
GET ACTIVE OUTPASS
GET /api/outpasses/active
=================================================
*/
const getActiveOutpass = asyncHandler(async (req, res) => {
    // TEMP: fallback until JWT auth is implemented
const studentId = req.user?.id || req.query.student_id;

    const query = `
        SELECT *
        FROM outpasses
        WHERE student_id = $1
        AND is_active = true
        LIMIT 1;
    `;

    const result = await pool.query(query, [studentId]);

    return res.status(200).json(
        new ApiResponse(
            200,
            result.rows[0] || null,
            "Active outpass fetched successfully"
        )
    );
});

/*
=================================================
GET SINGLE OUTPASS
GET /api/outpasses/:id
=================================================
*/
const getOutpassById = asyncHandler(async (req, res) => {
    const { id } = req.params;
    // TEMP: fallback until JWT auth is implemented
const studentId = req.user?.id || req.query.student_id;

    const query = `
        SELECT *
        FROM outpasses
        WHERE id = $1
        AND student_id = $2;
    `;

    const result = await pool.query(query, [id, studentId]);

    if (result.rows.length === 0) {
        throw new ApiError(
            404,
            "Outpass not found"
        );
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            result.rows[0],
            "Outpass fetched successfully"
        )
    );
});

/*
=================================================
CANCEL OUTPASS
PATCH /api/outpasses/:id/cancel
=================================================
*/
const cancelOutpass = asyncHandler(async (req, res) => {
    const { id } = req.params;
    // TEMP: fallback until JWT auth is implemented
const studentId = req.user?.id || req.body.student_id;
    const existingQuery = `
        SELECT *
        FROM outpasses
        WHERE id = $1
        AND student_id = $2;
    `;

    const existingResult = await pool.query(
        existingQuery,
        [id, studentId]
    );

    if (existingResult.rows.length === 0) {
        throw new ApiError(
            404,
            "Outpass not found"
        );
    }

    const outpass = existingResult.rows[0];

    if (outpass.std_status === "Out") {
        throw new ApiError(
            400,
            "Cannot cancel after exiting hostel"
        );
    }

    if (outpass.outp_status === "Approved") {
        throw new ApiError(
            400,
            "Approved outpass cannot be cancelled"
        );
    }

    const updateQuery = `
        UPDATE outpasses
        SET
            outp_status = 'Rejected',
            is_active = false,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *;
    `;

    const updatedResult = await pool.query(updateQuery, [id]);

    return res.status(200).json(
        new ApiResponse(
            200,
            updatedResult.rows[0],
            "Outpass cancelled successfully"
        )
    );
});

/*
=================================================
GET ALL PENDING OUTPASSES (ADMIN)
GET /api/admin/outpasses/pending
=================================================
*/
const getPendingOutpasses = asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const offset = (page - 1) * limit;

    const query = `
        SELECT 
            o.*,
            s.name,
            s.roll_no,
            s.department
        FROM outpasses o
        JOIN students s
        ON o.student_id = s.id
        WHERE o.outp_status = 'Pending'
        ORDER BY o.created_at ASC
        LIMIT $1 OFFSET $2;
    `;

    const result = await pool.query(query, [
        limit,
        offset
    ]);

    return res.status(200).json(
        new ApiResponse(
            200,
            result.rows,
            "Pending outpasses fetched successfully"
        )
    );
});

/*
=================================================
APPROVE OUTPASS
PATCH /api/admin/outpasses/:id/approve
=================================================
*/
const approveOutpass = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const query = `
        UPDATE outpasses
        SET
            outp_status = 'Approved',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *;
    `;

    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
        throw new ApiError(
            404,
            "Outpass not found"
        );
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            result.rows[0],
            "Outpass approved successfully"
        )
    );
});

/*
=================================================
REJECT OUTPASS
PATCH /api/admin/outpasses/:id/reject
=================================================
*/
const rejectOutpass = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const query = `
        UPDATE outpasses
        SET
            outp_status = 'Rejected',
            is_active = false,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *;
    `;

    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
        throw new ApiError(
            404,
            "Outpass not found"
        );
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            result.rows[0],
            "Outpass rejected successfully"
        )
    );
});

/*
=================================================
GET LATE RETURNS
GET /api/admin/outpasses/late
=================================================
*/
const getLateReturns = asyncHandler(async (req, res) => {
    const query = `
        SELECT *
        FROM outpasses
        WHERE 
            std_status = 'Out'
            AND arrival_datetime IS NOT NULL
            AND CURRENT_TIMESTAMP > arrival_datetime;
    `;

    const result = await pool.query(query);

    return res.status(200).json(
        new ApiResponse(
            200,
            result.rows,
            "Late returns fetched successfully"
        )
    );
});

/*
=================================================
GUARD EXIT
POST /api/guard/exit
=================================================
BODY:
{
    "roll_no": "22BCS101"
}
=================================================
*/

const studentExit = asyncHandler(async (req, res) => {
    const { roll_no } = req.body;

    if (!roll_no) {
        throw new ApiError(
            400,
            "Roll number is required"
        );
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // =========================
        // Find Student
        // =========================

        const studentQuery = `
            SELECT id, name, roll_no
            FROM students
            WHERE roll_no = $1;
        `;

        const studentResult = await client.query(
            studentQuery,
            [roll_no]
        );

        if (studentResult.rows.length === 0) {
            throw new ApiError(
                404,
                "Student not found"
            );
        }

        const student = studentResult.rows[0];

        // =========================
        // Find Active Approved Outpass
        // =========================

        const outpassQuery = `
            SELECT *
            FROM outpasses
            WHERE student_id = $1
            AND outp_status = 'Approved'
            AND is_active = true
            LIMIT 1;
        `;

        const outpassResult = await client.query(
            outpassQuery,
            [student.id]
        );

        if (outpassResult.rows.length === 0) {
            throw new ApiError(
                404,
                "No active approved outpass found"
            );
        }

        const outpass = outpassResult.rows[0];

        // Already outside
        if (outpass.std_status === "Out") {
            throw new ApiError(
                400,
                "Student already outside hostel"
            );
        }

        // =========================
        // Create Visit Log
        // =========================

        const visitQuery = `
            INSERT INTO visit_logs (
                outpass_id,
                student_id
            )
            VALUES ($1, $2);
        `;

        await client.query(visitQuery, [
            outpass.id,
            student.id
        ]);

        // =========================
        // Update Status
        // =========================

        const updateQuery = `
            UPDATE outpasses
            SET
                std_status = 'Out',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1;
        `;

        await client.query(updateQuery, [outpass.id]);

        await client.query("COMMIT");

        return res.status(200).json(
            new ApiResponse(
                200,
                {
                    student_name: student.name,
                    roll_no: student.roll_no,
                    outpass_id: outpass.id,
                    status: "Out"
                },
                "Student exit recorded successfully"
            )
        );

    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
});


/*
=================================================
Student RETURN
POST /api/guard/return
=================================================
BODY:
{
    "roll_no": "24BCS017"
}
=================================================
*/

const studentReturn = asyncHandler(async (req, res) => {
    const { roll_no } = req.body;

    if (!roll_no) {
        throw new ApiError(
            400,
            "Roll number is required"
        );
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // =========================
        // Find Student
        // =========================

        const studentQuery = `
            SELECT id, name, roll_no
            FROM students
            WHERE roll_no = $1;
        `;

        const studentResult = await client.query(
            studentQuery,
            [roll_no]
        );

        if (studentResult.rows.length === 0) {
            throw new ApiError(
                404,
                "Student not found"
            );
        }

        const student = studentResult.rows[0];

        // =========================
        // Find Active Outside Outpass
        // =========================

        const outpassQuery = `
            SELECT *
            FROM outpasses
            WHERE student_id = $1
            AND std_status = 'Out'
            AND is_active = true
            LIMIT 1;
        `;

        const outpassResult = await client.query(
            outpassQuery,
            [student.id]
        );

        if (outpassResult.rows.length === 0) {
            throw new ApiError(
                404,
                "Student is already inside hostel"
            );
        }

        const outpass = outpassResult.rows[0];

        // =========================
        // Update Visit Log
        // =========================

        const visitQuery = `
            UPDATE visit_logs
            SET
                actual_arrival = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE outpass_id = $1
            AND student_id = $2
            RETURNING *;
        `;

        await client.query(
            visitQuery,
            [outpass.id, student.id]
        );

        // =========================
        // Update Outpass Status
        // =========================

        const updateQuery = `
            UPDATE outpasses
            SET
                std_status = 'In',
                is_active = false,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1;
        `;

        await client.query(updateQuery, [outpass.id]);

        await client.query("COMMIT");

        return res.status(200).json(
            new ApiResponse(
                200,
                {
                    student_name: student.name,
                    roll_no: student.roll_no,
                    outpass_id: outpass.id,
                    status: "In"
                },
                "Student return recorded successfully"
            )
        );

    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
});

export {
    createOutpass,
    getMyOutpasses,
    getActiveOutpass,
    getOutpassById,
    cancelOutpass,
    getPendingOutpasses,
    approveOutpass,
    rejectOutpass,
    getLateReturns,
    studentExit,
    studentReturn
};