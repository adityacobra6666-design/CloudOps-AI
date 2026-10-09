const express = require("express");
const router = express.Router();
const agentController = require("../controllers/agent.controller");
const { authenticateAgent } = require("../middleware/agentAuth.middleware");
const {
    registerLimiter,
    heartbeatLimiter,
    telemetryLimiter,
    commandPollLimiter,
    commandResultLimiter
} = require("../middleware/agentRateLimit.middleware");

// Enrollment & registration
router.post("/register", registerLimiter, agentController.registerAgent);

// Periodic agent communications (protected by agent authentication)
router.post("/heartbeat", heartbeatLimiter, authenticateAgent, agentController.heartbeat);
router.post("/telemetry", telemetryLimiter, authenticateAgent, agentController.telemetry);
router.get("/commands", commandPollLimiter, authenticateAgent, agentController.getCommands);
router.post("/command-result", commandResultLimiter, authenticateAgent, agentController.submitCommandResult);

module.exports = router;
