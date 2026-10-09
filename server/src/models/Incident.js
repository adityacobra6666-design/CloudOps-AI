const mongoose = require("mongoose");

const incidentSchema = new mongoose.Schema({

    // =========================================
    // BASIC INCIDENT INFORMATION
    // =========================================

    title: {
        type: String,
        required: true
    },

    description: {
        type: String,
        default: ""
    },

    severity: {
        type: String,
        enum: [
            "critical",
            "warning",
            "info",
            "CRITICAL",
            "HIGH",
            "MEDIUM",
            "LOW"
        ],
        default: "warning"
    },

    source: {
        type: String,
        default: "Prometheus Alertmanager"
    },

    category: {
        type: String,
        default: "infrastructure"
    },

    status: {
        type: String,
        enum: [
            "open",
            "resolved",
            "OPEN",
            "RESOLVED",
            "in_progress",
            "closed"
        ],
        default: "open"
    },

    server: {
        type: String,
        default: null
    },

    connectionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "InfrastructureConnection",
        default: null,
        index: true
    },

    environment: {
        type: String,
        default: null
    },

    // =========================================
    // PROMETHEUS / ALERTMANAGER DEDUPLICATION
    // =========================================

    alertFingerprint: {
        type: String,
        default: null,
        index: true
    },

    alertName: {
        type: String,
        default: null
    },

    startsAt: {
        type: Date,
        default: null
    },

    endsAt: {
        type: Date,
        default: null
    },

    generatorURL: {
        type: String,
        default: null
    },

    // =========================================
    // AI / RAG INFORMATION
    // =========================================

    aiAnalysis: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    },

    aiRootCause: {
        type: String,
        default: null
    },

    aiRecommendation: {
        type: String,
        default: null
    },

    aiAnalyzedAt: {
        type: Date,
        default: null
    },

    // =========================================
    // RAG EMBEDDING
    // =========================================

    embedding: {
        type: [Number],
        default: undefined
    },

    // =========================================
    // AUTONOMOUS REMEDIATION
    // =========================================

    remediationDecision: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    },

    remediationStatus: {
        type: String,
        default: null
    },

    // =========================================
    // TIMESTAMP
    // =========================================

    createdAt: {
        type: Date,
        default: Date.now
    }

});

module.exports =
    mongoose.models.Incident ||
    mongoose.model("Incident", incidentSchema);