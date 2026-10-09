const http = require("http");

const {
    ALLOWED_ACTIONS,
    ALLOWED_TARGETS,
    KUBERNETES_CONFIG
} = require("../../config/remediation.config");
const { kubernetesService } = require("../kubernetes/kubernetes.service");

// =========================================
// DOCKER ENGINE API CLIENT
// Uses the Docker Engine REST API via
// Unix socket /var/run/docker.sock
// =========================================

function dockerRequest(method, path) {
    return new Promise((resolve, reject) => {
        const options = {
            socketPath: "/var/run/docker.sock",
            path,
            method,
            headers: {
                "Content-Type": "application/json"
            }
        };

        const req = http.request(options, (res) => {
            let data = "";

            res.on("data", (chunk) => {
                data += chunk;
            });

            res.on("end", () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve({
                        statusCode: res.statusCode,
                        data
                    });
                } else {
                    reject(
                        new Error(
                            `Docker API ${method} ${path} returned ${res.statusCode}: ${data}`
                        )
                    );
                }
            });
        });

        req.on("error", (error) => {
            reject(
                new Error(
                    `Docker API connection failed: ${error.message}`
                )
            );
        });

        req.setTimeout(30000, () => {
            req.destroy();
            reject(
                new Error("Docker API request timed out")
            );
        });

        req.end();
    });
}

// =========================================
// BASE EXECUTOR
// =========================================

class RemediationExecutor {
    async execute(action, target, context) {
        throw new Error(
            "execute() must be implemented by subclass"
        );
    }

    getName() {
        return "BaseExecutor";
    }
}

// =========================================
// DOCKER EXECUTOR
// =========================================

class DockerExecutor extends RemediationExecutor {
    getName() {
        return "DockerExecutor";
    }

    async execute(action, target, context) {
        console.log(
            `🐳 DockerExecutor: ${action} → ${target}`
        );

        // Validate target exists
        const targetConfig = ALLOWED_TARGETS[target];

        if (!targetConfig) {
            throw new Error(
                `Unknown target: "${target}"`
            );
        }

        const containerName = targetConfig.container;

        switch (action) {
            case "RESTART_SERVICE":
                return await this.restartService(
                    containerName,
                    target
                );

            case "SCALE_SERVICE":
                return this.scaleService(
                    containerName,
                    target
                );

            default:
                throw new Error(
                    `Unsupported action: "${action}"`
                );
        }
    }

    // -----------------------------------------
    // RESTART SERVICE
    // -----------------------------------------

    async restartService(containerName, target) {
        console.log(
            `🔄 Restarting container: ${containerName}`
        );

        try {
            await dockerRequest(
                "POST",
                `/containers/${containerName}/restart?t=10`
            );

            console.log(
                `✅ Container ${containerName} restart initiated`
            );

            return {
                success: true,
                message:
                    `Container "${containerName}" restart command sent successfully`,
                executor: this.getName(),
                containerName
            };
        } catch (error) {
            console.error(
                `❌ Failed to restart ${containerName}:`,
                error.message
            );

            throw new Error(
                `Failed to restart "${containerName}": ${error.message}`
            );
        }
    }

    // -----------------------------------------
    // SCALE SERVICE
    // -----------------------------------------

    scaleService(containerName, target) {
        console.log(
            `⚠️ SCALE_SERVICE is not fully supported in Docker mode`
        );

        return {
            success: false,
            message:
                `SCALE_SERVICE requires Kubernetes (Phase 2). ` +
                `Container "${containerName}" cannot be scaled in Docker Compose mode.`,
            executor: this.getName(),
            containerName
        };
    }
}

// =========================================
// KUBERNETES EXECUTOR
// =========================================
// KUBERNETES EXECUTOR (Local Minikube / In-Cluster)
// =========================================

class KubernetesExecutor extends RemediationExecutor {
    getName() {
        return "KubernetesExecutor";
    }

