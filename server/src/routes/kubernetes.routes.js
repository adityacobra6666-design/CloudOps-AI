const express = require("express");
const router = express.Router();
const kubernetesController = require("../controllers/kubernetes.controller");

router.get("/overview", kubernetesController.getKubernetesOverview);
router.get("/status", kubernetesController.getKubernetesStatus);
router.get("/health", kubernetesController.getKubernetesHealth);
router.get("/nodes", kubernetesController.getKubernetesNodes);
router.get("/pods", kubernetesController.getKubernetesPods);
router.get("/deployments", kubernetesController.getKubernetesDeployments);
router.get("/services", kubernetesController.getKubernetesServices);

router.post("/action", kubernetesController.executeKubernetesAction);

module.exports = router;
