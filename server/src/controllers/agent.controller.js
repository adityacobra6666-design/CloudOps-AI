const crypto = require("crypto");
const InfrastructureConnection = require("../models/infrastructureConnection.model");
const AgentCommand = require("../models/agentCommand.model");
const { verifyRemediation } = require("../services/remediation/verification");
const RemediationAction = require("../models/remediationAction.model");
const Incident = require("../models/Incident");

// =========================================
// REGISTER AGENT VIA ENROLLMENT TOKEN
// =========================================
exports.registerAgent = async (req, res) => {
    try {
        const { enrollmentToken, version, capabilities, metadata } = req.body;

        if (!enrollmentToken || typeof enrollmentToken !== "string") {
            return res.status(400).json({
                success: false,
                message: "Missing enrollment token"
            });
        }

        // Hash incoming enrollment token
        const tokenHash = crypto
            .createHash("sha256")
            .update(enrollmentToken.trim())
            .digest("hex");

        const connection = await InfrastructureConnection.findOne({
            enrollmentTokenHash: tokenHash
        });

        if (!connection) {
            return res.status(401).json({
                success: false,
                message: "Invalid or unknown enrollment token"
            });
        }

        if (connection.status === "REVOKED" || !connection.enabled) {
            return res.status(403).json({
                success: false,
                message: "This infrastructure connection has been revoked or disabled."
            });
        }

        if (connection.enrollmentTokenUsed) {
            return res.status(401).json({
                success: false,
                message: "Enrollment token has already been used. Please generate a new connection."
            });
        }

        if (connection.enrollmentTokenExpiresAt && new Date() > connection.enrollmentTokenExpiresAt) {
            return res.status(401).json({
                success: false,
                message: "Enrollment token has expired."
            });
        }

        // Generate long-lived operational agent token
        const rawAgentToken = `copa_${crypto.randomBytes(32).toString("hex")}`;
        const agentTokenHash = crypto
            .createHash("sha256")
            .update(rawAgentToken)
            .digest("hex");

        // Invalidate enrollment token and activate connection
        connection.enrollmentTokenUsed = true;
        connection.enrollmentTokenHash = null; // Purge enrollment token hash
        connection.agentTokenHash = agentTokenHash;
        connection.tokenCreatedAt = new Date();
        connection.registeredAt = new Date();
        connection.lastSeenAt = new Date();
        connection.status = "CONNECTED";
        if (version) connection.version = version;
        if (Array.isArray(capabilities) && capabilities.length > 0) connection.capabilities = capabilities;
        if (metadata) connection.metadata = metadata;

        await connection.save();

        console.log(`🤖 [AGENT] Agent successfully enrolled: "${connection.name}" (ID: ${connection.agentId})`);

        // Return operational token ONLY ONCE in registration response
        res.status(200).json({
            success: true,
            message: "Agent enrolled successfully",
            agentId: connection.agentId,
            agentToken: rawAgentToken,
            connectionId: connection._id,
            config: {
                heartbeatIntervalMs: 20000,
                telemetryIntervalMs: 10000,
                commandPollIntervalMs: 5000
            }
        });
    } catch (error) {
        console.error("Agent registration error:", error.message);
        res.status(500).json({
            success: false,
            message: "Internal server error during agent registration"
        });
    }
};

// =========================================
// HEARTBEAT
// =========================================
exports.heartbeat = async (req, res) => {
    try {
        const connection = req.connection;
        const { version, capabilities, metadata, health } = req.body;

        connection.lastSeenAt = new Date();
        if (connection.status !== "REVOKED") {
            connection.status = "CONNECTED";
        }
        if (version) connection.version = version;
        if (capabilities) connection.capabilities = capabilities;
        if (metadata) {
            connection.metadata = { ...(connection.metadata || {}), ...metadata, health: health || "healthy" };
        }

        await connection.save();

        res.json({
            success: true,
            status: "ACK",
            serverTime: new Date().toISOString()
        });
    } catch (error) {
        console.error("Heartbeat error:", error.message);
        res.status(500).json({
            success: false,
            message: "Heartbeat processing failed"
        });
    }
};

// =========================================
// INGEST TELEMETRY
// =========================================
exports.telemetry = async (req, res) => {
    try {
        const connection = req.connection;
        const { metrics, k8s } = req.body;

        connection.lastSeenAt = new Date();
        if (connection.status !== "REVOKED") {
            connection.status = "CONNECTED";
        }

        if (metrics && typeof metrics === "object") {
            connection.telemetry = {
                metrics: {
                    cpu: parseFloat(metrics.cpu) || 0,
                    memory: parseFloat(metrics.memory) || 0,
                    requestRate: parseFloat(metrics.requestRate) || 0,
                    errorRate: parseFloat(metrics.errorRate) || 0,
                    p95Latency: parseFloat(metrics.p95Latency) || 0,
                    networkRx: parseFloat(metrics.networkRx) || 0,
                    networkTx: parseFloat(metrics.networkTx) || 0
                },
                recordedAt: new Date()
            };
        }

        if (k8s && typeof k8s === "object") {
            connection.k8sSummary = {
                nodesCount: Number(k8s.nodesCount || k8s.nodes?.length || 0),
                podsCount: Number(k8s.podsCount || k8s.pods?.length || 0),
                deploymentsCount: Number(k8s.deploymentsCount || k8s.deployments?.length || 0),
                servicesCount: Number(k8s.servicesCount || k8s.services?.length || 0),
                nodes: Array.isArray(k8s.nodes) ? k8s.nodes : [],
                pods: Array.isArray(k8s.pods) ? k8s.pods : [],
                deployments: Array.isArray(k8s.deployments) ? k8s.deployments : [],
                services: Array.isArray(k8s.services) ? k8s.services : [],
                updatedAt: new Date()
            };
        }

        await connection.save();

        res.json({
            success: true,
            recorded: true
        });
    } catch (error) {
        console.error("Telemetry ingestion error:", error.message);
        res.status(500).json({
            success: false,
            message: "Telemetry ingestion failed"
        });
    }
};

