const express = require("express");
const router = express.Router();
const metricsController = require("../controllers/metrics.controller");

router.get("/overview", metricsController.getOverviewMetrics);
router.get("/services", metricsController.getServicesHealth);
router.get("/system-health", metricsController.getSystemHealth);

module.exports = router;
