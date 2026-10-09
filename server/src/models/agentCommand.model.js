const mongoose = require("mongoose");

const agentCommandSchema = new mongoose.Schema(
    {
        commandId: {
            type: String,
            required: true,
            unique: true,
            index: true
        },
        connectionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "InfrastructureConnection",
            required: true,
            index: true
        },
        agentId: {
            type: String,
            required: true,
            index: true
        },
        incidentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Incident",
            default: null,
            index: true
        },
        action: {
            type: String,
            enum: ["RESTART_SERVICE", "SCALE_SERVICE"],
            required: true
        },
        target: {
            type: mongoose.Schema.Types.Mixed,
            required: true
        },
        parameters: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        },
        reason: {
            type: String,
            default: ""
        },
        status: {
            type: String,
            enum: ["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "REJECTED", "EXPIRED"],
            default: "PENDING",
            index: true
        },
        expiresAt: {
            type: Date,
            default: () => new Date(Date.now() + 5 * 60 * 1000) // 5 minutes default expiry
        },
        startedAt: {
            type: Date,
            default: null
        },
        completedAt: {
            type: Date,
            default: null
        },
        result: {
            type: mongoose.Schema.Types.Mixed,
            default: null
        },
        error: {
            type: String,
            default: null
        },
        verification: {
            type: mongoose.Schema.Types.Mixed,
            default: null
        }
    },
    {
        timestamps: true
    }
);

module.exports =
    mongoose.models.AgentCommand ||
    mongoose.model("AgentCommand", agentCommandSchema);