// =========================================
// POLL COMMANDS FOR AGENT
// =========================================
exports.getCommands = async (req, res) => {
    try {
        const connection = req.connection;

        // Sweep expired PENDING commands
        await AgentCommand.updateMany(
            {
                connectionId: connection._id,
                status: "PENDING",
                expiresAt: { $lte: new Date() }
            },
            {
                $set: {
                    status: "EXPIRED",
                    error: "Command expired before agent pickup",
                    completedAt: new Date()
                }
            }
        );

        // Sweep commands stuck in RUNNING for more than 60s
        const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
        await AgentCommand.updateMany(
            {
                connectionId: connection._id,
                status: "RUNNING",
                startedAt: { $lte: oneMinuteAgo }
            },
            {
                $set: {
                    status: "FAILED",
                    error: "Command execution timed out after 60s in RUNNING state",
                    completedAt: new Date()
                }
            }
        );

        // Find oldest pending non-expired command
        const command = await AgentCommand.findOneAndUpdate(
            {
                connectionId: connection._id,
                status: "PENDING",
                expiresAt: { $gt: new Date() }
            },
            {
                $set: {
                    status: "RUNNING",
                    startedAt: new Date()
                }
            },
            {
                sort: { createdAt: 1 },
                new: true
            }
        );

        if (!command) {
            return res.json({
                success: true,
                command: null
            });
        }

        res.json({
            success: true,
            command: {
                commandId: command.commandId,
                action: command.action,
                target: command.target,
                parameters: command.parameters,
                reason: command.reason,
                createdAt: command.createdAt
            }
        });
    } catch (error) {
        console.error("Agent get commands error:", error.message);
        res.status(500).json({
            success: false,
            message: "Failed to poll commands"
        });
    }
};

// =========================================
// SUBMIT COMMAND RESULT FROM AGENT
// =========================================
exports.submitCommandResult = async (req, res) => {
    try {
        const connection = req.connection;
        const { commandId, status, message, resultingState, error } = req.body;

        if (!commandId) {
            return res.status(400).json({
                success: false,
                message: "Missing commandId"
            });
        }

        const command = await AgentCommand.findOne({
            commandId,
            connectionId: connection._id
        });

        if (!command) {
            return res.status(404).json({
                success: false,
                message: "Command not found or does not belong to this connection"
            });
        }

        // Replay Protection: if already resolved, do not double-process
        if (["SUCCEEDED", "FAILED", "REJECTED"].includes(command.status)) {
            return res.json({
                success: true,
                acknowledged: true,
                note: "Command was already recorded as completed"
            });
        }

        command.status = ["SUCCEEDED", "FAILED", "REJECTED"].includes(status) ? status : (error ? "FAILED" : "SUCCEEDED");
        command.completedAt = new Date();
        command.result = { message, resultingState };
        command.error = error || null;

        // Perform backend verification if action succeeded
        if (command.status === "SUCCEEDED" && resultingState) {
            command.verification = {
                status: "SUCCESS",
                message: "Remote agent confirmed state convergence",
                state: resultingState,
                verifiedAt: new Date()
            };
        }

        await command.save();

        // Update corresponding RemediationAction audit record if connected
        try {
            const auditAction = await RemediationAction.findOne({
                $or: [
                    { "result.commandId": commandId },
                    { connection: connection._id, action: command.action, status: "EXECUTING" }
                ]
            }).sort({ createdAt: -1 });

            if (auditAction) {
                auditAction.status = command.status === "SUCCEEDED" ? "SUCCESS" : "FAILED";
                auditAction.completedAt = new Date();
                auditAction.result = message || JSON.stringify(resultingState);
                auditAction.verification = {
                    status: command.status === "SUCCEEDED" ? "SUCCESS" : "FAILED",
                    message: message || "Executed through remote agent",
                    metric: "Agent Verification",
                    passed: command.status === "SUCCEEDED"
                };
                await auditAction.save();

                if (auditAction.incident && command.status === "SUCCEEDED") {
                    await Incident.findByIdAndUpdate(auditAction.incident, {
                        $set: { status: "resolved", remediationStatus: "SUCCESS" }
                    });
                }
            }
        } catch (auditErr) {
            console.warn("Audit log update notice:", auditErr.message);
        }

        res.json({
            success: true,
            acknowledged: true
        });
    } catch (error) {
        console.error("Submit command result error:", error.message);
        res.status(500).json({
            success: false,
            message: "Failed to record command result"
        });
    }
};
