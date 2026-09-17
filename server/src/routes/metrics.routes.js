const express = require("express");
const router = express.Router();
const metricsController = require("../controllers/metrics.controller");
const { protect } = require("../middleware/auth.middleware");

router.get("/overview", protect, metricsController.getOverviewMetrics);
router.get("/services", protect, metricsController.getServicesHealth);
router.get("/system-health", protect, metricsController.getSystemHealth);

module.exports = router;
