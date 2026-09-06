const mongoose = require("mongoose");

const incidentSchema = new mongoose.Schema(
    {
        title: {
            type: String,
            required: true,
            trim: true
        },

        description: {
            type: String,
            required: true,
            trim: true
        },

        severity: {
            type: String,
            enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
            default: "MEDIUM"
        },

        status: {
            type: String,
            enum: ["OPEN", "IN_PROGRESS", "RESOLVED"],
            default: "OPEN"
        },

        server: {
            type: String,
            required: true,
            trim: true
        },

        analysis: {
            type: mongoose.Schema.Types.Mixed,
            default: null
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.models.Incident || mongoose.model("Incident", incidentSchema);