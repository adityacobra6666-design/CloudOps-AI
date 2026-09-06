const Incident = require("../models/incident.model");
const IncidentActivity = require("../models/incidentActivity.model");
const { analyzeIncident } = require("../services/ai.service");


// =========================================
// CREATE INCIDENT
// =========================================

const createIncident = async (req, res) => {
    try {
        const {
            title,
            description,
            severity,
            server
        } = req.body;

        const incident = await Incident.create({
            title,
            description,
            severity,
            server
        });

        // Save activity
        await IncidentActivity.create({
            incident: incident._id,
            type: "CREATED",
            message: "Incident created",
            metadata: {
                severity: incident.severity,
                server: incident.server
            }
        });

        res.status(201).json({
            success: true,
            message: "Incident created successfully",
            data: incident
        });

    } catch (error) {
        console.error(
            "Create Incident Error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Failed to create incident",
            error: error.message
        });
    }
};


// =========================================
// GET ALL INCIDENTS
// =========================================

const getIncidents = async (req, res) => {
    try {
        const incidents = await Incident
            .find()
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: incidents.length,
            data: incidents
        });

    } catch (error) {
        console.error(
            "Get Incidents Error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Failed to fetch incidents",
            error: error.message
        });
    }
};


// =========================================
// GET ONE INCIDENT
// =========================================

const getIncidentById = async (req, res) => {
    try {
        const incident = await Incident.findById(
            req.params.id
        );

        if (!incident) {
            return res.status(404).json({
                success: false,
                message: "Incident not found"
            });
        }

        res.status(200).json({
            success: true,
            data: incident
        });

    } catch (error) {
        console.error(
            "Get Incident Error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Failed to fetch incident",
            error: error.message
        });
    }
};


// =========================================
// GET INCIDENT ACTIVITY
// =========================================

const getIncidentActivity = async (req, res) => {
    try {
        const incident = await Incident.findById(
            req.params.id
        );

        if (!incident) {
            return res.status(404).json({
                success: false,
                message: "Incident not found"
            });
        }

        const activities = await IncidentActivity
            .find({
                incident: req.params.id
            })
            .sort({
                createdAt: 1
            });

        res.status(200).json({
            success: true,
            count: activities.length,
            data: activities
        });

    } catch (error) {
        console.error(
            "Get Incident Activity Error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Failed to fetch incident activity",
            error: error.message
        });
    }
};


// =========================================
// UPDATE INCIDENT
// =========================================

const updateIncident = async (req, res) => {
    try {
        const existingIncident = await Incident.findById(
            req.params.id
        );

        if (!existingIncident) {
            return res.status(404).json({
                success: false,
                message: "Incident not found"
            });
        }

        const previousStatus = existingIncident.status;
        const previousSeverity = existingIncident.severity;

        const incident = await Incident.findByIdAndUpdate(
            req.params.id,
            req.body,
            {
                new: true,
                runValidators: true
            }
        );

        // General update activity
        await IncidentActivity.create({
            incident: incident._id,
            type: "UPDATED",
            message: "Incident details updated",
            metadata: {
                updatedFields: Object.keys(req.body)
            }
        });

        // Status change activity
        if (
            req.body.status &&
            req.body.status !== previousStatus
        ) {
            await IncidentActivity.create({
                incident: incident._id,
                type: "STATUS_CHANGED",
                message:
                    `Status changed from ${previousStatus} to ${incident.status}`,
                metadata: {
                    from: previousStatus,
                    to: incident.status
                }
            });
        }

        // Severity change activity
        if (
            req.body.severity &&
            req.body.severity !== previousSeverity
        ) {
            await IncidentActivity.create({
                incident: incident._id,
                type: "SEVERITY_CHANGED",
                message:
                    `Severity changed from ${previousSeverity} to ${incident.severity}`,
                metadata: {
                    from: previousSeverity,
                    to: incident.severity
                }
            });
        }

        res.status(200).json({
            success: true,
            message: "Incident updated successfully",
            data: incident
        });

    } catch (error) {
        console.error(
            "Update Incident Error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Failed to update incident",
            error: error.message
        });
    }
};


// =========================================
// DELETE INCIDENT
// =========================================

const deleteIncident = async (req, res) => {
    try {
        const incident = await Incident.findById(
            req.params.id
        );

        if (!incident) {
            return res.status(404).json({
                success: false,
                message: "Incident not found"
            });
        }

        // Delete activity history belonging to incident
        await IncidentActivity.deleteMany({
            incident: incident._id
        });

        await Incident.findByIdAndDelete(
            req.params.id
        );

        res.status(200).json({
            success: true,
            message: "Incident deleted successfully"
        });

    } catch (error) {
        console.error(
            "Delete Incident Error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Failed to delete incident",
            error: error.message
        });
    }
};


// =========================================
// AI ANALYSIS
// =========================================

const analyzeIncidentWithAI = async (req, res) => {
    try {
        const incident = await Incident.findById(
            req.params.id
        );

        if (!incident) {
            return res.status(404).json({
                success: false,
                message: "Incident not found"
            });
        }

        console.log(
            "🤖 Starting AI analysis..."
        );

        const analysis = await analyzeIncident(
            incident
        );

        console.log(
            "✅ AI analysis received"
        );

        // Save structured AI analysis
        incident.analysis = analysis;

        await incident.save();

        // Save activity
        await IncidentActivity.create({
            incident: incident._id,
            type: "AI_ANALYSIS",
            message: "AI incident analysis generated",
            metadata: {
                severity:
                    analysis?.severityAssessment?.level ||
                    null
            }
        });

        console.log(
            "💾 AI analysis saved to MongoDB"
        );

        res.status(200).json({
            success: true,
            message:
                "AI analysis completed successfully",
            data: {
                incidentId: incident._id,
                analysis
            }
        });

    } catch (error) {
        console.error(
            "AI Analysis Controller Error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Failed to analyze incident",
            error: error.message
        });
    }
};


module.exports = {
    createIncident,
    getIncidents,
    getIncidentById,
    getIncidentActivity,
    updateIncident,
    deleteIncident,
    analyzeIncidentWithAI
};