const mongoose = require("mongoose");

const {
    ALLOWED_ACTIONS,
    REMEDIATION_STATUS
} = require("../config/remediation.config");


const remediationActionSchema = new mongoose.Schema(
    {
        // =========================================
        // INCIDENT REFERENCE
        // =========================================

        incident: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Incident",
            required: false,
            default: null,
            index: true
        },

        connection: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "InfrastructureConnection",
            default: null,
            index: true
        },


        // =========================================
        // ACTION DETAILS
        // =========================================

        action: {
            type: String,
            enum: ALLOWED_ACTIONS,
            required: true
        },

        target: {
            type: String,
            required: true,
            trim: true
        },

        reason: {
            type: String,
            required: true,
            trim: true
        },

        triggeredBy: {
            type: String,
            default: "CloudOps AI"
        },

        executor: {
            type: String,
            default: null
        },

        agentId: {
            type: String,
            default: null
        },


        // =========================================
        // STATUS
        // =========================================

        status: {
            type: String,
            enum: Object.values(REMEDIATION_STATUS),
            default: REMEDIATION_STATUS.PENDING
        },


        // =========================================
        // POLICY EVALUATION
        // =========================================

        policy: {
            approved: {
                type: Boolean,
                default: null
            },
            rule: {
                type: String,
                default: null
            },
            reason: {
                type: String,
                default: null
            }
        },


        // =========================================
        // EXECUTION TIMESTAMPS
        // =========================================

        startedAt: {
            type: Date,
            default: null
        },

        completedAt: {
            type: Date,
            default: null
        },


        // =========================================
        // RESULT
        // =========================================

        result: {
            type: String,
            default: null
        },


        // =========================================
        // VERIFICATION
        // =========================================

        verification: {
            status: {
                type: String,
                enum: [
                    "SUCCESS",
                    "FAILED",
                    "UNVERIFIED",
                    null
                ],
                default: null
            },
            metric: {
                type: String,
                default: null
            },
            before: {
                type: Number,
                default: null
            },
            after: {
                type: Number,
                default: null
            },
            message: {
                type: String,
                default: null
            }
        },


        // =========================================
        // ERROR
        // =========================================

        error: {
            type: String,
            default: null
        }
    },
    {
        timestamps: true
    }
);


module.exports = mongoose.model(
    "RemediationAction",
    remediationActionSchema
);
