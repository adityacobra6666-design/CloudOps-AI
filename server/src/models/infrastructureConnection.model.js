const mongoose = require("mongoose");

const infrastructureConnectionSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },
        type: {
            type: String,
            enum: ["KUBERNETES", "PROMETHEUS", "DOCKER", "LINUX"],
            default: "KUBERNETES",
            required: true
        },
        environment: {
            type: String,
            trim: true,
            default: "production"
        },
        description: {
            type: String,
            trim: true,
            default: ""
        },
        status: {
            type: String,
            enum: ["PENDING", "CONNECTED", "DEGRADED", "DISCONNECTED", "REVOKED"],
            default: "PENDING"
        },
        agentId: {
            type: String,
            unique: true,
            sparse: true,
            index: true
        },
        // One-time enrollment token hash (SHA-256)
        enrollmentTokenHash: {
            type: String,
            default: null
        },
        enrollmentTokenExpiresAt: {
            type: Date,
            default: null
        },
        enrollmentTokenUsed: {
            type: Boolean,
            default: false
        },
        // Long-lived operational agent token hash (SHA-256)
        agentTokenHash: {
            type: String,
            default: null
        },
        tokenCreatedAt: {
            type: Date,
            default: null
        },
        lastSeenAt: {
            type: Date,
            default: null
        },
        registeredAt: {
            type: Date,
            default: null
        },
        version: {
            type: String,
            default: "1.0.0"
        },
        capabilities: {
            type: [String],
            default: ["METRICS", "KUBERNETES_READ", "KUBERNETES_REMEDIATION"]
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        },
        // Latest telemetry snapshot received from agent
        telemetry: {
            metrics: {
                type: mongoose.Schema.Types.Mixed,
                default: null
            },
            recordedAt: {
                type: Date,
                default: null
            }
        },
        // Latest Kubernetes resources snapshot received from agent
        k8sSummary: {
            nodesCount: { type: Number, default: 0 },
            podsCount: { type: Number, default: 0 },
            deploymentsCount: { type: Number, default: 0 },
            servicesCount: { type: Number, default: 0 },
            nodes: { type: [mongoose.Schema.Types.Mixed], default: [] },
            pods: { type: [mongoose.Schema.Types.Mixed], default: [] },
            deployments: { type: [mongoose.Schema.Types.Mixed], default: [] },
            services: { type: [mongoose.Schema.Types.Mixed], default: [] },
            updatedAt: { type: Date, default: null }
        },
        enabled: {
            type: Boolean,
            default: true
        }
    },
    {
        timestamps: true
    }
);

// Method to verify enrollment token safely using constant-time comparison
infrastructureConnectionSchema.methods.verifyEnrollmentToken = function (rawToken) {
    if (this.enrollmentTokenUsed || !this.enrollmentTokenHash) return false;
    if (this.enrollmentTokenExpiresAt && new Date() > this.enrollmentTokenExpiresAt) return false;
    const crypto = require("crypto");
    const hash = crypto.createHash("sha256").update(rawToken).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(this.enrollmentTokenHash));
};

// Method to verify agent token safely using constant-time comparison
infrastructureConnectionSchema.methods.verifyAgentToken = function (rawToken) {
    if (!this.agentTokenHash || this.status === "REVOKED" || !this.enabled) return false;
    const crypto = require("crypto");
    const hash = crypto.createHash("sha256").update(rawToken).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(this.agentTokenHash));
};

module.exports =
    mongoose.models.InfrastructureConnection ||
    mongoose.model("InfrastructureConnection", infrastructureConnectionSchema);
