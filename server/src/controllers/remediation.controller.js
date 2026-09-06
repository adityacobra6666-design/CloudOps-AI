const Incident = require("../models/Incident");

const {
    executeRemediation,
    getRemediationHistory,
    getRemediationById
} = require("../services/remediation/remediationService");


// =========================================
// EXECUTE REMEDIATION
// POST /api/remediation/:incidentId/execute
// =========================================

const triggerRemediation = async (req, res) => {

    try {

        const { incidentId } = req.params;


        // Validate incident exists
        const incident =
            await Incident.findById(incidentId);

        if (!incident) {

            return res.status(404).json({
                success: false,
                message: "Incident not found"
            });
        }


        console.log(
            `🚀 Remediation triggered for: ${incident.title}`
        );


        // Run the full remediation pipeline
        const result =
            await executeRemediation(incidentId);


        const statusCode =
            result.success ? 200 : 422;


        res.status(statusCode).json({

            success: result.success,

            message: result.message,

            data: {
                incidentId: incident._id,
                action: result.action
            }

        });


    } catch (error) {

        console.error(
            "REMEDIATION CONTROLLER ERROR:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Remediation failed",
            error: error.message
        });
    }
};


// =========================================
// GET REMEDIATION HISTORY
// GET /api/remediation/:incidentId/history
// =========================================

const getHistory = async (req, res) => {

    try {

        const { incidentId } = req.params;


        // Validate incident exists
        const incident =
            await Incident.findById(incidentId);

        if (!incident) {

            return res.status(404).json({
                success: false,
                message: "Incident not found"
            });
        }


        const actions =
            await getRemediationHistory(incidentId);


        res.status(200).json({
            success: true,
            count: actions.length,
            data: actions
        });


    } catch (error) {

        console.error(
            "GET REMEDIATION HISTORY ERROR:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Failed to fetch remediation history",
            error: error.message
        });
    }
};


// =========================================
// GET REMEDIATION STATUS
// GET /api/remediation/actions/:actionId
// =========================================

const getStatus = async (req, res) => {

    try {

        const { actionId } = req.params;


        const action =
            await getRemediationById(actionId);


        if (!action) {

            return res.status(404).json({
                success: false,
                message: "Remediation action not found"
            });
        }


        res.status(200).json({
            success: true,
            data: action
        });


    } catch (error) {

        console.error(
            "GET REMEDIATION STATUS ERROR:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Failed to fetch remediation status",
            error: error.message
        });
    }
};


// =========================================
// GET ALL REMEDIATION ACTIONS
// GET /api/remediation/actions
// =========================================

const getAllActions = async (req, res) => {
    try {
        const RemediationAction = require("../models/remediationAction.model");
        const actions = await RemediationAction.find()
            .populate("incident", "title severity status source")
            .sort({ createdAt: -1 })
            .limit(50);

        res.status(200).json({
            success: true,
            count: actions.length,
            data: actions
        });
    } catch (error) {
        console.error("GET ALL REMEDIATION ACTIONS ERROR:", error.message);
        res.status(500).json({
            success: false,
            message: "Failed to fetch remediation actions",
            error: error.message
        });
    }
};


module.exports = {
    triggerRemediation,
    getHistory,
    getStatus,
    getAllActions
};