    async execute(action, target, context = {}) {
        console.log(`☸️ KubernetesExecutor: ${action} →`, target);

        // Extract deployment name and namespace whether target is string or structured object
        const deploymentName = (typeof target === "object" && target !== null
            ? target.name
            : (ALLOWED_TARGETS[target]?.deployment || target)
        )?.trim();

        const namespace = (typeof target === "object" && target !== null && target.namespace
            ? target.namespace
            : (context.namespace || KUBERNETES_CONFIG.defaultNamespace)
        )?.trim();

        if (!deploymentName) {
            throw new Error("Validation rejected: Deployment target name is missing or invalid.");
        }

        if (!namespace) {
            throw new Error("Validation rejected: Target namespace is missing or invalid.");
        }

        const isAllowedTarget = KUBERNETES_CONFIG.allowedDeployments.includes(deploymentName) || Boolean(ALLOWED_TARGETS[deploymentName]) || Boolean(ALLOWED_TARGETS[target]);
        if (!isAllowedTarget) {
            throw new Error(`Rejected: Target "${deploymentName}" is not in allowed deployments whitelist.`);
        }

        const isAllowedNs = KUBERNETES_CONFIG.allowedNamespaces.includes(namespace);
        if (!isAllowedNs) {
            throw new Error(`Rejected: Namespace "${namespace}" is not in allowed namespaces whitelist.`);
        }

        switch (action) {
            case "SCALE_SERVICE": {
                const requestedReplicas = parseInt(context.replicas || context.desiredReplicas || 3, 10);
                if (isNaN(requestedReplicas) || requestedReplicas < 1 || requestedReplicas > 10) {
                    throw new Error(`Validation rejected: replicas (${requestedReplicas}) must be between 1 and 10.`);
                }

                const scaleResult = await kubernetesService.scaleDeployment(deploymentName, requestedReplicas, namespace);
                return {
                    success: scaleResult.success && scaleResult.converged,
                    message: scaleResult.message,
                    executor: this.getName(),
                    previousReplicas: scaleResult.previousReplicas,
                    newReplicas: scaleResult.newReplicas,
                    readyReplicas: scaleResult.readyReplicas,
                    deploymentName,
                    namespace
                };
            }

            case "RESTART_SERVICE": {
                const restartResult = await kubernetesService.restartDeployment(deploymentName, namespace);
                return {
                    success: restartResult.success && restartResult.converged,
                    message: restartResult.message,
                    executor: this.getName(),
                    restartedAt: restartResult.restartedAt,
                    readyReplicas: restartResult.readyReplicas,
                    deploymentName,
                    namespace
                };
            }

            default:
                throw new Error(`Unsupported Kubernetes action: "${action}"`);
        }
    }
}

// =========================================
// AGENT REMEDIATION EXECUTOR
// Queues structured actions for remote agents
// =========================================

class AgentRemediationExecutor extends RemediationExecutor {
    getName() {
        return "AgentRemediationExecutor";
    }

