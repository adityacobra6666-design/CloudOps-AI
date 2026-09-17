const express = require("express");
const router = express.Router();
const kubernetesController = require("../controllers/kubernetes.controller");
const { protect, requireRole } = require("../middleware/auth.middleware");

// Read-only cluster topology available to VIEWER, ENGINEER, ADMIN
router.get("/overview", protect, requireRole("VIEWER", "ENGINEER", "ADMIN"), kubernetesController.getKubernetesOverview);
router.get("/status", protect, requireRole("VIEWER", "ENGINEER", "ADMIN"), kubernetesController.getKubernetesStatus);
router.get("/health", protect, requireRole("VIEWER", "ENGINEER", "ADMIN"), kubernetesController.getKubernetesHealth);
router.get("/nodes", protect, requireRole("VIEWER", "ENGINEER", "ADMIN"), kubernetesController.getKubernetesNodes);
router.get("/pods", protect, requireRole("VIEWER", "ENGINEER", "ADMIN"), kubernetesController.getKubernetesPods);
router.get("/deployments", protect, requireRole("VIEWER", "ENGINEER", "ADMIN"), kubernetesController.getKubernetesDeployments);
router.get("/services", protect, requireRole("VIEWER", "ENGINEER", "ADMIN"), kubernetesController.getKubernetesServices);

// Operational Kubernetes actions (scaling, restarts) require ENGINEER or ADMIN role
router.post("/action", protect, requireRole("ENGINEER", "ADMIN"), kubernetesController.executeKubernetesAction);

module.exports = router;
