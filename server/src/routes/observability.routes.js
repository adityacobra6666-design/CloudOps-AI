const express = require("express");
const router = express.Router();
const observabilityController = require("../controllers/observability.controller");
const { protect } = require("../middleware/auth.middleware");

router.get("/telemetry", protect, observabilityController.getTelemetry);

module.exports = router;

