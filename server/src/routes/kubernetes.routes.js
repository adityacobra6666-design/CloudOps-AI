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
router.get("/deployments/:name/status", protect, requireRole("VIEWER", "ENGINEER", "ADMIN"), kubernetesController.getDeploymentStatus);
router.get("/services", protect, requireRole("VIEWER", "ENGINEER", "ADMIN"), kubernetesController.getKubernetesServices);

// Specific deployment operations (scaling, rolling restarts) require ENGINEER or ADMIN role
router.post("/deployments/:name/scale", protect, requireRole("ENGINEER", "ADMIN"), kubernetesController.scaleDeployment);
router.post("/deployments/:name/restart", protect, requireRole("ENGINEER", "ADMIN"), kubernetesController.restartDeployment);

// Operational Kubernetes actions (generic route) require ENGINEER or ADMIN role
router.post("/action", protect, requireRole("ENGINEER", "ADMIN"), kubernetesController.executeKubernetesAction);

// On-demand cluster refresh (read-only query dispatch)
router.post("/refresh", protect, requireRole("VIEWER", "ENGINEER", "ADMIN"), kubernetesController.refreshKubernetesCluster);

module.exports = router;
