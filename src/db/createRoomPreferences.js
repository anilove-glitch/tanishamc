import pool from "./db.js";

const createTable = async () => {
    try {

        await pool.query(`
            CREATE TABLE IF NOT EXISTS room_preferences (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

                group_id UUID NOT NULL,

                room_id UUID NOT NULL,

                preference_order INT NOT NULL
            );
        `);

        console.log("room_preferences table created");

        process.exit();

    } catch (error) {

        console.log(error);

        process.exit(1);

    }
};

createTable();