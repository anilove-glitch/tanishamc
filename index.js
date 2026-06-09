import dotenv from "dotenv";

dotenv.config();

import app from "./src/app.js";
import { initSchedulers } from "./src/roomallocation/schedulers/index.js";
import { initEmitter } from "./src/roomallocation/websocket/emitter.js";
import redisClient from "./src/config/redis.js";

const PORT = process.env.PORT || 4000;

/*
=================================================
START SERVER
=================================================
*/

// Hook up realtime emitter (Pusher Channels)
initEmitter();

// Initialize Schedulers and start listening
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    try {
        await redisClient.connect();
        console.log("Redis connected successfully.");
    } catch (err) {
        console.error("Failed to connect to Redis:", err);
    }
    try {
        await initSchedulers();
        console.log("Schedulers initialized successfully.");
    } catch (err) {
        console.error("Failed to initialize schedulers:", err);
    }
});