    async execute(action, target, context = {}) {
        const crypto = require("crypto");
        const AgentCommand = require("../../models/agentCommand.model");
        const InfrastructureConnection = require("../../models/infrastructureConnection.model");

        const connectionId = context.connectionId || context.incident?.connectionId;
        if (!connectionId || connectionId === "local") {
            throw new Error("Cannot execute remote remediation: valid connectionId is required.");
        }

        const connection = await InfrastructureConnection.findById(connectionId);
        if (!connection) {
            throw new Error(`Connected infrastructure environment "${connectionId}" not found.`);
        }

        if (connection.status === "REVOKED" || !connection.enabled) {
            throw new Error(`Connected environment "${connection.name}" is revoked or disabled. Command rejected.`);
        }

        // Validate action
        if (!["SCALE_SERVICE", "RESTART_SERVICE"].includes(action)) {
            throw new Error(`Agent-side rejected: Action "${action}" not allowed.`);
        }

        // Extract and validate target
        const deploymentName = (typeof target === "object" && target !== null ? target.name : target)?.trim();
        const namespace = (typeof target === "object" && target !== null && target.namespace ? target.namespace : (context.namespace || "cloudops"))?.trim();

        if (!deploymentName) {
            throw new Error("Validation rejected: Target deployment name is required.");
        }
        if (!namespace) {
            throw new Error("Validation rejected: Target namespace is required.");
        }

        let parameters = {};
        if (action === "SCALE_SERVICE") {
            const numReplicas = parseInt(context.replicas || context.desiredReplicas || 3, 10);
            if (isNaN(numReplicas) || numReplicas < 1 || numReplicas > 10) {
                throw new Error(`Validation rejected: replicas (${numReplicas}) must be between 1 and 10.`);
            }
            parameters = { replicas: numReplicas };
        }

        const commandId = `cmd-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;

        console.log(`📡 [AGENT EXECUTOR] Queuing ${action} for ${deploymentName} (ns: ${namespace}) on connection "${connection.name}" (${commandId})`);

        await AgentCommand.create({
            commandId,
            connectionId: connection._id,
            agentId: connection.agentId,
            incidentId: context.incident?._id || null,
            action,
            target: {
                resourceType: "deployment",
                namespace,
                name: deploymentName
            },
            parameters,
            reason: context.reason || `Automated CloudOps AI remediation via agent for ${deploymentName}`,
            status: "PENDING",
            expiresAt: new Date(Date.now() + 5 * 60 * 1000)
        });

        // Wait for agent to poll and report result (up to 35 seconds)
        const pollIntervalMs = 1000;
        const maxWaitMs = 35000;
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitMs) {
            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
            const updated = await AgentCommand.findOne({ commandId });
            if (!updated) break;

            if (updated.status === "SUCCEEDED") {
                return {
                    success: true,
                    message: updated.result?.message || `Command ${action} executed successfully by agent`,
                    executor: this.getName(),
                    commandId,
                    deploymentName,
                    namespace,
                    previousReplicas: updated.result?.resultingState?.previousReplicas,
                    newReplicas: updated.result?.resultingState?.newReplicas || parameters.replicas,
                    agentId: connection.agentId
                };
            }

            if (updated.status === "FAILED" || updated.status === "REJECTED") {
                return {
                    success: false,
                    message: updated.error || updated.result?.message || `Remote agent reported ${updated.status}`,
                    executor: this.getName(),
                    commandId,
                    agentId: connection.agentId
                };
            }
        }

        // Timeout transition
        await AgentCommand.findOneAndUpdate(
            { commandId, status: { $in: ["PENDING", "RUNNING"] } },
            {
                $set: {
                    status: "FAILED",
                    error: `Remote agent command timed out after ${Math.round(maxWaitMs / 1000)}s waiting for execution`,
                    completedAt: new Date()
                }
            }
        );

        return {
            success: false,
            message: `Remote agent command timed out after ${Math.round(maxWaitMs / 1000)}s waiting for execution`,
            executor: this.getName(),
            commandId,
            agentId: connection.agentId
        };
    }
}

// =========================================
// EXECUTOR FACTORY
// =========================================

function createExecutor(preferredType, context = {}) {
    const connId = context.connectionId || context.incident?.connectionId;
    if (preferredType === "agent" || (connId && connId !== "local")) {
        return new AgentRemediationExecutor();
    }

    const type = preferredType || process.env.REMEDIATION_EXECUTOR;

    if (type === "docker") {
        return new DockerExecutor();
    }

    if (type === "kubernetes" || type === "k8s") {
        return new KubernetesExecutor();
    }

    // Auto-detect: if Kubernetes is connected, use KubernetesExecutor, else fallback to DockerExecutor
    if (kubernetesService.checkConnection()) {
        const status = kubernetesService.kc?.contexts?.length > 0;
        if (status) {
            return new KubernetesExecutor();
        }
    }

    return new DockerExecutor();
}

module.exports = {
    RemediationExecutor,
    DockerExecutor,
    KubernetesExecutor,
    AgentRemediationExecutor,
    createExecutor
};
