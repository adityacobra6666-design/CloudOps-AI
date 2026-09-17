const express = require("express");

const {
    triggerRemediation,
    getHistory,
    getStatus,
    getAllActions
} = require("../controllers/remediation.controller");

const { protect, requireRole } = require("../middleware/auth.middleware");

const router = express.Router();

// =========================================
// PROTECTED REMEDIATION ROUTES (RBAC)
// =========================================
router.get("/actions", protect, requireRole("VIEWER", "ENGINEER", "ADMIN"), getAllActions);
router.get("/actions/:actionId", protect, requireRole("VIEWER", "ENGINEER", "ADMIN"), getStatus);
router.get("/:incidentId/history", protect, requireRole("VIEWER", "ENGINEER", "ADMIN"), getHistory);

// Operational execution requires ENGINEER or ADMIN role
router.post("/:incidentId/execute", protect, requireRole("ENGINEER", "ADMIN"), triggerRemediation);

module.exports = router;
