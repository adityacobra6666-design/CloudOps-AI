require("dotenv").config();

const app = require("./app");
const mongoose = require("mongoose");

const PORT = process.env.PORT || 5000;

// ================================
// VALIDATE REQUIRED ENV VARS
// ================================

const requiredEnvVars = ["MONGO_URI", "JWT_SECRET"];
const missingVars = requiredEnvVars.filter(v => !process.env[v]);

if (missingVars.length > 0) {
    console.error(`❌ Missing required environment variables: ${missingVars.join(", ")}`);
    console.error("   Please check your .env file or environment configuration.");
    process.exit(1);
}

// ================================
// MONGODB CONNECTION WITH RETRY
// ================================

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 3000;

const connectDB = async () => {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            await mongoose.connect(process.env.MONGO_URI);
            console.log("✅ MongoDB Connected");
            return;
        } catch (error) {
            console.error(
                `❌ MongoDB Connection Failed (attempt ${attempt}/${MAX_RETRIES}):`,
                error.message
            );

            if (attempt === MAX_RETRIES) {
                console.error("❌ All MongoDB connection attempts exhausted. Exiting.");
                process.exit(1);
            }

            console.log(`⏳ Retrying in ${RETRY_DELAY_MS / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        }
    }
};

// ================================
// START SERVER
// ================================

let server;

const startServer = async () => {
    await connectDB();

    server = app.listen(PORT, () => {
        console.log(`🚀 CloudOps AI Backend Started`);
        console.log(`🌐 http://localhost:${PORT}`);
    });
};

// ================================
// GRACEFUL SHUTDOWN
// ================================

const gracefulShutdown = async (signal) => {
    console.log(`\n⚡ ${signal} received. Shutting down gracefully...`);

    if (server) {
        server.close(() => {
            console.log("✅ HTTP server closed.");
        });
    }

    try {
        await mongoose.connection.close();
        console.log("✅ MongoDB connection closed.");
    } catch (err) {
        console.error("❌ Error closing MongoDB:", err.message);
    }

    process.exit(0);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason) => {
    console.error("⚠️ Unhandled Promise Rejection:", reason?.message || reason);
});

startServer();