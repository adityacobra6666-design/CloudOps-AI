const mongoose = require("mongoose");

const incidentActivitySchema = new mongoose.Schema(
    {
        incident: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Incident",
            required: true,
            index: true
        },

        type: {
            type: String,
            enum: [
                "CREATED",
                "UPDATED",
                "STATUS_CHANGED",
                "SEVERITY_CHANGED",
                "AI_ANALYSIS"
            ],
            required: true
        },

        message: {
            type: String,
            required: true,
            trim: true
        },

        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: null
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model(
    "IncidentActivity",
    incidentActivitySchema
);