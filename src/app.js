import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import outpassRoutes from "./routes/outpass.routes.js";
import pool from "./db/pool.js";

const app = express();

/*
=================================================
MIDDLEWARES
=================================================
*/

app.use(express.json());

app.use(express.urlencoded({ extended: true }));
app.use(cors());


app.use(cookieParser());

/*
=================================================
TEST ROUTES
=================================================
*/

// Health Check
app.get("/", (req, res) => {
    res.status(200).json({
        success: true,
        message: "Outpass Backend Running Successfully"
    });
});

app.post("/debug", (req, res) => {
    console.log(req.body);

    res.json({
        body: req.body
    });
});

// PostgreSQL Connection Test
app.get("/test-db", async (req, res) => {
    try {

        const result = await pool.query(
            "SELECT NOW()"
        );

        return res.status(200).json({
            success: true,
            message: "Database connected successfully",
            data: result.rows
        });

    } catch (error) {

        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

/*
=================================================
API ROUTES
=================================================
*/

app.use(
    "/api/outpasses",
    outpassRoutes
);

/*
=================================================
GLOBAL ERROR HANDLER
=================================================
*/

app.use((err, req, res, next) => {

    return res.status(err.statusCode || 500).json({
        success: false,
        message: err.message || "Internal Server Error",
        errors: err.errors || []
    });

});

export default app;