const express = require("express");

const {
    createIncident,
    getIncidents,
    getIncidentById,
    getIncidentActivity,
    updateIncident,
    deleteIncident,
    analyzeIncidentWithAI,
    alertWebhook
} = require("../controllers/incidentController");

const { protect, requireRole } = require("../middleware/auth.middleware");

const router = express.Router();

// =========================================
// PUBLIC ALERTMANAGER WEBHOOK
// =========================================
router.post("/webhook", alertWebhook);

// =========================================
// PROTECTED INCIDENT ROUTES (RBAC)
// =========================================
router.get("/", protect, requireRole("VIEWER", "ENGINEER", "ADMIN"), getIncidents);
router.get("/:id", protect, requireRole("VIEWER", "ENGINEER", "ADMIN"), getIncidentById);
router.get("/:id/activity", protect, requireRole("VIEWER", "ENGINEER", "ADMIN"), getIncidentActivity);

router.post("/", protect, requireRole("ENGINEER", "ADMIN"), createIncident);
router.put("/:id", protect, requireRole("ENGINEER", "ADMIN"), updateIncident);
router.post("/:id/analyze", protect, requireRole("ENGINEER", "ADMIN"), analyzeIncidentWithAI);

router.delete("/:id", protect, requireRole("ADMIN"), deleteIncident);

module.exports = router;