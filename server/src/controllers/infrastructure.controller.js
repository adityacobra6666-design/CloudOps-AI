const crypto = require("crypto");
const InfrastructureConnection = require("../models/infrastructureConnection.model");
const AgentCommand = require("../models/agentCommand.model");

// Heartbeat staleness thresholds
const HEARTBEAT_TIMEOUT_MS = 60 * 1000; // 60 seconds -> DISCONNECTED
const HEARTBEAT_DEGRADED_MS = 35 * 1000; // 35 seconds -> DEGRADED

function computeFreshStatus(connection) {
    if (connection.status === "REVOKED") return "REVOKED";
    if (connection.status === "PENDING") return "PENDING";

    if (!connection.lastSeenAt) {
        return "DISCONNECTED";
    }

    const elapsed = Date.now() - new Date(connection.lastSeenAt).getTime();
    if (elapsed > HEARTBEAT_TIMEOUT_MS) {
        return "DISCONNECTED";
    }
    if (elapsed > HEARTBEAT_DEGRADED_MS) {
        return "DEGRADED";
    }
    return "CONNECTED";
}

// =========================================
// CREATE INFRASTRUCTURE CONNECTION
// =========================================
exports.createConnection = async (req, res) => {
    try {
        const { name, type, environment, description, capabilities } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({
                success: false,
                message: "Connection name is required"
            });
        }

        // Generate high-entropy enrollment token
        const rawEnrollmentToken = `cope_${crypto.randomBytes(32).toString("hex")}`;
        const enrollmentTokenHash = crypto
            .createHash("sha256")
            .update(rawEnrollmentToken)
            .digest("hex");

        // Generate unique agent identifier
        const agentId = `agent-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;

        // 24 hour enrollment token expiry
        const enrollmentTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        const connection = await InfrastructureConnection.create({
            name: name.trim(),
            type: type || "KUBERNETES",
            environment: environment || "production",
            description: description || "",
            agentId,
            enrollmentTokenHash,
            enrollmentTokenExpiresAt,
            enrollmentTokenUsed: false,
            status: "PENDING",
            capabilities: capabilities || ["METRICS", "KUBERNETES_READ", "KUBERNETES_REMEDIATION"]
        });

        // NEVER log rawEnrollmentToken or store raw value in DB
        res.status(201).json({
            success: true,
            connection: {
                _id: connection._id,
                name: connection.name,
                type: connection.type,
                environment: connection.environment,
                description: connection.description,
                agentId: connection.agentId,
                status: connection.status,
                capabilities: connection.capabilities,
                createdAt: connection.createdAt
            },
            // One-time display to authorized user
            enrollmentToken: rawEnrollmentToken,
            instructions: {
                step1: "Save this enrollment token securely. It will not be shown again.",
                step2: "Start the CloudOps Agent with CLOUDOPS_URL and ENROLLMENT_TOKEN."
            }
        });
    } catch (error) {
        console.error("Create connection error:", error.message);
        res.status(500).json({
            success: false,
            message: "Failed to create infrastructure connection"
        });
    }
};

// =========================================
// GET ALL CONNECTIONS
// =========================================
exports.getConnections = async (req, res) => {
    try {
        const connections = await InfrastructureConnection.find()
            .select("-enrollmentTokenHash -agentTokenHash")
            .sort({ createdAt: -1 });

        const mapped = connections.map(conn => {
            const computedStatus = computeFreshStatus(conn);
            return {
                ...conn.toObject(),
                status: computedStatus
            };
        });

        res.json({
            success: true,
            connections: mapped
        });
    } catch (error) {
        console.error("Get connections error:", error.message);
        res.status(500).json({
            success: false,
            message: "Failed to fetch infrastructure connections"
        });
    }
};

// =========================================
// GET CONNECTION BY ID
// =========================================
exports.getConnectionById = async (req, res) => {
    try {
        const connection = await InfrastructureConnection.findById(req.params.id)
            .select("-enrollmentTokenHash -agentTokenHash");

        if (!connection) {
            return res.status(404).json({
                success: false,
                message: "Infrastructure connection not found"
            });
        }

        const recentCommands = await AgentCommand.find({ connectionId: connection._id })
            .sort({ createdAt: -1 })
            .limit(20);

        const computedStatus = computeFreshStatus(connection);

        res.json({
            success: true,
            connection: {
                ...connection.toObject(),
                status: computedStatus,
                recentCommands
            }
        });
    } catch (error) {
        console.error("Get connection by ID error:", error.message);
        res.status(500).json({
            success: false,
            message: "Failed to fetch connection details"
        });
    }
};

// =========================================
// REVOKE CONNECTION
// =========================================
exports.revokeConnection = async (req, res) => {
    try {
        const connection = await InfrastructureConnection.findById(req.params.id);

        if (!connection) {
            return res.status(404).json({
                success: false,
                message: "Infrastructure connection not found"
            });
        }

        connection.status = "REVOKED";
        connection.enabled = false;
        connection.agentTokenHash = null; // Invalidate any operational session
        await connection.save();

        console.log(`🔒 [INFRASTRUCTURE] Connection revoked: "${connection.name}" (${connection.agentId})`);

        res.json({
            success: true,
            message: `Connection "${connection.name}" has been revoked successfully. Agent tokens invalidated.`,
            status: "REVOKED"
        });
    } catch (error) {
        console.error("Revoke connection error:", error.message);
        res.status(500).json({
            success: false,
            message: "Failed to revoke connection"
        });
    }
};

// =========================================
// DELETE CONNECTION
// =========================================
exports.deleteConnection = async (req, res) => {
    try {
        const connection = await InfrastructureConnection.findById(req.params.id);

        if (!connection) {
            return res.status(404).json({
                success: false,
                message: "Infrastructure connection not found"
            });
        }

        await AgentCommand.deleteMany({ connectionId: connection._id });
        await InfrastructureConnection.findByIdAndDelete(connection._id);

        res.json({
            success: true,
            message: "Infrastructure connection and history removed successfully"
        });
    } catch (error) {
        console.error("Delete connection error:", error.message);
        res.status(500).json({
            success: false,
            message: "Failed to delete infrastructure connection"
        });
    }
};
