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

const router = express.Router();


// =========================================
// GET ALL INCIDENTS
// =========================================

router.get(
    "/",
    getIncidents
);


// =========================================
// CREATE INCIDENT
// =========================================

router.post(
    "/",
    createIncident
);


// =========================================
// GET ONE INCIDENT
// =========================================

router.get(
    "/:id",
    getIncidentById
);


// =========================================
// GET INCIDENT ACTIVITY
// =========================================

router.get(
    "/:id/activity",
    getIncidentActivity
);


// =========================================
// UPDATE INCIDENT
// =========================================

router.put(
    "/:id",
    updateIncident
);


// =========================================
// DELETE INCIDENT
// =========================================

router.delete(
    "/:id",
    deleteIncident
);


// =========================================
// AI ANALYSIS
// =========================================

router.post(
    "/:id/analyze",
    analyzeIncidentWithAI
);

router.post(
    "/webhook",
    alertWebhook
);

module.exports = router;