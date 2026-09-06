const express = require("express");

const {
    triggerRemediation,
    getHistory,
    getStatus,
    getAllActions
} = require("../controllers/remediation.controller");


const router = express.Router();


// =========================================
// GET ALL REMEDIATION ACTIONS
// =========================================

router.get(
    "/actions",
    getAllActions
);


// =========================================
// EXECUTE REMEDIATION
// =========================================

router.post(
    "/:incidentId/execute",
    triggerRemediation
);


// =========================================
// GET REMEDIATION HISTORY FOR INCIDENT
// =========================================

router.get(
    "/:incidentId/history",
    getHistory
);


// =========================================
// GET SINGLE REMEDIATION ACTION
// =========================================

router.get(
    "/actions/:actionId",
    getStatus
);


module.exports = router;
