const express = require("express");
const router = express.Router();
const observabilityController = require("../controllers/observability.controller");

router.get("/telemetry", observabilityController.getTelemetry);

module.exports = router;
