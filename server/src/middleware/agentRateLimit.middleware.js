const rateLimit = require("express-rate-limit");

const registerLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many registration attempts. Please retry later." }
});

const heartbeatLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120, // 2 req/sec headroom for 15-30s heartbeats
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Heartbeat rate limit exceeded." }
});

const telemetryLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120, // 2 req/sec headroom for 10s telemetry
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Telemetry ingestion rate limit exceeded." }
});

const commandPollLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 180, // 3 req/sec headroom for 5s polling
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Command polling rate limit exceeded." }
});

const commandResultLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Command result submission rate limit exceeded." }
});

module.exports = {
    registerLimiter,
    heartbeatLimiter,
    telemetryLimiter,
    commandPollLimiter,
    commandResultLimiter
};
