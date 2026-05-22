import dotenv from "dotenv";
import http from "http";
import { Server } from "socket.io";

dotenv.config();

import app from "./src/app.js";
import { initSchedulers } from "./src/roomallocation/schedulers/index.js";
import { initEmitter } from "./src/roomallocation/websocket/emitter.js";

const PORT = process.env.PORT || 4000;

/*
=================================================
START SERVER
=================================================
*/

const server = http.createServer(app);

// Initialize Socket.IO Server
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    }
});

// Hook up Emitter
initEmitter(io);

// Socket.IO event handling
io.on("connection", (socket) => {
    console.log(`[WS] Client connected: ${socket.id}`);

    socket.on("join_hostel", ({ hostelId }) => {
        if (hostelId) {
            socket.join(hostelId);
            console.log(`[WS] Client ${socket.id} joined room: ${hostelId}`);
        }
    });

    socket.on("leave_hostel", ({ hostelId }) => {
        if (hostelId) {
            socket.leave(hostelId);
            console.log(`[WS] Client ${socket.id} left room: ${hostelId}`);
        }
    });

    socket.on("disconnect", (reason) => {
        console.log(`[WS] Client disconnected: ${socket.id} (reason: ${reason})`);
    });
});

// Initialize Schedulers and start listening
server.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    try {
        await initSchedulers();
        console.log("Schedulers initialized successfully.");
    } catch (err) {
        console.error("Failed to initialize schedulers:", err);
    }
});