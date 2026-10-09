const crypto = require("crypto");
const InfrastructureConnection = require("../models/infrastructureConnection.model");

/**
 * Middleware to authenticate requests originating from CloudOps Agents
 */
const authenticateAgent = async (req, res, next) => {
    try {
        let token = null;

        if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
            token = req.headers.authorization.split(" ")[1];
        }

        const agentId = req.headers["x-agent-id"] || req.body?.agentId || req.query?.agentId;

        if (!token) {
            return res.status(401).json({
                success: false,
                message: "Authentication failed: Agent operational token missing."
            });
        }

        if (!agentId) {
            return res.status(401).json({
                success: false,
                message: "Authentication failed: x-agent-id header missing."
            });
        }

        const connection = await InfrastructureConnection.findOne({ agentId });

        if (!connection) {
            return res.status(401).json({
                success: false,
                message: "Authentication failed: Unknown agent identity."
            });
        }

        if (connection.status === "REVOKED" || !connection.enabled) {
            return res.status(403).json({
                success: false,
                message: "Access forbidden: Infrastructure connection has been revoked or disabled."
            });
        }

        // Validate token hash
        if (!connection.verifyAgentToken(token)) {
            return res.status(401).json({
                success: false,
                message: "Authentication failed: Invalid operational agent token."
            });
        }

        req.connection = connection;
        req.agentId = agentId;
        next();
    } catch (error) {
        console.error("[AGENT AUTH] Verification error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Internal authentication error"
        });
    }
};

module.exports = {
    authenticateAgent
};
