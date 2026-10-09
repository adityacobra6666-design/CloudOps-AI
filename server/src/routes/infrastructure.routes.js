const express = require("express");
const router = express.Router();
const infrastructureController = require("../controllers/infrastructure.controller");
const { protect, requireRole } = require("../middleware/auth.middleware");

// All infrastructure management requires authentication
router.get("/connections", protect, requireRole("VIEWER", "ENGINEER", "ADMIN"), infrastructureController.getConnections);
router.get("/connections/:id", protect, requireRole("VIEWER", "ENGINEER", "ADMIN"), infrastructureController.getConnectionById);

// Creation, revocation and deletion require ENGINEER or ADMIN role
router.post("/connections", protect, requireRole("ENGINEER", "ADMIN"), infrastructureController.createConnection);
router.post("/connections/:id/revoke", protect, requireRole("ENGINEER", "ADMIN"), infrastructureController.revokeConnection);
router.delete("/connections/:id", protect, requireRole("ADMIN"), infrastructureController.deleteConnection);

module.exports = router;
